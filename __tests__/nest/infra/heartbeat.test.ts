/**
 * infra/monitoring/heartbeat.sh decides whether Healthchecks.io hears "up" or
 * "fail" from a host every minute. A bug that pings success while a replica is
 * down silences the alert, and one that pings nothing at all looks exactly like
 * a dead VM. So the real script runs here, under bash, with stub `docker`,
 * `curl` and `hostname` binaries first on PATH. The stubs replay canned output
 * and log their arguments; nothing touches Docker or the network.
 *
 * The cron file and the deploy step that installs it are pinned at the end:
 * the script is useless if the deploy stops installing it.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const root = path.join(__dirname, "../../..");
const script = path.join(root, "infra/monitoring/heartbeat.sh");
const cronFile = path.join(root, "infra/monitoring/skkuverse-heartbeat.cron");
const PING_URL = "https://hc-ping.test/ping-key/test-host";

const SERVICES = ["poller", "api-1", "api-2", "api-3"].join("\n") + "\n";
const P = "skkumap-server-express";
const healthyCompose = [
  `${P}|api-1|running|healthy`,
  `${P}|api-2|running|healthy`,
  `${P}|api-3|running|healthy`,
  `${P}|poller|running|`,
];
const healthyDockerPs = [
  `${P}-api-1-1|running|Up 1 hour (healthy)|${P}`,
  `${P}-api-2-1|running|Up 1 hour (healthy)|${P}`,
  `${P}-api-3-1|running|Up 1 hour (healthy)|${P}`,
  `${P}-poller-1|running|Up 1 hour|${P}`,
  "skkuverse-crawler|running|Up 5 days|py",
  "skkuverse-ai-ai-1|running|Up 10 hours (healthy)|skkuverse-ai",
  "skkuverse-codepush-ota-1|running|Up 2 weeks (healthy)|skkuverse-codepush",
  // Stopped on purpose: must not count as a failure.
  "old-experiment|exited|Exited (0) 3 days ago|",
];

const STUBS: Record<string, string> = {
  docker: `#!/bin/bash
{ echo "--- docker"; for a in "$@"; do printf '%s\\n' "$a"; done; } >> "$STUB_DIR/log"
if [ "$1" = compose ]; then
  case "$4" in
    config)
      [ "\${STUB_CONFIG_EXIT:-0}" = 0 ] || { echo "no such file" >&2; exit "$STUB_CONFIG_EXIT"; }
      cat "$STUB_DIR/services" ;;
    ps)
      if [ -f "$STUB_DIR/compose-ps-once" ]; then
        cat "$STUB_DIR/compose-ps-once"; rm "$STUB_DIR/compose-ps-once"
      else
        cat "$STUB_DIR/compose-ps"
      fi ;;
  esac
elif [ "$1" = ps ]; then
  cat "$STUB_DIR/docker-ps"
fi
`,
  curl: `#!/bin/bash
{ echo "--- curl"; for a in "$@"; do printf '%s\\n' "$a"; done; } >> "$STUB_DIR/log"
for a in "$@"; do
  if [ "$a" = --resolve ] && [ "\${STUB_PROBE_EXIT:-0}" != 0 ]; then
    echo "curl: (7) Failed to connect to api.skkuverse.com port 443" >&2
    exit "$STUB_PROBE_EXIT"
  fi
done
exit 0
`,
  hostname: `#!/bin/bash
echo test-host
`,
};

interface Scenario {
  services?: string;
  compose?: string[];
  /** Served to the first `docker compose ps` only; later calls get `compose`. */
  composeOnce?: string[];
  dockerPs?: string[];
  probeExit?: number;
  configExit?: number;
  /** Contents of the env file; null leaves it absent. */
  envFile?: string | null;
}

interface Call {
  cmd: string;
  args: string[];
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-"));
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(s: Scenario = {}) {
  const lines = (rows: string[]) => rows.join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "services"), s.services ?? SERVICES);
  fs.writeFileSync(path.join(dir, "compose-ps"), lines(s.compose ?? healthyCompose));
  if (s.composeOnce) fs.writeFileSync(path.join(dir, "compose-ps-once"), lines(s.composeOnce));
  fs.writeFileSync(path.join(dir, "docker-ps"), lines(s.dockerPs ?? healthyDockerPs));
  const envPath = path.join(dir, "heartbeat.env");
  const envFile = s.envFile === undefined ? `HC_PING_URL=${PING_URL}\n` : s.envFile;
  if (envFile !== null) fs.writeFileSync(envPath, envFile);

  const res = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      STUB_DIR: dir,
      STUB_PROBE_EXIT: String(s.probeExit ?? 0),
      STUB_CONFIG_EXIT: String(s.configExit ?? 0),
      HEARTBEAT_ENV_FILE: envPath,
      HEARTBEAT_RECHECK_DELAY: "0",
    },
  });
  const logPath = path.join(dir, "log");
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const calls: Call[] = log
    .split(/^--- /m)
    .filter(Boolean)
    .map((chunk) => {
      const [cmd, ...args] = chunk.replace(/\n$/, "").split("\n");
      return { cmd: cmd!, args };
    });
  const curls = calls.filter((c) => c.cmd === "curl");
  const probes = curls.filter((c) => c.args.includes("--resolve"));
  const pings = curls.filter((c) => !c.args.includes("--resolve"));
  const successPings = pings.filter((c) => c.args[c.args.length - 1] === PING_URL);
  const failPings = pings.filter((c) => c.args[c.args.length - 1] === `${PING_URL}/fail`);
  // The body is a single argv entry that may span lines; the log splits it,
  // so rebuild it from --data-raw up to the URL.
  const failBody = failPings.length
    ? (() => {
        const a = failPings[0]!.args;
        return a.slice(a.indexOf("--data-raw") + 1, -1).join("\n");
      })()
    : "";
  return { status: res.status, stderr: res.stderr, calls, probes, pings, successPings, failPings, failBody };
}

const replace = (rows: string[], match: string, row: string) =>
  rows.map((r) => (r.startsWith(match) ? row : r));

describe("heartbeat.sh — healthy host", () => {
  it("pings the check URL once and exits 0", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.successPings).toHaveLength(1);
    expect(r.failPings).toHaveLength(0);
  });

  it("probes nginx on loopback with the public host name", () => {
    const r = run();
    expect(r.probes).toHaveLength(1);
    const args = r.probes[0]!.args;
    expect(args).toContain("api.skkuverse.com:443:127.0.0.1");
    expect(args).toContain("https://api.skkuverse.com/health/ready");
  });

  it("reads the services from this repo's compose file", () => {
    const r = run();
    const config = r.calls.find((c) => c.cmd === "docker" && c.args.includes("config"));
    expect(config!.args).toEqual([
      "compose",
      "-f",
      path.join(root, "docker-compose.yml"),
      "config",
      "--services",
    ]);
  });

  it("treats a replica that is still `starting` as up", () => {
    const r = run({ compose: replace(healthyCompose, `${P}|api-2|`, `${P}|api-2|running|starting`) });
    expect(r.status).toBe(0);
    expect(r.successPings).toHaveLength(1);
  });

  it("pings success when a failure clears on the re-check", () => {
    const r = run({ composeOnce: replace(healthyCompose, `${P}|api-1|`, `${P}|api-1|exited|`) });
    expect(r.status).toBe(0);
    expect(r.successPings).toHaveLength(1);
    expect(r.failPings).toHaveLength(0);
  });
});

describe("heartbeat.sh — failures post to /fail", () => {
  const expectFail = (r: ReturnType<typeof run>, needle: string) => {
    expect(r.status).not.toBe(0);
    expect(r.successPings).toHaveLength(0);
    expect(r.failPings).toHaveLength(1);
    expect(r.failBody).toContain("test-host");
    expect(r.failBody).toContain(needle);
  };

  it("reports an unhealthy replica, once", () => {
    const r = run({
      compose: replace(healthyCompose, `${P}|api-2|`, `${P}|api-2|running|unhealthy`),
      dockerPs: replace(healthyDockerPs, `${P}-api-2-1|`, `${P}-api-2-1|running|Up 1 hour (unhealthy)|${P}`),
    });
    expectFail(r, "api-2: unhealthy");
    // The compose check owns it; the other-containers check must not repeat it.
    expect(r.failBody.match(/api-2/g)).toHaveLength(1);
  });

  it("reports a compose service with no container", () => {
    const r = run({ compose: healthyCompose.filter((row) => !row.includes("|api-3|")) });
    expectFail(r, "api-3: no container");
  });

  it("reports a service with more than one container", () => {
    const r = run({ compose: [...healthyCompose, `${P}|api-1|running|healthy`] });
    expectFail(r, "api-1: 2 containers");
  });

  it("reports a service that is not running", () => {
    const r = run({ compose: replace(healthyCompose, `${P}|poller|`, `${P}|poller|restarting|`) });
    expectFail(r, "poller: restarting");
  });

  it("reports a failed nginx probe", () => {
    const r = run({ probeExit: 7 });
    expectFail(r, "nginx /health/ready: curl: (7)");
  });

  it("reports another container on the host that is restarting", () => {
    const r = run({
      dockerPs: replace(healthyDockerPs, "skkuverse-crawler|", "skkuverse-crawler|restarting|Restarting (1) 5 seconds ago|py"),
    });
    expectFail(r, "skkuverse-crawler: restarting");
  });

  it("reports another container on the host that is unhealthy", () => {
    const r = run({
      dockerPs: replace(
        healthyDockerPs,
        "skkuverse-ai-ai-1|",
        "skkuverse-ai-ai-1|running|Up 10 hours (unhealthy)|skkuverse-ai",
      ),
    });
    expectFail(r, "skkuverse-ai-ai-1: unhealthy");
  });

  it("reports a compose file docker cannot read", () => {
    const r = run({ configExit: 1 });
    expectFail(r, "docker compose config failed");
  });
});

describe("heartbeat.sh — broken setup never pings", () => {
  it("exits non-zero without curl when the env file is missing", () => {
    const r = run({ envFile: null });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cannot read/);
    expect(r.calls.filter((c) => c.cmd === "curl")).toHaveLength(0);
  });

  it("exits non-zero without curl when HC_PING_URL is empty", () => {
    const r = run({ envFile: "HC_PING_URL=\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/HC_PING_URL is not set/);
    expect(r.calls.filter((c) => c.cmd === "curl")).toHaveLength(0);
  });
});

describe("heartbeat cron + deploy", () => {
  const cron = fs.readFileSync(cronFile, "utf8");
  const deploy = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");

  it("the deploy installs the cron file into /etc/cron.d", () => {
    expect(deploy).toMatch(
      /^\s*sudo install -m 0644 infra\/monitoring\/skkuverse-heartbeat\.cron \/etc\/cron\.d\/skkuverse-heartbeat$/m,
    );
  });

  it("runs the checkout's script every minute as the docker-group user", () => {
    const job = cron.split("\n").find((l) => /^[^#\s]/.test(l) && !l.includes("="));
    expect(job).toMatch(
      /^\* \* \* \* \* ubuntu timeout \d+ \/\S+\/infra\/monitoring\/heartbeat\.sh 2>&1 \| logger -t skkuverse-heartbeat$/,
    );
  });

  it("is a valid cron.d file: ends in a newline, no % in the job line", () => {
    // cron ignores a final line with no newline and treats % as one.
    expect(cron.endsWith("\n")).toBe(true);
    expect(cron.split("\n").filter((l) => !l.startsWith("#")).join("\n")).not.toContain("%");
  });

  it("the script is executable", () => {
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);
  });
});
