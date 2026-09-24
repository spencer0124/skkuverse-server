/**
 * The nginx site file is half of the client-IP contract; `trust proxy 1` in
 * src/main.ts is the other. Express takes the rightmost X-Forwarded-For entry
 * as req.ip, so nginx must (a) resolve the client from Cloudflare's header, and
 * only when the peer is Cloudflare, and (b) send that address as the ONLY
 * X-Forwarded-For entry. Appending instead would let a client-supplied header
 * ride ahead of it; dropping realip would key every client on a Cloudflare edge.
 *
 * nginx itself is not run here — the deploy's `nginx -t` checks syntax. This
 * pins the directives the application depends on.
 */
import fs from "fs";
import net from "net";
import path from "path";

const site = fs.readFileSync(
  path.join(__dirname, "../../../infra/nginx/api.skkuverse.com"),
  "utf8",
);
// Directives only: comments may mention anything.
const directives = site
  .split("\n")
  .map((line) => line.replace(/#.*/, "").trim())
  .filter(Boolean)
  .join("\n");

describe("infra/nginx/api.skkuverse.com — client IP", () => {
  it("resolves the client from CF-Connecting-IP", () => {
    expect(directives).toMatch(/^real_ip_header CF-Connecting-IP;$/m);
  });

  it("trusts that header only from listed ranges, each a valid CIDR", () => {
    const ranges = [...directives.matchAll(/^set_real_ip_from (\S+);$/gm)].map((m) => m[1]!);
    expect(ranges.length).toBeGreaterThan(0);
    for (const cidr of ranges) {
      const [addr, bits] = cidr.split("/");
      const family = net.isIP(addr!);
      expect(family).not.toBe(0);
      const max = family === 4 ? 32 : 128;
      expect(Number(bits)).toBeGreaterThan(0);
      expect(Number(bits)).toBeLessThanOrEqual(max);
    }
    // Trusting everyone would let any client pick its own rate-limit key.
    expect(ranges).not.toContain("0.0.0.0/0");
    expect(ranges).not.toContain("::/0");
  });

  it("forwards the client as the only X-Forwarded-For entry", () => {
    expect(directives).toMatch(/^proxy_set_header X-Forwarded-For \$remote_addr;$/m);
    expect(directives).not.toMatch(/\$proxy_add_x_forwarded_for/);
  });
});

describe("infra/nginx/api.skkuverse.com — upstream connections", () => {
  it("keeps upstream connections alive, which needs HTTP/1.1 and no Connection header", () => {
    expect(directives).toMatch(/^keepalive \d+;$/m);
    expect(directives).toMatch(/^proxy_http_version 1\.1;$/m);
    expect(directives).toMatch(/^proxy_set_header Connection "";$/m);
  });

  it("closes idle upstream connections before Node does (5 s default)", () => {
    const m = directives.match(/^keepalive_timeout (\d+)s;$/m);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(5);
  });

  it("bounds how long a request may wait on a stuck replica", () => {
    expect(directives).toMatch(/^proxy_connect_timeout \d+s;$/m);
    expect(directives).toMatch(/^proxy_read_timeout \d+s;$/m);
  });
});
