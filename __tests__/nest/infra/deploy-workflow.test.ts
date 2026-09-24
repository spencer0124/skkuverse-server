/**
 * The deploy runs once per origin host (deploy-host.yml, called by deploy.yml),
 * and what it does on a host depends on the host's poller role in
 * /etc/skkuverse/host.env. Two failures here are silent until they hurt:
 *
 *   - hosts deployed in the wrong order, or in parallel, or a later host
 *     deployed after an earlier one failed;
 *   - a standby host starting the poller (two pollers call every external API
 *     twice) or an active host no longer updating it.
 *
 * So the workflow files are pinned by pattern (the repo avoids a YAML parser
 * dependency), and the remote script itself is cut out of deploy-host.yml and
 * run under bash with stub `git`, `docker`, `sudo`, `curl`, `sleep` and
 * `hostname` binaries first on PATH, against both roles. The stubs log their
 * arguments; nothing touches Docker, nginx or the network.
 *
 * infra/hosts/poller-role.sh, which both the deploy and the heartbeat use to
 * read the role, is tested directly at the end.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const deploy = read(".github/workflows/deploy.yml");
const deployHost = read(".github/workflows/deploy-host.yml");
const roleScript = path.join(root, "infra/hosts/poller-role.sh");

/** Two-space-indented keys under `jobs:`, each with its indented body. */
function jobBlocks(yaml: string): Map<string, string> {
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n"));
  const blocks = new Map<string, string>();
  for (const m of jobs.matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\s*\n)*)/gm)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** The `script: |` block of the SSH step, dedented. */
function remoteScript(): string {
  const lines = deployHost.split("\n");
  const start = lines.findIndex((l) => /^\s+script: \|$/.test(l));
  expect(start).toBeGreaterThan(-1);
  const keyIndent = lines[start]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join("\n");
}

describe("deploy.yml — one host at a time, oracle first", () => {
  const jobs = jobBlocks(deploy);
  const hostJobs = [...jobs].filter(([, body]) => body.includes("uses: ./.github/workflows/deploy-host.yml"));

  it("deploys exactly oracle then mnemosyne through deploy-host.yml", () => {
    expect(hostJobs.map(([name]) => name)).toEqual(["deploy-oracle", "deploy-mnemosyne"]);
    expect(hostJobs.map(([, body]) => body.match(/^ {6}host: (\S+)$/m)?.[1])).toEqual(["oracle", "mnemosyne"]);
  });

  it("each host job waits for the tests and for the host before it", () => {
    const needs = (body: string) => {
      const m = body.match(/^ {4}needs: (?:\[([^\]]*)\]|(\S+))$/m);
      expect(m).not.toBeNull();
      return (m![1] ?? m![2]!).split(",").map((n) => n.trim());
    };
    hostJobs.forEach(([, body], i) => {
      expect(needs(body)).toContain("test");
      if (i > 0) expect(needs(body)).toContain(hostJobs[i - 1]![0]);
    });
  });

  // A condition like `if: always()` would deploy after a failed host, so the
  // only condition allowed is the on/off switch for the second host — which
  // keeps the implicit success() and so still stops after a failed oracle.
  it("oracle is never gated; mnemosyne runs only when MNEMOSYNE_ENABLED is 'true'", () => {
    const ifs = (body: string) => [...body.matchAll(/^ {4}if: (.*)$/gm)].map((m) => m[1]);
    expect(ifs(jobs.get("deploy-oracle")!)).toEqual([]);
    expect(ifs(jobs.get("deploy-mnemosyne")!)).toEqual(["${{ vars.MNEMOSYNE_ENABLED == 'true' }}"]);
  });

  it("passes each host its own secrets", () => {
    const secrets = (body: string) =>
      Object.fromEntries(
        [...body.matchAll(/^ {6}([A-Z_]+): \$\{\{ secrets\.([A-Z_]+) \}\}$/gm)].map((m) => [m[1], m[2]]),
      );
    expect(secrets(jobs.get("deploy-oracle")!)).toEqual({
      VM_HOST: "ORACLE_VM_HOST",
      VM_USER: "ORACLE_VM_USER",
      SSH_PRIVATE_KEY: "SSH_PRIVATE_KEY",
    });
    expect(secrets(jobs.get("deploy-mnemosyne")!)).toEqual({
      VM_HOST: "MNEMOSYNE_VM_HOST",
      VM_USER: "MNEMOSYNE_VM_USER",
      SSH_PRIVATE_KEY: "MNEMOSYNE_SSH_PRIVATE_KEY",
    });
  });

  it("serialises whole runs, so two releases never deploy at once", () => {
    expect(deploy).toMatch(/^concurrency:\n {2}group: deploy\n {2}cancel-in-progress: false$/m);
  });

  it("does not SSH anywhere itself", () => {
    expect(deploy).not.toMatch(/ssh-action/);
  });
});

describe("deploy-host.yml", () => {
  it("only runs when called", () => {
    expect(deployHost).toMatch(/^on:\n {2}workflow_call:$/m);
    expect(deployHost).not.toMatch(/^ {2}(push|pull_request|workflow_dispatch|schedule):/m);
  });

  it("fails on an empty host secret before connecting", () => {
    const check = deployHost.indexOf("Check the host's secrets are set");
    const ssh = deployHost.indexOf("uses: appleboy/ssh-action");
    expect(check).toBeGreaterThan(-1);
    expect(ssh).toBeGreaterThan(check);
    for (const s of ["VM_HOST", "VM_USER", "SSH_PRIVATE_KEY"]) {
      expect(deployHost).toContain(`[ -n "$${s}" ] || missing="$missing ${s}"`);
    }
  });

  it("deploys into the checkout the heartbeat cron and the firewall unit run from", () => {
    const deployPath = deployHost.match(/^ {2}DEPLOY_PATH: (\S+)$/m)?.[1];
    expect(deployPath).toBeDefined();
    expect(remoteScript()).toMatch(/^cd \$\{\{ env\.DEPLOY_PATH \}\}$/m);
    const cron = read("infra/monitoring/skkuverse-heartbeat.cron");
    const unit = read("infra/firewall/skkuverse-firewall.service");
    expect(cron).toContain(` ${deployPath}/infra/monitoring/heartbeat.sh `);
    expect(unit).toMatch(new RegExp(`^ExecStart=${deployPath}/infra/firewall/cloudflare-only\\.sh$`, "m"));
  });

  it("never runs `docker compose up` without --no-deps (api replicas depend_on the poller)", () => {
    const ups = remoteScript()
      .split("\n")
      .filter((l) => /docker compose up\b/.test(l));
    expect(ups.length).toBeGreaterThan(0);
    for (const l of ups) expect(l).toMatch(/docker compose up -d --no-deps /);
  });
});

// --- The remote script, run -------------------------------------------------

const STUBS: Record<string, string> = {
  git: `#!/bin/bash
echo "git $*" >> "$STUB_DIR/log"
case "$*" in
  "rev-parse HEAD") echo prevsha ;;
  "rev-parse --short HEAD") echo newsha ;;
esac
exit 0
`,
  sudo: `#!/bin/bash
echo "sudo $*" >> "$STUB_DIR/log"
[ "$1" = nginx ] && exit "\${STUB_NGINX_EXIT:-0}"
exit 0
`,
  docker: `#!/bin/bash
echo "docker $*" >> "$STUB_DIR/log"
case "$2" in
  ps)
    case "$*" in
      *--status*) cat "$STUB_DIR/running-services" ;;
      *) echo running ;;
    esac ;;
  logs) echo "MongoDB connected" ;;
  run) exit "\${STUB_DRYLOAD_EXIT:-0}" ;;
esac
exit 0
`,
  curl: `#!/bin/bash
echo "curl $*" >> "$STUB_DIR/log"
exit "\${STUB_CURL_EXIT:-0}"
`,
  sleep: "#!/bin/bash\nexit 0\n",
  hostname: "#!/bin/bash\necho test-host\n",
};

interface DeployScenario {
  /** host.env contents; null leaves it absent. */
  hostEnv: string | null;
  /** Services `docker compose ps --status running --services` lists. */
  running?: string[];
  curlExit?: number;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "tmp"));
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, "bin", name), body, { mode: 0o755 });
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function runDeploy(s: DeployScenario) {
  const script = remoteScript().replace("${{ env.DEPLOY_PATH }}", root);
  // Any other expression would reach the host unexpanded here but expanded in
  // Actions; the test would no longer run what the host runs.
  expect(script).not.toContain("${{");
  const hostEnvPath = path.join(dir, "host.env");
  if (s.hostEnv !== null) fs.writeFileSync(hostEnvPath, s.hostEnv);
  fs.writeFileSync(path.join(dir, "running-services"), (s.running ?? []).map((l) => l + "\n").join(""));
  const res = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      PATH: `${dir}/bin:${process.env.PATH}`,
      STUB_DIR: dir,
      STUB_CURL_EXIT: String(s.curlExit ?? 0),
      HOST_ENV_FILE: hostEnvPath,
      TMPDIR: path.join(dir, "tmp"),
    },
  });
  const logPath = path.join(dir, "log");
  const calls = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean) : [];
  const docker = calls.filter((c) => c.startsWith("docker "));
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, calls, docker };
}

const ACTIVE = "POLLER_ROLE=active\n";
const STANDBY = "POLLER_ROLE=standby\n";

describe("remote deploy script — active host", () => {
  it("rolls every replica, then updates the poller last", () => {
    const r = runDeploy({ hostEnv: ACTIVE });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const ups = r.docker.filter((c) => c.startsWith("docker compose up"));
    expect(ups).toEqual([
      "docker compose up -d --no-deps api-1",
      "docker compose up -d --no-deps api-2",
      "docker compose up -d --no-deps api-3",
      "docker compose up -d --no-deps poller",
    ]);
    expect(r.docker).toContain("docker compose build api-1 api-2 api-3 poller");
    expect(r.docker).toContain("docker compose ps poller --format {{.State}}");
  });

  it("does not ask whether a poller is running (that check is for standby)", () => {
    const r = runDeploy({ hostEnv: ACTIVE, running: ["poller"] });
    expect(r.status).toBe(0);
    expect(r.docker.some((c) => c.includes("--status"))).toBe(false);
  });

  it("rolls back the replicas and the poller when a replica stays unhealthy", () => {
    const r = runDeploy({ hostEnv: ACTIVE, curlExit: 7 });
    expect(r.status).toBe(1);
    expect(r.calls).toContain("git checkout prevsha");
    expect(r.docker).toContain("docker compose up -d --no-deps api-1 api-2 api-3 poller");
  });
});

describe("remote deploy script — standby host", () => {
  it("rolls every replica and never builds, starts or checks the poller", () => {
    const r = runDeploy({ hostEnv: STANDBY });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const ups = r.docker.filter((c) => c.startsWith("docker compose up"));
    expect(ups).toEqual([
      "docker compose up -d --no-deps api-1",
      "docker compose up -d --no-deps api-2",
      "docker compose up -d --no-deps api-3",
    ]);
    expect(r.docker).toContain("docker compose build api-1 api-2 api-3");
    expect(r.docker.filter((c) => /\bpoller\b/.test(c))).toEqual([]);
    expect(r.stdout).toContain("Standby host: the poller is not deployed here.");
  });

  it("still installs nginx, the firewall unit and the heartbeat cron", () => {
    const r = runDeploy({ hostEnv: STANDBY });
    expect(r.calls).toContain("sudo nginx -t");
    expect(r.calls).toContain("sudo systemctl reload nginx");
    expect(r.calls.some((c) => c.includes("/etc/systemd/system/skkuverse-firewall.service"))).toBe(true);
    expect(r.calls.some((c) => c.includes("/etc/cron.d/skkuverse-heartbeat"))).toBe(true);
  });

  it("rolls back the replicas only", () => {
    const r = runDeploy({ hostEnv: STANDBY, curlExit: 7 });
    expect(r.status).toBe(1);
    expect(r.calls).toContain("git checkout prevsha");
    expect(r.docker).toContain("docker compose up -d --no-deps api-1 api-2 api-3");
    expect(r.docker.filter((c) => /\bpoller\b/.test(c))).toEqual([]);
  });

  it("aborts before touching the host when a poller is running there", () => {
    const r = runDeploy({ hostEnv: STANDBY, running: ["api-1", "poller"] });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/poller is running on this host, but host\.env says POLLER_ROLE=standby/);
    expect(r.calls).toContain("git checkout prevsha");
    expect(r.calls.filter((c) => c.startsWith("sudo "))).toEqual([]);
    expect(r.docker.filter((c) => !c.includes("--status"))).toEqual([]);
  });
});

describe("remote deploy script — no valid role", () => {
  it.each([
    ["missing", null],
    ["invalid", "POLLER_ROLE=primary\n"],
  ])("aborts before touching the host when host.env is %s", (_label, hostEnv) => {
    const r = runDeploy({ hostEnv });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/poller-role: /);
    expect(r.stdout).toMatch(/no valid POLLER_ROLE/);
    expect(r.calls).toEqual(["git rev-parse HEAD", "git pull origin main", "git checkout prevsha"]);
  });
});

// --- infra/hosts/poller-role.sh ----------------------------------------------

describe("infra/hosts/poller-role.sh", () => {
  const role = (contents: string | null) => {
    const file = path.join(dir, "host.env");
    if (contents !== null) fs.writeFileSync(file, contents);
    const res = spawnSync("bash", [roleScript], { encoding: "utf8", env: { PATH: process.env.PATH, HOST_ENV_FILE: file } });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  };

  it.each(["active", "standby"])("prints %s", (value) => {
    const r = role(`# role of this host\nPOLLER_ROLE=${value}\n`);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${value}\n`);
  });

  it.each([
    ["a missing file", null, /cannot read/],
    ["an unknown value", "POLLER_ROLE=leader\n", /must be active or standby, not 'leader'/],
    ["an empty value", "POLLER_ROLE=\n", /must be active or standby/],
    ["trailing whitespace", "POLLER_ROLE=active \n", /must be active or standby/],
    ["a CRLF line", "POLLER_ROLE=active\r\n", /must be active or standby/],
    ["no POLLER_ROLE line", "OTHER=1\n", /exactly once \(found 0\)/],
    ["two POLLER_ROLE lines", "POLLER_ROLE=active\nPOLLER_ROLE=active\n", /exactly once \(found 2\)/],
  ])("fails on %s, printing nothing on stdout", (_label, contents, message) => {
    const r = role(contents);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(message);
  });

  it("defaults to /etc/skkuverse/host.env", () => {
    expect(fs.readFileSync(roleScript, "utf8")).toMatch(/^FILE=\$\{HOST_ENV_FILE:-\/etc\/skkuverse\/host\.env\}$/m);
  });

  it("is executable", () => {
    expect(fs.statSync(roleScript).mode & 0o111).not.toBe(0);
  });
});
