/**
 * The api replicas are named in four files, and a replica missing from any one
 * of them fails quietly:
 *
 *   - docker-compose.yml runs it;
 *   - infra/nginx/api.skkuverse.com sends it traffic (missing: it idles);
 *   - the deploy workflow (deploy-host.yml, run once per host) rolls it
 *     (missing: it keeps running the old image);
 *   - docker-compose.local-verify.yml points it at _dev databases (missing:
 *     `npm run verify:serve` boots it against PRODUCTION data).
 *
 * This reads all four and requires them to name the same set. The files are
 * parsed with patterns rather than a YAML parser: their shape is fixed and the
 * repo avoids a dependency for it.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const compose = read("docker-compose.yml");
const verify = read("docker-compose.local-verify.yml");
const nginx = read("infra/nginx/api.skkuverse.com");
const deploy = read(".github/workflows/deploy-host.yml");

/** Service blocks: two-space-indented keys under `services:`. */
function serviceBlocks(yaml: string): Map<string, string> {
  const services = yaml.slice(yaml.indexOf("\nservices:\n"));
  const blocks = new Map<string, string>();
  const re = /^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gm;
  for (const m of services.matchAll(re)) blocks.set(m[1]!, m[2]!);
  return blocks;
}

/** api-N service → published loopback port, from docker-compose.yml. */
const composeReplicas = new Map<string, number>();
for (const [name, block] of serviceBlocks(compose)) {
  if (!/^api-\d+$/.test(name)) continue;
  const port = block.match(/"127\.0\.0\.1:(\d+):3000"/);
  if (!port) throw new Error(`${name} publishes no 127.0.0.1:<port>:3000`);
  composeReplicas.set(name, Number(port[1]));
}
const sortedPorts = (ports: Iterable<number>) => [...ports].sort((a, b) => a - b);

describe("api replica topology", () => {
  it("defines at least two replicas, each on its own port", () => {
    expect(composeReplicas.size).toBeGreaterThanOrEqual(2);
    expect(new Set(composeReplicas.values()).size).toBe(composeReplicas.size);
  });

  it("nginx balances across exactly the replicas compose runs", () => {
    const upstream = nginx.match(/upstream skkubus_api_new \{([^}]*)\}/);
    expect(upstream).not.toBeNull();
    const ports = [...upstream![1]!.matchAll(/^\s*server 127\.0\.0\.1:(\d+)\b/gm)].map((m) =>
      Number(m[1]),
    );
    expect(sortedPorts(ports)).toEqual(sortedPorts(composeReplicas.values()));
  });

  it("the deploy rolls exactly the replicas compose runs, with their ports", () => {
    const list = deploy.match(/REPLICAS="([^"]+)"/);
    expect(list).not.toBeNull();
    const rolled = new Map(
      list![1]!.split(/\s+/).map((entry) => {
        const [name, port] = entry.split(":");
        return [name!, Number(port)] as const;
      }),
    );
    expect(rolled).toEqual(composeReplicas);
  });

  it("local verify points every replica at _dev databases", () => {
    const blocks = serviceBlocks(verify);
    for (const name of composeReplicas.keys()) {
      expect(blocks.has(name)).toBe(true);
      expect(blocks.get(name)).toMatch(/environment: \*api-dev-env/);
    }
    // The shared list itself must rename every database the api writes.
    const env = verify.match(/x-api-dev-env: &api-dev-env\n((?: {2}- .*\n)+)/);
    expect(env).not.toBeNull();
    for (const key of [
      "MONGO_DB_NAME_BUS_CAMPUS",
      "MONGO_AD_DB_NAME",
      "MONGO_BUILDING_DB_NAME",
      "MONGO_NOTICES_DB_NAME",
      "MONGO_EVENTMAP_DB_NAME",
      "MONGO_MINIAPPS_DB_NAME",
    ]) {
      expect(env![1]).toMatch(new RegExp(`- ${key}=\\w+_dev\\n`));
    }
  });
});
