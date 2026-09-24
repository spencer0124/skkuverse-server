/**
 * infra/cloudflare/ips-v{4,6}.txt are the one place Cloudflare's edge ranges
 * are written down. The nginx real-IP snippet is generated from them and the
 * firewall reads ips-v4.txt directly, so what is pinned here is:
 *
 *   - the committed snippet is exactly what the generator makes from the lists
 *     (a hand edit to either side fails `npm test`, in CI and in the deploy);
 *   - the parser rejects anything that is not a plausible Cloudflare range,
 *     because the same lists open the firewall;
 *   - the weekly workflow still runs the live comparison against cloudflare.com.
 *
 * Whether the lists match cloudflare.com today is NOT checked here: that needs
 * the network, and a Cloudflare outage must not block a deploy.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { diffRanges, parseRanges, renderRealipConf } = require("../../../scripts/lib/cloudflare-ips-file");

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("infra/nginx/cloudflare-realip.conf", () => {
  it("is exactly what the generator makes from the lists", () => {
    const v4 = parseRanges(read("infra/cloudflare/ips-v4.txt"), 4);
    const v6 = parseRanges(read("infra/cloudflare/ips-v6.txt"), 6);
    expect(read("infra/nginx/cloudflare-realip.conf")).toBe(renderRealipConf(v4, v6));
  });

  it("`npm run cloudflare-ips -- --check` passes", () => {
    const res = spawnSync(process.execPath, [path.join(root, "scripts/cloudflare-ips.js"), "--check"], {
      encoding: "utf8",
    });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("lists every range once, v4 then v6", () => {
    const conf = read("infra/nginx/cloudflare-realip.conf");
    const trusted = [...conf.matchAll(/^set_real_ip_from (\S+);$/gm)].map((m) => m[1]);
    const lists = [...read("infra/cloudflare/ips-v4.txt").split("\n"), ...read("infra/cloudflare/ips-v6.txt").split("\n")]
      .map((l) => l.trim())
      .filter(Boolean);
    expect(trusted).toEqual(lists);
  });
});

describe("parseRanges", () => {
  it("reads Cloudflare's format, with or without a final newline", () => {
    expect(parseRanges("173.245.48.0/20\n103.21.244.0/22", 4)).toEqual(["173.245.48.0/20", "103.21.244.0/22"]);
    expect(parseRanges("2400:cb00::/32\n", 6)).toEqual(["2400:cb00::/32"]);
  });

  it.each([
    ["an empty list", "", 4, /no IPv4 ranges/],
    ["a v6 range in the v4 list", "2400:cb00::/32", 4, /not an IPv4 address/],
    ["a v4 range in the v6 list", "173.245.48.0/20", 6, /not an IPv6 address/],
    ["no prefix", "173.245.48.0", 4, /not a CIDR/],
    ["everything", "0.0.0.0/0", 4, /out of range/],
    ["::/0", "::/0", 6, /out of range/],
    ["an HTML error page", "<html><body>Error</body></html>", 4, /not a CIDR/],
    ["a duplicate", "173.245.48.0/20\n173.245.48.0/20", 4, /duplicate/],
  ])("rejects %s", (_label, text, family, message) => {
    expect(() => parseRanges(text, family)).toThrow(message as RegExp);
  });
});

describe("diffRanges", () => {
  it("reports both directions, ignoring order", () => {
    expect(diffRanges(["a", "b", "c"], ["c", "b", "d"])).toEqual({ missing: ["d"], extra: ["a"] });
    expect(diffRanges(["a", "b"], ["b", "a"])).toEqual({ missing: [], extra: [] });
  });
});

describe(".github/workflows/cloudflare-ips.yml", () => {
  const workflow = read(".github/workflows/cloudflare-ips.yml");

  it("runs the live comparison on a schedule", () => {
    expect(workflow).toMatch(/^\s*schedule:\s*$/m);
    expect(workflow).toMatch(/^\s*- cron: "[^"]+"/m);
    expect(workflow).toMatch(/npm run cloudflare-ips -- --live$/m);
  });
});
