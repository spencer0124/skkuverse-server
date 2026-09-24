/**
 * infra/firewall/cloudflare-only.sh rewrites the INPUT chain of a live host.
 * A bug either leaves 80/443 open while claiming a lock (silent) or rejects
 * Cloudflare itself (an outage, and one that survives reboots via the unit).
 * So the real script runs here, under bash, against a stub `iptables` that
 * keeps each chain as a file of rule specs and implements the handful of
 * commands the script uses (-S -C -N -F -X -A -I -D) with iptables' own
 * failure modes: -I past the end, -D of a missing rule, -X of a chain that is
 * referenced or not empty, a jump to a chain that does not exist.
 *
 * The stub matches rules by exact text, which real iptables does not — it
 * normalises. The script therefore writes every spec in the form `iptables -S`
 * prints it; that form was checked against iptables v1.8.7 (nf_tables), the
 * version on the VM, when the script was written.
 *
 * The starting state is the VM's INPUT chain, verbatim from `iptables -S`.
 *
 * infra/firewall/apply-baseline.sh, which gives a fresh host that same INPUT
 * chain from infra/firewall/baseline-rules.v4, runs against the same stub
 * further down — ending with cloudflare-only.sh applied on top of its result.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const root = path.join(__dirname, "../../..");
const script = path.join(root, "infra/firewall/cloudflare-only.sh");
const baselineScript = path.join(root, "infra/firewall/apply-baseline.sh");
const baselineFile = path.join(root, "infra/firewall/baseline-rules.v4");
const unitFile = path.join(root, "infra/firewall/skkuverse-firewall.service");
const ipsFile = path.join(root, "infra/cloudflare/ips-v4.txt");

const CHAIN = "SKKUVERSE-CF";
const OPEN_443 = "-p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT";
const OPEN_80 = "-p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT";
const SSH = "-p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT";
const JUMP = `-p tcp -m state --state NEW -m multiport --dports 80,443 -j ${CHAIN}`;
const REJECT = "-j REJECT --reject-with icmp-host-prohibited";
const rangeRule = (cidr: string) => `-s ${cidr} -p tcp -m multiport --dports 80,443 -j ACCEPT`;

// `iptables -S INPUT` on the VM, 2026-09-24.
const VM_INPUT = [
  "-p tcp -m multiport --dports 22 -j f2b-sshd",
  "-p tcp -m multiport --dports 22 -j f2b-sshd",
  "-m state --state RELATED,ESTABLISHED -j ACCEPT",
  "-p icmp -j ACCEPT",
  "-i lo -j ACCEPT",
  SSH,
  OPEN_443,
  OPEN_80,
  REJECT,
];
const OTHER_CHAINS: Record<string, string[]> = {
  "f2b-sshd": ["-s 203.0.113.9/32 -j REJECT --reject-with icmp-port-unreachable", "-j RETURN"],
  "DOCKER-USER": [],
  DOCKER: ["-d 172.18.0.2/32 ! -i br-1 -o br-1 -p tcp -m tcp --dport 4000 -j ACCEPT"],
};

const BUILTIN = new Set(["INPUT", "FORWARD", "OUTPUT"]);
const TARGETS = new Set(["ACCEPT", "REJECT", "DROP", "RETURN"]);

// bash 3.2 compatible, like the script: it runs on macOS too.
const IPTABLES_STUB = `#!/bin/bash
set -u
D="$STUB_DIR/chains"
[ "\${1:-}" = -w ] && shift
op=$1; chain=$2; shift 2
f="$D/$chain"
case $op in -S|-C) ;; *) printf '%s %s %s\\n' "$op" "$chain" "$*" >> "$STUB_DIR/log" ;; esac
nochain() { echo "iptables: No chain/target/match by that name." >&2; exit 1; }
builtin() { case $1 in ${[...BUILTIN].join("|")}) return 0 ;; esac; return 1; }
check_target() {
  local t=\${1##*-j }; t=\${t%% *}
  case $t in ${[...TARGETS].join("|")}) return 0 ;; esac
  [ -f "$D/$t" ] || { echo "iptables: Couldn't load target \\\`$t'" >&2; exit 2; }
}
case $op in
  -S)
    [ -f "$f" ] || nochain
    if builtin "$chain"; then echo "-P $chain $(cat "$STUB_DIR/policy-$chain" 2>/dev/null || echo ACCEPT)"; else echo "-N $chain"; fi
    while IFS= read -r l; do echo "-A $chain $l"; done < "$f" ;;
  -C) [ -f "$f" ] || nochain; grep -qxF -- "$*" "$f" || { echo "iptables: Bad rule." >&2; exit 1; } ;;
  -N) [ -f "$f" ] && { echo "iptables: Chain already exists." >&2; exit 1; }; : > "$f" ;;
  -F) [ -f "$f" ] || nochain; : > "$f" ;;
  -X)
    [ -f "$f" ] || nochain
    [ -s "$f" ] && { echo "iptables: Directory not empty." >&2; exit 1; }
    grep -qE -- "-j $chain( |\\$)" "$D"/* && { echo "iptables: Too many links." >&2; exit 1; }
    rm "$f" ;;
  -A) [ -f "$f" ] || nochain; check_target "$*"; printf '%s\\n' "$*" >> "$f" ;;
  -I)
    [ -f "$f" ] || nochain
    pos=1
    case $1 in [0-9]*) pos=$1; shift ;; esac
    rule="$*"; check_target "$rule"
    n=$(wc -l < "$f" | tr -d ' ')
    [ "$pos" -le $((n + 1)) ] || { echo "iptables: Index of insertion too big." >&2; exit 1; }
    awk -v p="$pos" -v r="$rule" 'NR==p{print r} {print} END{if(NR<p)print r}' "$f" > "$f.tmp" && mv "$f.tmp" "$f" ;;
  -D)
    [ -f "$f" ] || nochain
    rule="$*"
    grep -qxF -- "$rule" "$f" || { echo "iptables: Bad rule (does a matching rule exist in that chain?)." >&2; exit 1; }
    awk -v r="$rule" '!d && $0==r {d=1; next} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f" ;;
  *) echo "stub: unsupported $op" >&2; exit 3 ;;
esac
`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "firewall-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.mkdirSync(path.join(dir, "chains"));
  fs.writeFileSync(path.join(dir, "bin/iptables"), IPTABLES_STUB, { mode: 0o755 });
  // No global IPv6 on the host: `ip -6 addr` prints nothing.
  fs.writeFileSync(path.join(dir, "bin/ip"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  setChains({ INPUT: VM_INPUT, FORWARD: [], OUTPUT: [], ...OTHER_CHAINS });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function setChains(state: Record<string, string[]>) {
  for (const [name, rules] of Object.entries(state)) {
    fs.writeFileSync(path.join(dir, "chains", name), rules.map((r) => r + "\n").join(""));
  }
}

function chains(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of fs.readdirSync(path.join(dir, "chains"))) {
    out[name] = fs.readFileSync(path.join(dir, "chains", name), "utf8").split("\n").filter(Boolean);
  }
  return out;
}

/** Mutating calls, in order, as "<op> <chain> <spec>". */
function log(): string[] {
  const p = path.join(dir, "log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
}

function run(args: string[] = [], opts: { ips?: string; script?: string; env?: Record<string, string> } = {}) {
  const env: Record<string, string> = { PATH: `${dir}/bin:${process.env.PATH}`, STUB_DIR: dir, ...opts.env };
  if (opts.ips !== undefined) {
    const p = path.join(dir, "ips.txt");
    fs.writeFileSync(p, opts.ips);
    env.CF_IPS_V4_FILE = p;
  }
  const res = spawnSync("bash", [opts.script ?? script, ...args], { encoding: "utf8", env });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const realRanges = fs.readFileSync(ipsFile, "utf8").split("\n").filter(Boolean);

describe("cloudflare-only.sh — apply", () => {
  it("replaces the open 80/443 rules with a jump at their position", () => {
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(chains().INPUT).toEqual([...VM_INPUT.slice(0, 6), JUMP, REJECT]);
  });

  it("accepts every listed range, in file order, on 80/443 only", () => {
    run();
    expect(chains()[CHAIN]).toEqual(realRanges.map(rangeRule));
    for (const rule of chains()[CHAIN]!) expect(rule).toMatch(/ --dports 80,443 -j ACCEPT$/);
  });

  it("leaves SSH, fail2ban and Docker exactly as they were", () => {
    run();
    const after = chains();
    expect(after.INPUT).toContain(SSH);
    expect(after.INPUT!.filter((rule) => rule.includes("f2b-sshd"))).toHaveLength(2);
    for (const [name, rules] of Object.entries(OTHER_CHAINS)) expect(after[name]).toEqual(rules);
    expect(log().every((l) => / (INPUT|SKKUVERSE-CF) /.test(l))).toBe(true);
    expect(log().join("\n")).not.toMatch(/dport 22\b/);
  });

  it("never has a moment without an accept for Cloudflare: build, then jump, then delete", () => {
    run();
    const calls = log();
    const lastAppend = calls.map((c) => c.startsWith(`-A ${CHAIN} `)).lastIndexOf(true);
    const jump = calls.findIndex((c) => c === `-I INPUT 7 ${JUMP}`);
    const firstDelete = calls.findIndex((c) => c.startsWith("-D INPUT "));
    expect(lastAppend).toBeGreaterThan(-1);
    expect(jump).toBeGreaterThan(lastAppend);
    expect(firstDelete).toBeGreaterThan(jump);
  });

  it("is idempotent: a second run changes nothing", () => {
    run();
    const once = chains();
    fs.rmSync(path.join(dir, "log"));
    const r = run();
    expect(r.status).toBe(0);
    expect(log()).toEqual([]);
    expect(chains()).toEqual(once);
  });

  it("refreshes a changed list by adding before deleting, without touching the jump", () => {
    run();
    fs.rmSync(path.join(dir, "log"));
    const next = [...realRanges.slice(1), "192.0.2.0/24"];
    const r = run([], { ips: next.join("\n") + "\n" });
    expect(r.status).toBe(0);
    expect(new Set(chains()[CHAIN])).toEqual(new Set(next.map(rangeRule)));
    expect(log()).toEqual([`-A ${CHAIN} ${rangeRule("192.0.2.0/24")}`, `-D ${CHAIN} ${rangeRule(realRanges[0]!)}`]);
  });

  it("inserts the jump above the final REJECT when the open rules are already gone", () => {
    setChains({ INPUT: VM_INPUT.filter((rule) => rule !== OPEN_443 && rule !== OPEN_80) });
    expect(run().status).toBe(0);
    expect(chains().INPUT).toEqual([...VM_INPUT.slice(0, 6), JUMP, REJECT]);
  });

  it("removes duplicated open rules too", () => {
    setChains({ INPUT: [...VM_INPUT.slice(0, 8), OPEN_80, REJECT] });
    expect(run().status).toBe(0);
    expect(chains().INPUT).toEqual([...VM_INPUT.slice(0, 6), JUMP, REJECT]);
  });

  it("--dry-run prints the commands and changes nothing", () => {
    const before = chains();
    const r = run(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(log()).toEqual([]);
    expect(chains()).toEqual(before);
    expect(r.stdout).toContain(`+ iptables -w -N ${CHAIN}`);
    expect(r.stdout).toContain(`+ iptables -w -I INPUT 7 ${JUMP}`);
    expect(r.stdout).toContain(`+ iptables -w -D INPUT ${OPEN_443}`);
    expect(r.stdout).toContain(`+ iptables -w -D INPUT ${OPEN_80}`);
  });
});

describe("cloudflare-only.sh --undo", () => {
  it("restores the VM's original INPUT and removes the chain", () => {
    run();
    const r = run(["--undo"]);
    expect(r.status).toBe(0);
    const after = chains();
    expect(after.INPUT).toEqual(VM_INPUT);
    expect(after[CHAIN]).toBeUndefined();
  });

  it("reopens before it closes: the open rules go in above the jump before it is deleted", () => {
    run();
    fs.rmSync(path.join(dir, "log"));
    run(["--undo"]);
    expect(log().slice(0, 3)).toEqual([`-I INPUT 7 ${OPEN_443}`, `-I INPUT 8 ${OPEN_80}`, `-D INPUT ${JUMP}`]);
  });

  it("is a no-op on a host that was never locked", () => {
    const r = run(["--undo"]);
    expect(r.status).toBe(0);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual(VM_INPUT);
  });
});

describe("cloudflare-only.sh — refuses before changing anything", () => {
  const expectRefusal = (r: ReturnType<typeof run>, message: RegExp) => {
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual(VM_INPUT);
  };

  it("on an empty list", () => {
    expectRefusal(run([], { ips: "\n\n" }), /no ranges/);
  });

  it("on a missing list", () => {
    const r = spawnSync("bash", [script], {
      encoding: "utf8",
      env: { PATH: `${dir}/bin:${process.env.PATH}`, STUB_DIR: dir, CF_IPS_V4_FILE: path.join(dir, "nope.txt") },
    });
    expectRefusal({ status: r.status, stdout: r.stdout, stderr: r.stderr }, /cannot read/);
  });

  it.each([
    ["not an address", "cloudflare"],
    ["an IPv6 range", "2400:cb00::/32"],
    ["everything", "0.0.0.0/0"],
    ["a prefix over 32", "173.245.48.0/33"],
    ["an octet over 255", "173.245.256.0/20"],
    ["host bits set", "173.245.48.1/20"],
    ["a leading zero", "173.245.048.0/20"],
  ])("on a list with %s", (_label, bad) => {
    expectRefusal(run([], { ips: `173.245.48.0/20\n${bad}\n` }), /not an aligned IPv4 CIDR/);
  });

  it("on a duplicated range", () => {
    expectRefusal(run([], { ips: "173.245.48.0/20\n173.245.48.0/20\n" }), /duplicate/);
  });

  it("when INPUT does not end in a REJECT", () => {
    const input = VM_INPUT.slice(0, -1);
    setChains({ INPUT: input });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not end in an unconditional REJECT\/DROP/);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual(input);
  });

  it("when another rule accepts 80/443 from everywhere", () => {
    const input = [...VM_INPUT.slice(0, -1), "-p tcp -m tcp --dport 443 -j ACCEPT", REJECT];
    setChains({ INPUT: input });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/80\/443 ACCEPT this script does not know/);
    expect(log()).toEqual([]);
  });

  it("on an unknown argument", () => {
    expectRefusal(run(["--force"]), /unknown argument/);
  });
});

describe("skkuverse-firewall.service + deploy", () => {
  const unit = fs.readFileSync(unitFile, "utf8");
  const deploy = fs.readFileSync(path.join(root, ".github/workflows/deploy-host.yml"), "utf8");
  const cron = fs.readFileSync(path.join(root, "infra/monitoring/skkuverse-heartbeat.cron"), "utf8");

  it("runs the checkout's script once at boot, after rules.v4 is loaded", () => {
    expect(unit).toMatch(/^After=.*\bnetfilter-persistent\.service\b/m);
    expect(unit).toMatch(/^Type=oneshot$/m);
    expect(unit).toMatch(/^RemainAfterExit=yes$/m);
    expect(unit).toMatch(/^WantedBy=multi-user\.target$/m);
    // No ExecStop: stopping the unit must not silently reopen or close ports.
    expect(unit).not.toMatch(/^ExecStop/m);
  });

  it("points at the same deploy checkout as the heartbeat cron", () => {
    const exec = unit.match(/^ExecStart=(\S+)$/m)![1]!;
    const cronScript = cron.match(/ (\/\S+)\/infra\/monitoring\/heartbeat\.sh /)![1]!;
    expect(exec).toBe(`${cronScript}/infra/firewall/cloudflare-only.sh`);
  });

  it("the deploy installs the unit and reloads systemd, but never applies the firewall", () => {
    expect(deploy).toMatch(
      /^\s*sudo install -m 0644 infra\/firewall\/skkuverse-firewall\.service \/etc\/systemd\/system\/skkuverse-firewall\.service$/m,
    );
    expect(deploy).toMatch(/^\s*sudo systemctl daemon-reload$/m);
    expect(deploy).not.toMatch(/systemctl (enable|start|restart)[^\n]*skkuverse-firewall/);
    expect(deploy).not.toMatch(/cloudflare-only\.sh/);
    expect(deploy).not.toMatch(/apply-baseline\.sh|iptables/);
  });

  it("the scripts are executable", () => {
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);
    expect(fs.statSync(baselineScript).mode & 0o111).not.toBe(0);
  });
});

// --- apply-baseline.sh + baseline-rules.v4 ---------------------------------

const baselineText = fs.readFileSync(baselineFile, "utf8");
const BASELINE = baselineText
  .split("\n")
  .filter((l) => l.startsWith("-A INPUT "))
  .map((l) => l.slice("-A INPUT ".length));
const F2B = VM_INPUT.filter((rule) => rule.includes("f2b-sshd"));
const LOCKED = [...BASELINE.slice(0, 4), JUMP, REJECT];

const runBaseline = (args: string[] = [], env: Record<string, string> = {}) =>
  run(args, { script: baselineScript, env: { BASELINE_PERSIST_PATH: path.join(dir, "iptables/rules.v4"), ...env } });

describe("infra/firewall/baseline-rules.v4", () => {
  it("is the VM's INPUT chain without fail2ban's jumps, in the same order", () => {
    expect(BASELINE).toEqual(VM_INPUT.filter((rule) => !rule.includes("f2b-sshd")));
  });

  it("accepts replies first and ends in the REJECT, with SSH before it", () => {
    expect(BASELINE[0]).toBe("-m state --state RELATED,ESTABLISHED -j ACCEPT");
    expect(BASELINE[BASELINE.length - 1]).toBe(REJECT);
    expect(BASELINE.indexOf(SSH)).toBeGreaterThan(-1);
  });

  it("is a filter-table-only iptables-restore file with no FORWARD or OUTPUT rules", () => {
    const body = baselineText.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(body[0]).toBe("*filter");
    expect(body[body.length - 1]).toBe("COMMIT");
    expect(body.filter((l) => l.startsWith("*"))).toEqual(["*filter"]);
    expect(body.filter((l) => l.startsWith(":"))).toEqual([
      ":INPUT ACCEPT [0:0]",
      ":FORWARD ACCEPT [0:0]",
      ":OUTPUT ACCEPT [0:0]",
    ]);
    expect(body.filter((l) => l.startsWith("-A ") && !l.startsWith("-A INPUT "))).toEqual([]);
    expect(baselineText.endsWith("\n")).toBe(true);
  });
});

describe("apply-baseline.sh", () => {
  beforeEach(() => setChains({ INPUT: [] }));

  it("gives an empty INPUT the baseline, appended one rule at a time in file order", () => {
    const r = runBaseline();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(chains().INPUT).toEqual(BASELINE);
    expect(log()).toEqual(BASELINE.map((rule) => `-A INPUT ${rule}`));
  });

  it("touches no chain but INPUT", () => {
    const before = chains();
    runBaseline();
    const after = chains();
    for (const name of Object.keys(before)) if (name !== "INPUT") expect(after[name]).toEqual(before[name]);
    expect(log().every((l) => l.startsWith("-A INPUT "))).toBe(true);
  });

  it("is idempotent: a second run changes nothing", () => {
    runBaseline();
    fs.rmSync(path.join(dir, "log"));
    const r = runBaseline();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already has the baseline/);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual(BASELINE);
  });

  it("finishes an interrupted run: appends only what is missing", () => {
    setChains({ INPUT: BASELINE.slice(0, 3) });
    expect(runBaseline().status).toBe(0);
    expect(chains().INPUT).toEqual(BASELINE);
    expect(log()).toEqual(BASELINE.slice(3).map((rule) => `-A INPUT ${rule}`));
  });

  it("ignores fail2ban's jumps and leaves them where they are", () => {
    setChains({ INPUT: F2B });
    expect(runBaseline().status).toBe(0);
    expect(chains().INPUT).toEqual([...F2B, ...BASELINE]);
  });

  it.each([
    ["the OCI VM as it was (open 80/443)", VM_INPUT],
    ["the OCI VM locked by cloudflare-only.sh", [...F2B, ...LOCKED]],
  ])("does nothing on %s", (_label, input) => {
    setChains({ INPUT: input });
    const r = runBaseline();
    expect(r.status).toBe(0);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual(input);
  });

  it("--dry-run prints the commands and changes nothing", () => {
    const r = runBaseline(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(log()).toEqual([]);
    expect(chains().INPUT).toEqual([]);
    expect(r.stdout.trim().split("\n")).toEqual(BASELINE.map((rule) => `+ iptables -w -A INPUT ${rule}`));
  });

  it("leaves the host ready for cloudflare-only.sh, which then locks it", () => {
    expect(runBaseline().status).toBe(0);
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(chains().INPUT).toEqual(LOCKED);
    expect(chains()[CHAIN]).toEqual(realRanges.map(rangeRule));
    // And the locked shape is still one apply-baseline.sh accepts.
    fs.rmSync(path.join(dir, "log"));
    expect(runBaseline().status).toBe(0);
    expect(log()).toEqual([]);
  });

  describe("refuses before changing anything, and shows what INPUT holds", () => {
    const expectRefusal = (input: string[], message: RegExp, env: Record<string, string> = {}) => {
      setChains({ INPUT: input });
      const r = runBaseline([], env);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(message);
      for (const rule of input) expect(r.stderr).toContain(`-A INPUT ${rule}`);
      expect(log()).toEqual([]);
      expect(chains().INPUT).toEqual(input);
    };

    it("on a rule the baseline does not have", () => {
      expectRefusal(["-p tcp -m tcp --dport 8080 -j ACCEPT"], /not the baseline/);
    });

    it("on baseline rules out of order", () => {
      expectRefusal([BASELINE[1]!, BASELINE[0]!], /not the baseline/);
    });

    it("on a REJECT already in place (appending would land after it)", () => {
      expectRefusal([REJECT], /not the baseline/);
    });

    it("on a duplicated baseline rule", () => {
      expectRefusal([...BASELINE, BASELINE[0]!], /not the baseline/);
    });

    it("when the INPUT policy is not ACCEPT", () => {
      fs.writeFileSync(path.join(dir, "policy-INPUT"), "DROP\n");
      expectRefusal([], /INPUT policy is 'DROP'/);
    });

    it("on an unknown argument", () => {
      const r = runBaseline(["--force"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown argument/);
      expect(log()).toEqual([]);
    });
  });

  describe("--persist", () => {
    const persistPath = () => path.join(dir, "iptables/rules.v4");

    it("is off by default: nothing is written", () => {
      fs.mkdirSync(path.join(dir, "iptables"));
      expect(runBaseline().status).toBe(0);
      expect(fs.existsSync(persistPath())).toBe(false);
    });

    it("installs the repo's file, not the live ruleset", () => {
      fs.mkdirSync(path.join(dir, "iptables"));
      expect(runBaseline(["--persist"]).status).toBe(0);
      expect(fs.readFileSync(persistPath(), "utf8")).toBe(baselineText);
    });

    it("keeps a differing old file as a backup", () => {
      fs.mkdirSync(path.join(dir, "iptables"));
      fs.writeFileSync(persistPath(), "*filter\nCOMMIT\n");
      expect(runBaseline(["--persist"]).status).toBe(0);
      expect(fs.readFileSync(persistPath(), "utf8")).toBe(baselineText);
      const backups = fs.readdirSync(path.join(dir, "iptables")).filter((f) => f.startsWith("rules.v4.bak."));
      expect(backups).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, "iptables", backups[0]!), "utf8")).toBe("*filter\nCOMMIT\n");
    });

    it("fails before changing INPUT when iptables-persistent is not installed (no /etc/iptables)", () => {
      const r = runBaseline(["--persist"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/install iptables-persistent first/);
      expect(log()).toEqual([]);
    });

    it("with --dry-run writes nothing", () => {
      fs.mkdirSync(path.join(dir, "iptables"));
      const r = runBaseline(["--persist", "--dry-run"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`+ install -m 0644 ${baselineFile} ${persistPath()}`);
      expect(fs.existsSync(persistPath())).toBe(false);
    });
  });
});
