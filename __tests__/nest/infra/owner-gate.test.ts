/**
 * owner-gate.yml judges a pull request to main against .github/owner-gate-paths, and the pull request must not be
 * able to change that judgment:
 *
 *   - it runs on `pull_request_target` alone, to main, on opened, synchronize, reopened, labeled and unlabeled, so the
 *     definition that runs is the one on main;
 *   - it has no checkout step, so no code from the pull request reaches the runner;
 *   - its token has no default, and its one job holds `pull-requests: write` and at most `contents: read`;
 *   - the list names exactly the files the owner reviews.
 *
 * Patterns rather than a YAML parser: the repo has no parser dependency. The rules are tested on the mutants they
 * exist to catch, then on the real file.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const TYPES = ["opened", "synchronize", "reopened", "labeled", "unlabeled"];
const ALLOWED_JOB_PERMISSIONS = [["pull-requests: write"], ["contents: read", "pull-requests: write"]];

const yamlLines = (yaml: string) => yaml.split("\n").filter((line) => !/^\s*#/.test(line));
const withoutTrailingComment = (line: string) => line.replace(/\s+#.*$/, "");

/** The top-level `on:` block's event names, and the `types:` and `branches:` lists of `pull_request_target`. */
export function triggerShape(yaml: string): { events: string[]; types: string[]; branches: string[] } {
  const block = /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1] ?? "";
  const list = (key: string) =>
    /\[(.*)\]/.exec(new RegExp(`^ {4}${key}: (.*)$`, "m").exec(block)?.[0] ?? "")?.[1]?.split(",").map((v) => v.trim()) ?? [];
  return {
    events: [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]!),
    types: list("types"),
    branches: list("branches"),
  };
}

/** Each step that checks out code, however the action is spelled. */
export const checkoutSteps = (yaml: string) => yamlLines(yaml).filter((line) => /\buses:\s*\S*checkout/i.test(line) || /\bgit\s+(clone|fetch|checkout|pull)\b/.test(line));

/** The top-level `permissions:` value. */
export const topPermissions = (yaml: string) => /^permissions:(.*)$/m.exec(yaml)?.[1]?.trim();

/** A job's own `permissions:` entries, sorted. */
export function jobPermissions(yaml: string): string[] {
  const block = /^ {4}permissions:\n((?: {6}.*\n)*)/m.exec(yaml)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => withoutTrailingComment(line).trim())
    .filter((line) => line !== "")
    .sort();
}

/** The reasons a workflow is not the owner gate as specified; empty when it is. */
export function gateProblems(yaml: string): string[] {
  const problems: string[] = [];
  const shape = triggerShape(yaml);
  if (shape.events.join(",") !== "pull_request_target") problems.push(`events: ${shape.events.join(", ")}`);
  if (shape.types.join(",") !== TYPES.join(",")) problems.push(`types: ${shape.types.join(", ")}`);
  if (shape.branches.join(",") !== "main") problems.push(`branches: ${shape.branches.join(", ")}`);
  if (checkoutSteps(yaml).length > 0) problems.push("a step checks out code");
  if (topPermissions(yaml) !== "{}") problems.push(`top-level permissions: ${topPermissions(yaml)}`);
  const granted = jobPermissions(yaml);
  if (!ALLOWED_JOB_PERMISSIONS.some((allowed) => allowed.join(",") === granted.join(","))) problems.push(`job permissions: ${granted.join(", ")}`);
  return problems;
}

const GOOD = [
  "name: Owner gate",
  "on:",
  "  pull_request_target: # zizmor: ignore[dangerous-triggers] reason",
  "    branches: [main]",
  "    types: [opened, synchronize, reopened, labeled, unlabeled]",
  "permissions: {}",
  "jobs:",
  "  gate:",
  "    runs-on: ubuntu-latest",
  "    permissions:",
  "      pull-requests: write",
  "    steps:",
  "      - run: echo",
  "",
].join("\n");

describe("the owner gate rules apply as specified", () => {
  const mutate = (from: string, to: string) => GOOD.replace(from, to);

  it("passes the gate as specified, with or without contents: read", () => {
    // Act & Assert
    expect(gateProblems(GOOD)).toEqual([]);
    expect(gateProblems(mutate("      pull-requests: write\n", "      contents: read\n      pull-requests: write\n"))).toEqual([]);
  });

  it.each([
    ["pull_request instead of pull_request_target", mutate("pull_request_target:", "pull_request:")],
    ["a second event", mutate("permissions: {}", "  push:\npermissions: {}")],
    ["a missing label type", mutate(", unlabeled]", "]")],
    ["a base other than main", mutate("[main]", "[main, dev]")],
    ["a checkout step", mutate("      - run: echo", "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v1\n      - run: echo")],
    ["a clone in a script", mutate("      - run: echo", "      - run: git clone https://example.test/x")],
    ["a write default for the token", mutate("permissions: {}", "permissions: write-all")],
    ["contents: write", mutate("      pull-requests: write\n", "      contents: write\n      pull-requests: write\n")],
    ["no pull-requests: write", mutate("      pull-requests: write\n", "      contents: read\n")],
    ["an extra permission", mutate("      pull-requests: write\n", "      issues: write\n      pull-requests: write\n")],
  ])("refuses %s", (_case, yaml) => {
    // Act & Assert
    expect(gateProblems(yaml)).not.toEqual([]);
  });
});

describe(".github/workflows/owner-gate.yml", () => {
  it("is the owner gate as specified", () => {
    // Act & Assert
    expect(gateProblems(read(".github/workflows/owner-gate.yml"))).toEqual([]);
  });
});

describe(".github/owner-gate-paths", () => {
  it("lists the files the owner reviews, one pattern per line", () => {
    // Act
    const patterns = read(".github/owner-gate-paths").split("\n").filter((line) => line !== "");

    // Assert
    expect(patterns).toEqual([
      "Dockerfile",
      "docker-compose.yml",
      "scripts/render_env.py",
      "config/env.prd.keys",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".github/owner-gate-paths",
      ".github/workflows/owner-gate.yml",
    ]);
  });
});
