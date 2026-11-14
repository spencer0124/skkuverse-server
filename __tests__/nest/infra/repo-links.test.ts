/**
 * Every link to a skkuverse repository on GitHub names the owner that
 * repo-links.json holds and a repository on its `public` list. Moving the
 * repositories to another owner is one edit to that file, and the failure
 * prints the command that rewrites each link to match.
 *
 * The scan reads each text file `git ls-files` lists and finds the https form
 * of a repository link, the `git@` clone form and the `github.io` Pages form,
 * where the repository name starts with `skkuverse`. A link to a repository
 * outside `public` fails under any owner, because a public repository must
 * not send its readers to a private one.
 *
 * Every case builds its URLs around a variable owner. A literal URL that the
 * scan rejects would sit in this tracked file and fail the scan on its own
 * cases.
 */
import { execFileSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";

const root = path.join(__dirname, "../../..");

const RepoLinksSchema = z.strictObject({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
  public: z.array(z.string().regex(/^skkuverse[A-Za-z0-9_-]*$/)).min(1),
});
type RepoLinks = z.infer<typeof RepoLinksSchema>;

interface SourceFile {
  file: string;
  text: string;
}

interface Hit {
  line: number;
  url: string;
  owner: string;
  repo: string;
}

const parseRepoLinks = (text: string): RepoLinks => RepoLinksSchema.parse(JSON.parse(text));

const GITHUB_LINK = /github\.com[:/]([A-Za-z0-9-]+)\/(skkuverse[\w.-]*)/gi;
const PAGES_LINK = /([A-Za-z0-9-]+)\.github\.io\/(skkuverse[\w.-]*)/gi;

const repoName = (token: string) => token.replace(/\.+$/, "").replace(/\.git$/i, "").toLowerCase();

function linkHits(text: string): Hit[] {
  return text.split("\n").flatMap((lineText, i) =>
    [GITHUB_LINK, PAGES_LINK].flatMap((pattern) =>
      [...lineText.matchAll(pattern)].map((m) => ({ line: i + 1, url: m[0].replace(/\.+$/, ""), owner: m[1]!, repo: repoName(m[2]!) })),
    ),
  );
}

/** No backslash: Jest prints a failure with each backslash doubled, and a copied `\\.` matches nothing. */
function rewriteCommand(links: RepoLinks, oldOwners: readonly string[]): string {
  const old = oldOwners.length === 1 ? oldOwners[0]! : `(?:${oldOwners.join("|")})`;
  const names = `(${links.public.join("|")})(?![A-Za-z0-9_-])`;
  const https = `s#github[.]com([:/])${old}/${names}#github.com\${1}${links.owner}/\${2}#gi`;
  const pages = `s#(?<![A-Za-z0-9-])${old}[.]github[.]io/${names}#${links.owner}.github.io/\${1}#gi`;
  return `git ls-files -z | xargs -0 perl -pi -e '${https}; ${pages}'`;
}

const REWRITE = "Rewrite each link to a public repository with: ";
const REMOVE = "Remove each link to a repository outside public, or add the repository to public when it is public.";

function linkReport(files: readonly SourceFile[], links: RepoLinks): string[] {
  const owner = links.owner.toLowerCase();
  const publicNames = new Set(links.public.map((name) => name.toLowerCase()));
  const lines: string[] = [];
  const staleOwners = new Set<string>();
  let outsidePublic = false;
  for (const { file, text } of files) {
    for (const hit of linkHits(text)) {
      const ownerHolds = hit.owner.toLowerCase() === owner;
      const repoIsPublic = publicNames.has(hit.repo);
      if (ownerHolds && repoIsPublic) continue;
      const reasons = [ownerHolds ? "" : `owner is not ${links.owner}`, repoIsPublic ? "" : `${hit.repo} is not in public`];
      lines.push(`${file}:${hit.line}: ${hit.url} (${reasons.filter(Boolean).join(", ")})`);
      if (repoIsPublic) staleOwners.add(hit.owner);
      else outsidePublic = true;
    }
  }
  if (staleOwners.size > 0) lines.push(REWRITE + rewriteCommand(links, [...staleOwners]));
  if (outsidePublic) lines.push(REMOVE);
  return lines;
}

function trackedTextFiles(): SourceFile[] {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return listed
    .split("\0")
    .filter((file) => file !== "")
    .flatMap((file) => {
      const bytes = readUnlessDeleted(path.join(root, file));
      return bytes === undefined || bytes.includes(0) ? [] : [{ file, text: bytes.toString("utf8") }];
    });
}

function readUnlessDeleted(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

const LINKS: RepoLinks = { owner: "acme", public: ["skkuverse-server", "skkuverse-app"] };
const OWNER = LINKS.owner;
const OTHER = "someone-else";

const lineFor = (text: string) => linkReport([{ file: "a.md", text }], LINKS);

describe("repo-links.json", () => {
  it.each([
    ["no owner", { public: ["skkuverse-app"] }],
    ["an owner that is a path", { owner: "acme/skkuverse-app", public: ["skkuverse-app"] }],
    ["no public repository", { owner: OWNER, public: [] }],
    ["a public name outside the skkuverse family", { owner: OWNER, public: ["example"] }],
    ["an unknown key", { owner: OWNER, public: ["skkuverse-app"], private: ["skkuverse"] }],
  ])("rejects %s", (_case, config) => {
    // Act & Assert
    expect(() => parseRepoLinks(JSON.stringify(config))).toThrow();
  });
});

describe("a link to a skkuverse repository", () => {
  it.each([
    ["an https link to a public repository at the owner", `https://github.com/${OWNER}/skkuverse-server/blob/dev/README.md`],
    ["a clone URL with .git", `git@github.com:${OWNER}/skkuverse-app.git`],
    ["a Pages link", `https://${OWNER}.github.io/skkuverse-app/`],
    ["a link that ends a sentence", `Read https://github.com/${OWNER}/skkuverse-server.`],
    ["the owner and repository in other letter case", `https://github.com/${OWNER.toUpperCase()}/Skkuverse-Server`],
    ["a repository outside the skkuverse family", `https://github.com/${OTHER}/example`],
  ])("passes %s", (_case, text) => {
    // Act & Assert
    expect(lineFor(text)).toEqual([]);
  });

  it.each([
    ["a wrong owner", `see https://github.com/${OTHER}/skkuverse-server`, `github.com/${OTHER}/skkuverse-server`, `owner is not ${OWNER}`],
    [
      "a wrong owner in other letter case",
      `see https://github.com/${OTHER.toUpperCase()}/SKKUVERSE-SERVER`,
      `github.com/${OTHER.toUpperCase()}/SKKUVERSE-SERVER`,
      `owner is not ${OWNER}`,
    ],
    ["a wrong owner in a clone URL",`git@github.com:${OTHER}/skkuverse-app.git`, `github.com:${OTHER}/skkuverse-app.git`, `owner is not ${OWNER}`],
    ["a wrong owner in a Pages link", `https://${OTHER}.github.io/skkuverse-app/`, `${OTHER}.github.io/skkuverse-app`, `owner is not ${OWNER}`],
    ["a private repository", `https://github.com/${OWNER}/skkuverse`, `github.com/${OWNER}/skkuverse`, "skkuverse is not in public"],
    [
      "a private repository at the end of a sentence",
      `Read https://github.com/${OWNER}/skkuverse.`,
      `github.com/${OWNER}/skkuverse`,
      "skkuverse is not in public",
    ],
    ["a private repository in a Pages link", `https://${OWNER}.github.io/skkuverse-web/`, `${OWNER}.github.io/skkuverse-web`, "skkuverse-web is not in public"],
    [
      "a repository whose name starts with a public name",
      `https://github.com/${OWNER}/skkuverse-server-extra`,
      `github.com/${OWNER}/skkuverse-server-extra`,
      "skkuverse-server-extra is not in public",
    ],
    [
      "a repository whose name extends a public name with a dot",
      `https://github.com/${OWNER}/skkuverse-app.evil`,
      `github.com/${OWNER}/skkuverse-app.evil`,
      "skkuverse-app.evil is not in public",
    ],
    [
      "a wrong owner and a private repository",
      `https://github.com/${OTHER}/skkuverse-web`,
      `github.com/${OTHER}/skkuverse-web`,
      `owner is not ${OWNER}, skkuverse-web is not in public`,
    ],
  ])("fails %s", (_case, text, url, reason) => {
    // Act
    const report = lineFor(text);

    // Assert
    expect(report[0]).toBe(`a.md:1: ${url} (${reason})`);
  });

  it("names the line of each link, across files", () => {
    // Arrange
    const files = [
      { file: "docs/a.md", text: `fine\nsee https://github.com/${OWNER}/skkuverse-app\nand https://github.com/${OTHER}/skkuverse-app` },
      { file: "b.yml", text: `url: https://${OTHER}.github.io/skkuverse-server/` },
    ];

    // Act
    const hits = linkReport(files, LINKS).filter((line) => /^\S+:\d+: /.test(line));

    // Assert
    expect(hits.map((line) => line.split(" ")[0])).toEqual(["docs/a.md:3:", "b.yml:1:"]);
  });

  it("asks for a rewrite when a public repository sits at a wrong owner, and for a removal when a private one does", () => {
    // Act
    const stale = lineFor(`https://github.com/${OTHER}/skkuverse-app`);
    const privateRepo = lineFor(`https://github.com/${OWNER}/skkuverse`);

    // Assert
    expect(stale.at(-1)).toBe(REWRITE + rewriteCommand(LINKS, [OTHER]));
    expect(stale).not.toContain(REMOVE);
    expect(privateRepo.at(-1)).toBe(REMOVE);
    expect(privateRepo.some((line) => line.startsWith(REWRITE))).toBe(false);
  });
});

describe("the printed rewrite command", () => {
  it("moves every link to a public repository to the configured owner, leaves every other line alone, and leaves nothing to rewrite", () => {
    // Arrange
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-links-"));
    const before: Record<string, string> = {
      "a.md": [
        `[readme](https://github.com/${OTHER}/skkuverse-server/blob/dev/README.md) and https://${OTHER}.github.io/skkuverse-app/`,
        `the umbrella is https://github.com/${OTHER}/skkuverse`,
        "an unrelated line",
      ].join("\n"),
      "b.sh": `git clone git@github.com:${OTHER}/skkuverse-app.git\ngit clone https://github.com/${OTHER}/skkuverse-server-extra\n`,
    };
    const printed = linkReport(Object.entries(before).map(([file, text]) => ({ file, text })), LINKS).find((line) => line.startsWith(REWRITE));

    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      for (const [file, text] of Object.entries(before)) fs.writeFileSync(path.join(dir, file), text);
      execFileSync("git", ["add", ...Object.keys(before)], { cwd: dir });

      // Act
      execFileSync("sh", ["-c", printed!.slice(REWRITE.length)], { cwd: dir });
      const after = Object.fromEntries(Object.keys(before).map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8")]));

      // Assert
      expect(after).toEqual({
        "a.md": [
          `[readme](https://github.com/${OWNER}/skkuverse-server/blob/dev/README.md) and https://${OWNER}.github.io/skkuverse-app/`,
          `the umbrella is https://github.com/${OTHER}/skkuverse`,
          "an unrelated line",
        ].join("\n"),
        "b.sh": `git clone git@github.com:${OWNER}/skkuverse-app.git\ngit clone https://github.com/${OTHER}/skkuverse-server-extra\n`,
      });
      expect(linkReport(Object.entries(after).map(([file, text]) => ({ file, text })), LINKS).every((line) => !line.startsWith(REWRITE))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the tracked tree", () => {
  it("links to skkuverse repositories only at the configured owner and only to public ones", () => {
    // Arrange
    const links = parseRepoLinks(fs.readFileSync(path.join(root, "repo-links.json"), "utf8"));
    const files = trackedTextFiles();

    // Act
    const report = linkReport(files, links);

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(report).toEqual([]);
  });
});
