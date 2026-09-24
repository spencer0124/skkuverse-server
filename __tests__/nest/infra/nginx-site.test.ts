/**
 * The nginx site file is half of the client-IP contract; `trust proxy 1` in
 * src/main.ts is the other. Express takes the rightmost X-Forwarded-For entry
 * as req.ip, so nginx must (a) resolve the client from Cloudflare's header, and
 * only when the peer is Cloudflare, and (b) send that address as the ONLY
 * X-Forwarded-For entry. Appending instead would let a client-supplied header
 * ride ahead of it; dropping realip would key every client on a Cloudflare edge.
 *
 * (a) lives in a generated snippet (infra/nginx/cloudflare-realip.conf, from
 * infra/cloudflare/ips-v{4,6}.txt) that the site includes; the deploy has to
 * install it before the site, or `nginx -t` meets an include with no target.
 *
 * The catch-all server is pinned at the end: without it, whichever site nginx
 * loads first answers every request for an unknown host or a bare IP.
 *
 * nginx itself is not run here — the deploy's `nginx -t` checks syntax. This
 * pins the directives the application depends on.
 */
import fs from "fs";
import net from "net";
import path from "path";

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
// Directives only: comments may mention anything.
const directivesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .join("\n");

const directives = directivesOf(read("infra/nginx/api.skkuverse.com"));
const realip = directivesOf(read("infra/nginx/cloudflare-realip.conf"));
const catchall = directivesOf(read("infra/nginx/00-default-catchall"));
const deploy = read(".github/workflows/deploy-host.yml");

const SNIPPET = "/etc/nginx/snippets/skkuverse-cloudflare-realip.conf";

describe("infra/nginx/api.skkuverse.com — real-IP snippet", () => {
  it("includes the generated snippet at http level instead of listing ranges inline", () => {
    expect(directives.split("\n")[0]).toBe(`include ${SNIPPET};`);
    expect(directives).not.toMatch(/set_real_ip_from|real_ip_header/);
  });

  it("the deploy installs the snippet at that path, before the site and before nginx -t", () => {
    const lines = deploy.split("\n").map((l) => l.trim());
    const snippet = lines.findIndex(
      (l) => l === `sudo install -m 0644 infra/nginx/cloudflare-realip.conf ${SNIPPET}`,
    );
    const site = lines.findIndex((l) => l.includes('"infra/nginx/$site"'));
    const test = lines.findIndex((l) => /^(if ! )?sudo nginx -t\b/.test(l));
    expect(snippet).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(snippet);
    expect(test).toBeGreaterThan(site);
  });
});

describe("infra/nginx/api.skkuverse.com — client IP", () => {
  it("resolves the client from CF-Connecting-IP", () => {
    expect(realip).toMatch(/^real_ip_header CF-Connecting-IP;$/m);
  });

  it("trusts that header only from listed ranges, each a valid CIDR", () => {
    const ranges = [...realip.matchAll(/^set_real_ip_from (\S+);$/gm)].map((m) => m[1]!);
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

describe("infra/nginx/00-default-catchall", () => {
  it("is the default server on both ports and answers nothing", () => {
    expect(catchall).toMatch(/^listen 80 default_server;$/m);
    expect(catchall).toMatch(/^listen 443 ssl default_server;$/m);
    expect(catchall).toMatch(/^server_name _;$/m);
    expect(catchall).toMatch(/^return 444;$/m);
    expect(catchall).not.toMatch(/proxy_pass/);
  });

  it("is the only default server in the repo's sites", () => {
    const sites = fs.readdirSync(path.join(root, "infra/nginx")).filter((f) => !f.endsWith(".conf"));
    const defaults = sites.filter((f) => /default_server/.test(directivesOf(read(`infra/nginx/${f}`))));
    expect(defaults).toEqual(["00-default-catchall"]);
  });

  it("uses the certificate the deploy generates, not the origin certificate", () => {
    const cert = catchall.match(/^ssl_certificate (\S+);$/m)![1]!;
    const key = catchall.match(/^ssl_certificate_key (\S+);$/m)![1]!;
    expect(cert).not.toMatch(/cloudflare/);
    expect(deploy).toContain(`-keyout ${key} -out ${cert}`);
  });

  it("the deploy installs and enables it next to the api site", () => {
    expect(deploy).toMatch(/^\s*for site in api\.skkuverse\.com 00-default-catchall; do$/m);
    expect(deploy).toContain('sudo ln -sf "/etc/nginx/sites-available/$site" /etc/nginx/sites-enabled/');
  });
});
