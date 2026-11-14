/**
 * The repository is public, so a workflow runs for people who are not its
 * maintainers, and its logs are public too:
 *
 *   - only owner-gate.yml uses `pull_request_target`, which runs a fork's PR
 *     with the base repository's secrets and a write token; owner-gate.yml
 *     checks out nothing (owner-gate.test.ts);
 *   - every workflow sets `permissions:` at the top, read-only or empty, so a
 *     job gets write access only where it names it, and none names
 *     `contents: write`;
 *   - only claude.yml reads a secret, in any syntax, and it keeps its secret
 *     in an environment of its own (`claude`), which no other workflow uses;
 *   - no workflow grants `security-events: write`;
 *   - no `run:` script interpolates an expression: an event field, a branch
 *     name or a step output reaches a script only through `env:`, so text an
 *     outsider wrote is never pasted into a shell command;
 *   - nothing under .github/ names a repository of the maintainer's personal
 *     account, where the private repositories live, except the public ones
 *     that repo-links.json lists;
 *   - ci.yml reads no secret and clones no other repository: the contract and
 *     conventions checks in scripts/check-ci.sh, which it runs, use the copies
 *     vendored under .github/contract-tools/, hash-locked in
 *     .contracts.lock.json;
 *   - every job in claude.yml holds the gate itself: it starts only for an
 *     issue comment from an OWNER, MEMBER or COLLABORATOR, and every
 *     disjunct of its gate checks `author_association`;
 *   - claude.yml never holds a token that can push: no `id-token` permission
 *     (the action mints its GitHub App token through it), no `@claude edit`
 *     mode, and the action runs on the job's own `github.token`;
 *   - claude.yml runs Claude only in `answer`, whose token reads, with Bash
 *     sandboxed without network or GitHub tokens; only `ack` and `post`,
 *     which run no Claude, write, and `post` writes to the event's thread;
 *
 * Patterns rather than a YAML parser: the repo has no parser dependency. The
 * rules are tested on the mutants they exist to catch, then on the real files.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));
const workflow = (name: string) => read(`${WORKFLOWS}/${name}`);

const SECRET_HOLDERS = ["claude.yml"];
const GATE = /^contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.(comment|review)\.author_association\)$/;

/** The top-level `on:` block. */
const triggers = (yaml: string) => /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1] ?? "";
const triggerNames = (yaml: string) => [...triggers(yaml).matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);

/** The top-level `permissions:` value, inline or as a block. */
function topLevelPermissions(yaml: string): string | undefined {
  const m = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(yaml);
  return m === null ? undefined : (m[1]!.trim() || m[2]!.trim());
}

/** The lines YAML reads as keys and values: full-line comments dropped. */
const yamlLines = (yaml: string) => yaml.split("\n").filter((line) => !/^\s*#/.test(line));

/** A secret read in any syntax: `secrets.X`, `secrets['X']`, or the whole context. */
export const readsSecret = (yaml: string) => /\bsecrets\s*[.[]|\(\s*secrets\s*\)/.test(yaml);

/** Each secret read outside comment lines, as written: `secrets.X`, `secrets['X']` or `(secrets)`. */
export const secretReads = (yaml: string) =>
  yamlLines(yaml)
    .join("\n")
    .match(/\bsecrets\s*\.\s*\w+|\bsecrets\s*\[[^\]]*\]|\(\s*secrets\s*\)/g) ?? [];

export const usesEnvironment = (yaml: string) => yamlLines(yaml).some((line) => /^\s*environment:/.test(line));

export const grantsWrite = (yaml: string) => yamlLines(yaml).some((line) => /^\s*contents:\s*write\b|\bwrite-all\b/.test(line));

export const grantsSecurityEventsWrite = (yaml: string) => yamlLines(yaml).some((line) => /^\s*security-events:\s*write\b/.test(line));

/** A job's own `permissions:` entries as sorted `name: level` strings. */
export function jobPermissions(body: string): string[] {
  const block = /^ {4}permissions:\n((?: {6}.*\n)*)/m.exec(body)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .sort();
}

/** `<line>: <text>` for each line of a `run:` script that holds a `${{ }}` expression. */
export function interpolatedRuns(yaml: string): string[] {
  const lines = yaml.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*(?:-\s+)?)run:(.*)$/.exec(line);
    if (m === null) return;
    const keyIndent = m[1]!.length;
    const script = [{ n: i, text: m[2]! }];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() !== "" && next.length - next.trimStart().length <= keyIndent) break;
      script.push({ n: j, text: next });
    }
    for (const { n, text } of script) if (text.includes("${{")) found.push(`${n + 1}: ${text.trim()}`);
  });
  return found;
}

const personalAccount = "spencer0124";

interface RepoLinks {
  owner: string;
  public: string[];
}
const repoLinks = JSON.parse(read("repo-links.json")) as RepoLinks;

const repoNameOf = (token: string) => token.replace(/\.+$/, "").replace(/\.git$/i, "").toLowerCase();

export function namesPersonalRepository(text: string, links: RepoLinks = repoLinks): boolean {
  const exposed = new Set(links.owner.toLowerCase() === personalAccount ? links.public.map((name) => name.toLowerCase()) : []);
  return [...text.matchAll(new RegExp(`github\\.com[:/]${personalAccount}/([\\w.-]*)`, "gi"))].some(([, repo]) => !exposed.has(repoNameOf(repo!)));
}

/** Two-space-indented keys under `jobs:`, each with its body. */
function jobBlocks(yaml: string): Map<string, string> {
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n"));
  const blocks = new Map<string, string>();
  for (const m of jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** A job's `if:`, inline or as a block scalar, without a `${{ }}` wrapper. */
function jobIf(body: string): string | undefined {
  const m = /^ {4}if:[ \t]*(.*)\n((?: {6}.*\n)*)/m.exec(body);
  if (m === null) return undefined;
  const text = /^[|>]/.test(m[1]!) ? m[2]!.replace(/\n/g, " ") : m[1]!;
  return text.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").trim();
}

/** Split an expression on a top-level operator, outside parentheses and '…' strings. */
function splitTop(expr: string, op: "||" | "&&"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

/** The expression without parentheses that wrap all of it. */
function unwrap(expr: string): string {
  let e = expr.trim();
  while (e.startsWith("(") && e.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < e.length - 1; i++) {
      if (e[i] === "(") depth++;
      else if (e[i] === ")") depth--;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

const conjuncts = (disjunct: string) => splitTop(unwrap(disjunct), "&&").map(unwrap);

/** The disjuncts of a condition that do not require the author to be an OWNER, MEMBER or COLLABORATOR. */
export const ungatedDisjuncts = (condition: string) =>
  splitTop(unwrap(condition), "||").filter((d) => !conjuncts(d).some((c) => GATE.test(c)));

/** The jobs whose own condition lets someone who is not a maintainer start them: a job gets no credit for needing another. */
export function ungatedJobs(yaml: string): string[] {
  return [...jobBlocks(yaml)]
    .filter(([, body]) => {
      const condition = jobIf(body);
      return condition === undefined || ungatedDisjuncts(condition).length > 0;
    })
    .map(([name]) => name);
}

/** The events a workflow listens to that no gated condition names. */
export function eventsWithoutGate(yaml: string): string[] {
  const named = [...jobBlocks(yaml).values()]
    .flatMap((body) => {
      const condition = jobIf(body);
      return condition === undefined ? [] : splitTop(unwrap(condition), "||");
    })
    .filter((d) => conjuncts(d).some((c) => GATE.test(c)))
    .flatMap((d) => conjuncts(d).map((c) => /^github\.event_name == '([a-z_]+)'$/.exec(c)?.[1]).filter(Boolean));
  return triggerNames(yaml).filter((event) => !named.includes(event));
}

const GATED_IF = (event: string, field: string) =>
  `(github.event_name == '${event}' && contains(github.event.${field}.body, '@claude') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.${field}.author_association))`;

describe("the public-workflow rules apply as specified", () => {
  // M1: a new workflow a fork's pull request starts, holding claude.yml's secret and a write grant.
  const forkWorkflow = [
    "name: Mutant",
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  steal:",
    "    runs-on: ubuntu-latest",
    "    environment: claude",
    "    permissions:",
    "      contents: write",
    "    steps:",
    "      - run: |",
    "          echo \"${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\"",
    "          echo \"${{ github.event.pull_request.title }}\"",
    "",
  ].join("\n");

  it("refuses a pull-request workflow that reads a secret, uses the environment, writes contents or interpolates the title", () => {
    // Act & Assert
    expect(readsSecret(forkWorkflow)).toBe(true);
    expect(usesEnvironment(forkWorkflow)).toBe(true);
    expect(grantsWrite(forkWorkflow)).toBe(true);
    expect(interpolatedRuns(forkWorkflow)).toEqual([
      '14: echo "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}"',
      '15: echo "${{ github.event.pull_request.title }}"',
    ]);
  });

  it.each([
    ["dot syntax", "token: ${{ secrets.X }}"],
    ["bracket syntax", "token: ${{ secrets['X'] }}"],
    ["bracket syntax with spaces", "token: ${{ secrets [ \"X\" ] }}"],
    ["the whole context", "all: ${{ toJSON(secrets) }}"],
  ])("finds a secret read in %s", (_case, line) => {
    // Act & Assert
    expect(readsSecret(line)).toBe(true);
  });

  it("finds no secret read in prose about secrets", () => {
    // Act & Assert
    expect(readsSecret("# its secrets live in an environment; no secret, secrets, or secrets: here")).toBe(false);
  });

  it("lists each secret read in any syntax, and none on a comment line", () => {
    // Arrange
    const body = [
      "    steps:",
      "      # reads secrets.IN_A_COMMENT",
      "      - env:",
      "          A: ${{ secrets.ONE }}",
      "          B: ${{ secrets['TWO'] }}",
      "          C: ${{ toJSON(secrets) }}",
      "",
    ].join("\n");

    // Act & Assert
    expect(secretReads(body)).toEqual(["secrets.ONE", "secrets['TWO']", "(secrets)"]);
  });

  it.each([
    ["a step output on one line", "      - run: echo ${{ steps.mongod.outputs.version }}"],
    ["a step output in a block", "      - name: x\n        run: |\n          ls \"$DIR\"\n          ls x-\"${{ steps.mongod.outputs.version }}\""],
    ["the head branch", "        run: git checkout ${{ github.head_ref }}"],
  ])("finds an expression in a run script: %s", (_case, yaml) => {
    // Act & Assert
    expect(interpolatedRuns(yaml)).toHaveLength(1);
  });

  it("allows an expression in env: and with:, beside a run script that reads it", () => {
    // Arrange
    const yaml = [
      "      - name: x",
      "        env:",
      "          VERSION: ${{ steps.mongod.outputs.version }}",
      "        run: |",
      "          echo \"$VERSION\"",
      "      - uses: a/b@0123456789abcdef0123456789abcdef01234567 # v1",
      "        with:",
      "          token: ${{ github.token }}",
    ].join("\n");

    // Act & Assert
    expect(interpolatedRuns(yaml)).toEqual([]);
  });

  it.each([
    ["an ssh clone URL", `git clone git@github.com:${personalAccount}/example.git`],
    ["an https URL", `see https://github.com/${personalAccount}/example/blob/main/x.md`],
  ])("finds %s of a personal-account repository", (_case, text) => {
    // Act & Assert
    expect(namesPersonalRepository(text)).toBe(true);
  });

  it.each([
    ["a repository that repo-links.json does not list", `https://github.com/${personalAccount}/skkuverse-web`],
    ["the umbrella repository", `https://github.com/${personalAccount}/skkuverse`],
    ["a repository whose name extends a public one", `git@github.com:${personalAccount}/${repoLinks.public[0]}-extra.git`],
    ["a repository whose name extends a public one with a dot", `https://github.com/${personalAccount}/${repoLinks.public[0]}.evil`],
    ["a public repository next to a private one", `https://github.com/${personalAccount}/${repoLinks.public[0]} https://github.com/${personalAccount}/skkuverse-web`],
    ["a private repository whose account is in other letter case", `https://github.com/${personalAccount.toUpperCase()}/skkuverse-web`],
  ])("finds %s on the personal account", (_case, text) => {
    // Act & Assert
    expect(namesPersonalRepository(text)).toBe(true);
  });

  it("finds a public repository of the personal account once repo-links.json names another owner", () => {
    // Arrange
    const text = `https://github.com/${personalAccount}/${repoLinks.public[0]}`;

    // Act & Assert
    expect(namesPersonalRepository(text, { owner: "someone-else", public: repoLinks.public })).toBe(true);
  });

  it.each([
    ["a public repository's advisory form", `https://github.com/${repoLinks.owner}/${repoLinks.public[0]}/security/advisories/new`],
    ["a clone URL of a public repository", `git clone git@github.com:${repoLinks.owner}/${repoLinks.public[1]}.git`],
    ["a public repository in other letter case", `https://github.com/${repoLinks.owner.toUpperCase()}/${repoLinks.public[2]!.toUpperCase()}`],
  ])("passes %s at the configured owner", (_case, text) => {
    // Act & Assert
    expect(namesPersonalRepository(text)).toBe(false);
  });

  it("finds a security-events write grant, and reads a job's own permissions as sorted entries", () => {
    // Arrange
    const yaml = [
      "name: Mutant",
      "jobs:",
      "  upload:",
      "    permissions:",
      "      security-events: write",
      "      # a comment between entries",
      "      contents: read",
      "    steps:",
      "      - run: echo",
      "",
    ].join("\n");
    const [, body = ""] = [...jobBlocks(yaml)][0] ?? [];

    // Act & Assert
    expect(grantsSecurityEventsWrite(yaml)).toBe(true);
    expect(grantsSecurityEventsWrite("      security-events: read")).toBe(false);
    expect(grantsSecurityEventsWrite("      # security-events: write")).toBe(false);
    expect(jobPermissions(body)).toEqual(["contents: read", "security-events: write"]);
  });

  it("finds an extra disjunct without the author_association check, even on a gated line", () => {
    // Arrange
    // M2: one gated line, one ungated disjunct.
    const condition = `${GATED_IF("issue_comment", "comment")} || (github.event_name == 'issues')`;

    // Act & Assert
    expect(ungatedDisjuncts(condition)).toEqual(["(github.event_name == 'issues')"]);
  });

  it("finds a check that is not a conjunct of its disjunct", () => {
    // Arrange
    const gate = `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)`;

    // Act & Assert
    expect(ungatedDisjuncts(`github.event_name == 'issue_comment' && (${gate} || true)`)).toHaveLength(1);
    expect(ungatedDisjuncts(`github.event_name == 'issue_comment' && !${gate}`)).toHaveLength(1);
    expect(ungatedDisjuncts(`(github.event_name == 'issue_comment' || github.event_name == 'issues') && ${gate}`)).toEqual([]);
  });

  it("finds a job that does not hold the gate itself, whatever it needs", () => {
    // Arrange
    const yaml = (...secondJob: string[]) =>
      [
        "on:",
        "  issue_comment:",
        "jobs:",
        "  read:",
        "    if: |",
        `      ${GATED_IF("issue_comment", "comment")}`,
        "    runs-on: ubuntu-latest",
        ...secondJob,
        "",
      ].join("\n");
    const second = (...lines: string[]) => ["  second:", "    needs: read", ...lines, "    runs-on: ubuntu-latest"];

    // Act & Assert
    expect(ungatedJobs(yaml())).toEqual([]);
    expect(ungatedJobs(yaml(...second()))).toEqual(["second"]);
    expect(ungatedJobs(yaml(...second("    if: needs.read.result == 'success'")))).toEqual(["second"]);
    expect(ungatedJobs(yaml(...second("    if: always() && needs.read.result == 'success'")))).toEqual(["second"]);
    expect(ungatedJobs(yaml(...second("    if: github.event_name == 'issue_comment'")))).toEqual(["second"]);
  });
});

describe(".github/workflows on a public repository", () => {
  it("use pull_request_target only in owner-gate.yml", () => {
    // Act
    const users = files.filter((f) => /pull_request_target/.test(workflow(f)));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(users).toEqual(["owner-gate.yml"]);
  });

  it("set a read-only or empty default for the token at the top of each workflow", () => {
    // Act
    const defaults = Object.fromEntries(files.map((f) => [f, topLevelPermissions(workflow(f))]));

    // Assert
    for (const f of files) expect([f, defaults[f]]).toEqual([f, expect.stringMatching(/^(\{\}|contents: read)$/)]);
  });

  it("read secrets only in claude.yml", () => {
    // Act
    const readers = files.filter((f) => readsSecret(workflow(f)));

    // Assert
    expect(readers.filter((f) => !SECRET_HOLDERS.includes(f))).toEqual([]);
  });

  it("use an environment only in the workflows that hold a secret", () => {
    // Act
    const users = files.filter((f) => usesEnvironment(workflow(f)));

    // Assert
    expect(users).toEqual(SECRET_HOLDERS);
  });

  it("grant contents: write in no workflow", () => {
    // Act
    const writers = files.filter((f) => grantsWrite(workflow(f)));

    // Assert
    expect(writers).toEqual([]);
  });

  it("grant security-events: write in no workflow", () => {
    // Act
    const writers = files.filter((f) => grantsSecurityEventsWrite(workflow(f)));

    // Assert
    expect(writers).toEqual([]);
  });

  it("pass expressions to run scripts only through env:", () => {
    // Act
    const found = files.flatMap((f) => interpolatedRuns(workflow(f)).map((hit) => `${f}:${hit}`));

    // Assert
    expect(found).toEqual([]);
  });
});

describe(".github/", () => {
  it("names no repository of the maintainer's personal account but the public ones", () => {
    // Arrange
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );

    // Act
    const naming = walk(".github").filter((f) => namesPersonalRepository(read(f)));

    // Assert
    expect(naming).toEqual([]);
  });
});

describe("ci.yml", () => {
  const ci = workflow("ci.yml");

  it("reads no secret and clones no other repository", () => {
    // Assert
    expect(readsSecret(ci)).toBe(false);
    expect(ci).not.toMatch(/git clone|git@github\.com/);
  });

  it("runs the contract and conventions checks from the vendored copies, through scripts/check-ci.sh", () => {
    // Arrange
    const checks = read("scripts/check-ci.sh");

    // Assert
    expect(ci).toMatch(/check-cmd: "npm run check:ci"/);
    expect(checks).toMatch(/^step contracts python3 \.github\/contract-tools\/exported\/sync_contracts\.py check --repo server --root \.$/m);
    expect(checks).toMatch(/python3 \.github\/contract-tools\/exported\/lint_conventions\.py --root \./);
    expect(checks).not.toMatch(/git clone|git@github\.com/);
  });
});

describe("the vendored contract tools", () => {
  it("are hash-locked in .contracts.lock.json at the paths scripts/check-ci.sh runs", () => {
    // Arrange
    const lock = JSON.parse(read(".contracts.lock.json")) as { contracts: Record<string, { path: string }> };

    // Act
    const paths = Object.values(lock.contracts).map((c) => c.path);

    // Assert
    expect(paths).toEqual(
      expect.arrayContaining([
        ".github/contract-tools/exported/sync_contracts.py",
        ".github/contract-tools/exported/lint_conventions.py",
        ".github/contract-tools/contracts/manifest.json",
      ]),
    );
  });
});

describe("claude.yml", () => {
  const claude = workflow("claude.yml");
  const jobs = jobBlocks(claude);
  const answer = jobs.get("answer") ?? "";
  const post = jobs.get("post") ?? "";
  const runsClaude = (body: string) => /^ +uses: anthropics\/claude-code-action@/m.test(body);

  it("has an ack, an answer and a post job, each starting only for an OWNER, MEMBER or COLLABORATOR, for every event it listens to", () => {
    // Assert
    expect(triggerNames(claude).length).toBeGreaterThan(0);
    expect([...jobs.keys()]).toEqual(["ack", "answer", "post"]);
    expect(ungatedJobs(claude)).toEqual([]);
    expect(eventsWithoutGate(claude)).toEqual([]);
  });

  it("reads its secret only in the job that holds the gate, never at the workflow level", () => {
    // Arrange
    const [workflowLevel = ""] = claude.split("\njobs:\n");
    const readers = [...jobs].filter(([, body]) => readsSecret(body)).map(([name]) => name);

    // Assert
    expect(readsSecret(workflowLevel)).toBe(false);
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((name) => ungatedJobs(claude).includes(name))).toEqual([]);
  });

  it("holds no token that can push: no id-token permission and no `@claude edit` mode", () => {
    // Assert
    expect(claude).not.toMatch(/id-token/);
    expect(claude).not.toMatch(/@claude\s+edit/i);
  });

  it("runs Claude only in answer, on a token that reads, and writes only from the jobs that run no Claude", () => {
    // Act
    const claudeJobs = [...jobs].filter(([, body]) => runsClaude(body)).map(([name]) => name);

    // Assert
    expect(claudeJobs).toEqual(["answer"]);
    expect(jobPermissions(answer)).toEqual(["actions: read", "contents: read", "issues: read", "pull-requests: read"]);
    expect(jobPermissions(jobs.get("ack") ?? "")).toEqual(["issues: write"]);
    expect(jobPermissions(post)).toEqual(["issues: write"]);
  });

  it("runs the action on the job's own token, with the user settings alone, and scrubs subprocess environments", () => {
    // Arrange
    const actionSteps = answer.match(/^ +uses: anthropics\/claude-code-action@/gm) ?? [];
    const ownTokens = answer.match(/^ {10}github_token: \$\{\{ github\.token \}\}$/gm) ?? [];

    // Assert
    expect(actionSteps.length).toBeGreaterThan(0);
    expect(ownTokens).toHaveLength(actionSteps.length);
    expect(answer).toMatch(/^ {6}CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"$/m);
    expect(answer).toMatch(/^ {12}--setting-sources user$/m);
  });

  it("sandboxes Claude's commands without network or GitHub tokens, and keeps it out of .git/config and the git forms that read or write other files", () => {
    // Act
    const settings = JSON.parse(/^ {10}settings: \|\n((?: {12}.*\n)+)/m.exec(answer)?.[1] ?? "{}");

    // Assert
    expect(settings.permissions).toMatchObject({ defaultMode: "dontAsk", blockReadsOutsideWorkingDirectories: true });
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Read(.git/config)", "Bash(*--output*)", "Bash(*--no-index*)", "Edit", "Write", "WebFetch", "Bash(gh *)"]),
    );
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      network: { allowedDomains: [], strictAllowlist: true },
    });
    expect(settings.sandbox.credentials.envVars).toEqual(
      expect.arrayContaining([
        { name: "GH_TOKEN", mode: "deny" },
        { name: "GITHUB_TOKEN", mode: "deny" },
      ]),
    );
  });

  it("posts to the thread the event names, never to one the answer names", () => {
    // Assert
    expect(post).toMatch(/^ {10}NUMBER: \$\{\{ github\.event\.issue\.number \}\}$/m);
    expect(post).toMatch(/gh api "repos\/\$REPO\/issues\/\$NUMBER\/comments"/);
  });

  // WHY: the runner image loads Ubuntu's bwrap-userns-restrict AppArmor profile, whose unpriv_bwrap child profile
  // strips the capabilities the sandbox's seccomp helper needs, so every sandboxed command failed before it started.
  it("replaces Ubuntu's bubblewrap profile and checks a nested user namespace before Claude runs", () => {
    // Arrange
    const steps = answer.split(/^ {6}- /m);
    const install = steps.findIndex((step) => /^name: Install the sandbox$/m.test(step));
    const run = steps.findIndex((step) => /^ {8}uses: anthropics\/claude-code-action@/m.test(step));

    // Assert
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(run);
    expect(steps[install]).toMatch(/^ {10}profile bwrap \/usr\/bin\/bwrap flags=\(unconfined\) \{$/m);
    expect(steps[install]).toMatch(/^ {10}sudo apparmor_parser --replace \/etc\/apparmor\.d\/bwrap$/m);
    expect(steps[install]).toMatch(/^ {10}bwrap .*--unshare-user .* -- unshare --user --map-root-user true$/m);
  });

  // WHY: the action's Agent SDK run starts in the default mode whatever permissions.defaultMode says.
  it("starts Claude in dontAsk mode from the command line", () => {
    // Assert
    expect(answer).toMatch(/^ {12}--permission-mode dontAsk$/m);
  });

  it("keeps its secret in the `claude` environment", () => {
    // Assert
    expect(answer).toMatch(/^ {4}environment: claude$/m);
  });

  // WHY: the `claude` environment admits only the default branch. An issue comment runs there, while a review or a
  // review comment runs on the pull request's merge ref and would start without the secret.
  it("listens only to issue comments", () => {
    // Assert
    expect(triggerNames(claude)).toEqual(["issue_comment"]);
  });
});
