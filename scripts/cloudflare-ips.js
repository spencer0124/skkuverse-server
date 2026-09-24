#!/usr/bin/env node
/**
 * Keep the nginx real-IP snippet (and, through the list files, the host
 * firewall) in step with Cloudflare's published edge ranges.
 *
 * Usage:
 *   npm run cloudflare-ips                     # regenerate infra/nginx/cloudflare-realip.conf
 *   npm run cloudflare-ips -- --check          # exit 1 if that file is stale (offline; jest runs it)
 *   npm run cloudflare-ips -- --live           # exit 1 if the lists differ from cloudflare.com
 *   npm run cloudflare-ips -- --live --write   # copy cloudflare.com's lists in, then regenerate
 *
 * `--live` needs the network, so it is not part of `npm test`: a Cloudflare
 * outage must not block a deploy. .github/workflows/cloudflare-ips.yml runs it
 * weekly instead, and a red run is the drift alert.
 *
 * A drift is urgent in one direction only. A range Cloudflare ADDS is an edge
 * the firewall rejects (requests through it fail with 52x) and nginx does not
 * trust (its clients share one rate-limit key). A range it REMOVES merely
 * stays trusted until the lists are refreshed. Procedure: docs/how-to/lock-origin-to-cloudflare.md.
 */
const fs = require("node:fs");
const path = require("node:path");

const { diffRanges, parseRanges, renderRealipConf } = require("./lib/cloudflare-ips-file");

const ROOT = path.join(__dirname, "..");
const LIST = {
  4: path.join(ROOT, "infra/cloudflare/ips-v4.txt"),
  6: path.join(ROOT, "infra/cloudflare/ips-v6.txt"),
};
const CONF = path.join(ROOT, "infra/nginx/cloudflare-realip.conf");
const LIVE_URL = {
  4: "https://www.cloudflare.com/ips-v4",
  6: "https://www.cloudflare.com/ips-v6",
};

function parseArgs(argv) {
  const args = { check: false, live: false, write: false };
  for (const arg of argv) {
    if (arg === "--check") args.check = true;
    else if (arg === "--live") args.live = true;
    else if (arg === "--write") args.write = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.write && !args.live) throw new Error("--write only goes with --live");
  if (args.check && args.live) throw new Error("--check and --live are separate checks; run one");
  return args;
}

function readList(family) {
  return parseRanges(fs.readFileSync(LIST[family], "utf8"), family);
}

async function fetchList(family) {
  const res = await fetch(LIVE_URL[family], { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${LIVE_URL[family]}: HTTP ${res.status}`);
  // Parsed with the same rules as the committed file, so a garbage response
  // (an HTML error page, an empty body) fails here instead of being written.
  return parseRanges(await res.text(), family);
}

function generate() {
  return renderRealipConf(readList(4), readList(6));
}

async function live(write) {
  let drift = false;
  for (const family of [4, 6]) {
    const committed = readList(family);
    const published = await fetchList(family);
    const { missing, extra } = diffRanges(committed, published);
    for (const r of missing) console.log(`IPv${family} + ${r}   (published, not in ${path.relative(ROOT, LIST[family])})`);
    for (const r of extra) console.log(`IPv${family} - ${r}   (in ${path.relative(ROOT, LIST[family])}, no longer published)`);
    if (missing.length || extra.length) {
      drift = true;
      if (write) fs.writeFileSync(LIST[family], published.join("\n") + "\n");
    }
  }
  if (!drift) {
    console.log("Cloudflare ranges match infra/cloudflare/ips-v{4,6}.txt");
    return 0;
  }
  if (!write) {
    console.error("\nCloudflare's published ranges changed. Run `npm run cloudflare-ips -- --live --write`,");
    console.error("commit, deploy, then re-apply the firewall — docs/how-to/lock-origin-to-cloudflare.md.");
    return 1;
  }
  fs.writeFileSync(CONF, generate());
  console.log(`\nWrote the lists and ${path.relative(ROOT, CONF)}. Commit, deploy, then re-apply the firewall.`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.live) return live(args.write);

  const expected = generate();
  if (args.check) {
    const actual = fs.existsSync(CONF) ? fs.readFileSync(CONF, "utf8") : "";
    if (actual !== expected) {
      console.error(`${path.relative(ROOT, CONF)} is stale: run \`npm run cloudflare-ips\` and commit the result.`);
      return 1;
    }
    console.log(`${path.relative(ROOT, CONF)} is up to date`);
    return 0;
  }
  fs.writeFileSync(CONF, expected);
  console.log(`Wrote ${path.relative(ROOT, CONF)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`cloudflare-ips: ${err.message}`);
    process.exit(1);
  },
);
