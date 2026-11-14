/**
 * Every external action a workflow runs is pinned to a commit, and Dependabot
 * keeps the pins current (PR 234 F13):
 *
 *   - each `uses:` in `.github/workflows/*.yml` is a local `./…` workflow or
 *     `<owner>/<repo>[/<path>]@<40 hex>` followed by `# v<version>`, so a tag
 *     moved upstream cannot change what runs, and a reader still sees which
 *     release it is;
 *   - `.github/dependabot.yml` updates the `github-actions` pins monthly, as one
 *     grouped pull request into `dev`, once a release is 5 days old, and takes
 *     npm security updates only, which GitHub opens against `main`
 *     (docs/cicd-and-branch-protection.md, "Dependabot security updates").
 *
 *   - a `docker://` step names its image as `@sha256:<64 hex>` followed by
 *     `# v<version>`, and an action whose action.yaml runs its image by tag
 *     (`RUNS_IMAGE_BY_TAG`) is not used: its commit pin would leave the image
 *     it executes unpinned. Dependabot skips `docker://` steps, so a bump
 *     changes the digest and the version comment together;
 *   - no workflow names a floating release (`latest`). The workflow linters
 *     are downloaded by checks.yml, which pins each by version and by the
 *     sha256 of its release archive.
 *
 * Patterns rather than a YAML parser: the repo avoids the dependency.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const WORKFLOWS = ".github/workflows";
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+)*$/;
const PINNED_IMAGE = /^docker:\/\/[\w.-]+(?:\/[\w.-]+)*@sha256:[0-9a-f]{64} # v\d+(?:\.\d+)*$/;

/** Actions whose action.yaml runs a container image by tag, so the commit pin on the action leaves the image unpinned. */
const RUNS_IMAGE_BY_TAG = ["ossf/scorecard-action"];

/**
 * `<line>: <uses value>` for each `uses:` that is neither local, nor pinned to a SHA with its version, nor a
 * `docker://` image pinned to a digest with its version, and for each action that runs its own image by tag.
 */
export function unpinnedUses(yaml: string): string[] {
  return yaml.split("\n").flatMap((line, i) => {
    const value = /^\s*(?:-\s+)?uses:\s*(.*?)\s*$/.exec(line)?.[1];
    if (value === undefined || value.startsWith("./") || PINNED_IMAGE.test(value)) return [];
    if (PINNED.test(value) && !RUNS_IMAGE_BY_TAG.some((action) => value.startsWith(`${action}@`))) return [];
    return [`${i + 1}: ${value}`];
  });
}

describe("workflow pin rule applies as specified", () => {
  const DIGEST = "1e1481c65fc2407d3fd6ab18a23c741eb4d1c0d9359ebafc4b3ab13aa61d8627";

  it.each([
    ["a tag", "      - uses: actions/checkout@v4"],
    ["a branch", "        uses: foo/bar@main"],
    ["a short SHA", "      - uses: actions/checkout@11d5960 # v4.4.0"],
    ["a SHA without its version", "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262"],
    ["a docker image", "      - uses: docker://alpine:3.20"],
    ["a docker image by tag, even with a version comment", "      - uses: docker://ghcr.io/ossf/scorecard-action:v2.5.0 # v2.5.0"],
    ["a docker image by a short digest", "      - uses: docker://ghcr.io/ossf/scorecard-action@sha256:1e1481c6 # v2.5.0"],
    ["a docker image by digest without its version", `      - uses: docker://ghcr.io/ossf/scorecard-action@sha256:${DIGEST}`],
    [
      "an action that runs its image by tag",
      "      - uses: ossf/scorecard-action@fa7117db83c52d787ae5a89f350999701505d78e # v2.5.0",
    ],
  ])("refuses %s", (_case, line) => {
    // Act & Assert
    expect(unpinnedUses(line)).toHaveLength(1);
  });

  it("passes a SHA pin with its version, a sub-path action, a digest-pinned image and a local workflow", () => {
    // Arrange
    const yaml = [
      "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
      "        uses: github/codeql-action/init@0123456789abcdef0123456789abcdef01234567 # v3",
      `        uses: docker://ghcr.io/ossf/scorecard-action@sha256:${DIGEST} # v2.5.0`,
      "    uses: ./.github/workflows/reusable.yml",
      "      - run: echo uses: nothing",
    ].join("\n");

    // Act & Assert
    expect(unpinnedUses(yaml)).toEqual([]);
  });
});

describe(".github/workflows", () => {
  it("pin every external action to a commit SHA and every docker:// image to a digest, each with its version", () => {
    // Arrange
    const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));

    // Act
    const unpinned = files.flatMap((f) => unpinnedUses(fs.readFileSync(path.join(root, WORKFLOWS, f), "utf8")).map((u) => `${f}:${u}`));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(unpinned).toEqual([]);
  });
});

describe(".github/workflows, for floating releases", () => {
  it("name no floating release", () => {
    // Arrange
    const files = fs.readdirSync(path.join(root, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));

    // Act
    const floating = files.filter((f) => /releases\/latest|\/latest\/download|@latest/.test(fs.readFileSync(path.join(root, WORKFLOWS, f), "utf8")));

    // Assert
    expect(files.length).toBeGreaterThan(0);
    expect(floating).toEqual([]);
  });
});

describe(".github/dependabot.yml", () => {
  /** Each `- package-ecosystem:` entry of `updates`, in file order, with its comment lines dropped. */
  function ecosystemBlocks(): Array<[string, string]> {
    const config = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8").replace(/^\s*#.*\n/gm, "");
    return config
      .split(/^(?=\s*- package-ecosystem: )/m)
      .slice(1)
      .map((block) => [/^\s*- package-ecosystem: (\S+)$/m.exec(block)?.[1] ?? "", block]);
  }

  it("takes github-actions version updates monthly into dev and npm security updates only, with no target branch", () => {
    // Act
    const blocks = ecosystemBlocks();
    const [actions, npm] = blocks.map(([, block]) => block);

    // Assert
    expect(blocks.map(([ecosystem]) => ecosystem)).toEqual(["github-actions", "npm"]);
    expect(actions).toMatch(/^ {4}schedule:\n {6}interval: monthly$/m);
    expect(actions).toMatch(/^ {4}target-branch: dev$/m);
    expect(actions).toMatch(/^ {4}groups:\n {6}github-actions:\n {8}patterns:\n {10}- "\*"$/m);
    expect(npm).toMatch(/^ {4}directory: \/$/m);
    expect(npm).toMatch(/^ {4}open-pull-requests-limit: 0$/m);
    expect(npm).toMatch(/^ {4}groups:\n {6}nestjs:\n {8}applies-to: security-updates\n {8}patterns:\n {10}- "@nestjs\/\*"$/m);
    expect(npm).not.toMatch(/target-branch/);
    expect(blocks.filter(([, block]) => /target-branch/.test(block)).map(([ecosystem]) => ecosystem)).toEqual(["github-actions"]);
  });

  it("proposes a github-actions release only once it is 5 days old, as npm installs wait (min-release-age=5)", () => {
    // Act
    const [[, actions = ""] = []] = ecosystemBlocks();

    // Assert
    expect(actions).toMatch(/^ {4}cooldown:\n {6}default-days: 5$/m);
  });
});
