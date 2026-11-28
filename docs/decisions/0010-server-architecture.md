---
title: Server Architecture — One Module Shape, Enforced by Tests
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-11-28
audience: internal
---

# 0010. Server Architecture — One Module Shape, Enforced by Tests

> The one shape every module in `src/` follows, why, and what was rejected. What the shape is in detail is executable: ESLint (`eslint.config.js`) and the architecture tests (`__tests__/architecture/`) reject code that breaks it, and `.claude/rules/architecture.md` and `.claude/rules/naming.md` hold the placement rules that need judgment. `src/building/` is the reference module; where it and this record disagree, the tests decide. Accepted 2026-10-15.

## Context

After the Express → NestJS port the code did each job several ways: logic in controllers, services or plain function files; Mongo reached from many files and read untyped; features importing each other's internals; folders mixing layer and feature folders; and the rules that held it together written in comments, about a quarter of the lines in `src/`. An agent adds code by imitating the files next to it, so with no single pattern new code drifts further, and a rule written in prose holds only if someone reads it. This decision sets one structure an agent can follow from the code alone, and makes the build reject code that breaks it.

## Decision

D1–D8, D10 and D11 set the shape, D9 enforces it, D12 says how a structural migration ships, D13 decides who defines a shape that crosses a repository boundary, and D14 sets the module docs.

### D1. Layers: Controller → Service → Repository, plus pure files (DDD-lite)

- A controller maps HTTP to one service call; a service composes the use case; a repository runs named queries over typed collections; a client makes every outbound third-party call and translates its payload, so a raw upstream shape never leaves the client file (anti-corruption layer). Decisions go to pure `*.rules.ts`, reshaping to `*.mapper.ts`, Mongo construction to `*.query.ts`. A third-party call several modules share lives in `src/infra/`, named by the resource (`fcm.ts`).
- A flow whose state lives in field combinations derives a typed status in pure functions, without changing the stored documents (mini-app delivery: `DeliveryStatus`).
- One name per concept inside a module; wire field names never change for it.
- **Dependency direction.** Pure code receives its I/O as arguments typed by an interface the calling side owns (`LiveEtaDeps`). Nest classes inject concrete classes. An `abstract class` token is used only when a role has two real implementations, never an interface with a string or Symbol token. A module cycle is broken by moving the code that composes the two sides, never by inverting a dependency or `forwardRef`: the smart schedule handler lives in `bus/eta/smart/`, so eta depends on schedule and never the reverse.
- **No 1:1 delegate services, with one exception:** a module another feature reads exports a service as its door, because D9 lets a feature import only another's `.module` and `.service` files, and that service may forward to the module's repository unchanged. Inside the module, flows inject the repository (`BuildingService` is `map`'s door; nothing in `src/building/` calls it).

Rejected:

- A functional core with no service classes: fights the Nest convention agents copy, and pollers still need DI.
- Keeping the 1:1 delegates: boilerplate agents skip, as `ui` importing `bus-config.data` directly showed.
- Full tactical DDD (entities, aggregates, domain events): only 4 of 24 features write domain state; agents over-generate DDD ceremony and handle aggregates poorly (Böckeler, martinfowler.com, 2025-08-05); more files per change lowers agent success (SWE-Bench Pro, 2025).
- An interface plus an implementation per repository and client: each has one implementation (even NAVER and TMAP feed different pollers); Nest erases interfaces, so each pair needs a token and `@Inject()`, one more hop from call to code; `overrideProvider(...).useValue(...)` already substitutes a concrete class in tests. Extract an interface when a second implementation appears (Fowler, InterfaceImplementationPair, 2005).

### D2. Data access: one repository per flow, typed

- **One repository per flow, not per collection**: each opens the collections its own queries need, so several repositories may open one collection. Each collection's document type is written once, in the module root's `.document`; a projection one flow reads lives in that flow's folder.
- Mongo syntax (filters, pipelines, updates, projections, `$facet` decoding) lives only in repositories and `.query` files, and a repository returns data, never a response. Every repository read is bounded by `maxTimeMS` or served through `createCachedLoader`. Enforced by ESLint, `repository-returns` (`method-verbs.test.ts`) and `repository-reads`.
- **Externally written data is read tolerantly**: project only the fields used, ignore unknown ones, parse with zod in the repository, and drop and log a bad document rather than failing the request. A dropped `bus_overrides` document is also a Sentry Issue, at most hourly per document: an override closes or replaces a day, and without it the day falls back to the weekly pattern, so a closure the operator wrote would serve the regular timetable. A dropped pattern is only logged, since its days fall back to the non-operating display.
- **Notice reads are typed, not parsed**: they are hot and uncached, so they get a corrected type (`articleNo` is an int in the crawler) instead of a zod pass per request, until the crawler's exported schema replaces the hand-written type (D13).
- Two later changes stay one file away: the crawler-owned notice type lives alone in `notices/notices.document.ts`, so a generated type can replace it; push bookkeeping goes only through `NoticesDispatchRepository`, so moving it to a `notice_dispatch` collection touches one file.
- Neither the native driver nor Mongoose rejects an invented filter key at compile time; that is why queries are confined to named repository methods.

Rejected:

- Plain query functions with import limits: two seams to stub in tests, and inconsistent with D1.
- Mongoose: the hot path needs `lean()`, which skips its casting and validation; it runs `createIndex` and `createCollection` at startup against collections other services own; mongoose 9.11.1 pinned `mongodb ~7.7` while this repository ran 7.2.0; its filter and `$set` types accept wrong value types the native `Collection<T>` rejects (checked with `tsc`).

### D3. Folders: one role file per folder; a second one makes a sub-module

- A folder holds at most one file per role, named after the folder's module. A flow that needs a second file of a taken role becomes a Nest sub-module in its own folder, whatever its size. A module with sub-modules keeps no flow at its root: the root holds the module file (URL prefix, limiter, exports) and what several flows share. Dependencies point from child to parent; a parent never imports a child, and `src/app.module.ts` registers every sub-module in route order. Enforced by `folder-roles`, `split-root`, `sub-modules`, `root-exports-shared` and `route-order`.
- **Reading a folder at a glance is the editor's job, not a folder's.** The committed `.vscode/settings.json` nests specs, rules, mappers, types, queries and documents under their role file, and a split root gets one literal key so its shared files fold under the module file (`folders.test.ts` checks the keys). Files stay where they are, so git, review and agents see the real tree.

Evidence: on the repository's history (177 commits touching `src/` after the cutover) a layer-folder layout would have touched 3.26 folders per commit, slices 2.57, the then-current layout 2.43. Inside building, role subfolders touch 3.89 folders per commit against 1.68 flat (58% of commits three or more folders, against 21%), and tier subfolders 2.53, labelling boundaries its imports cross both ways (domain → data 12, data → domain 11). Building's flows change apart (feature commits: 5 sync-only, 12 read-only, 3 both), and with flat folders its flows piled into one 432-line mapper and a 425-line rules file with no rule failing. File paths are a primary localization signal for agents (Agentless, 2024: 78.7% file-level localization from the tree alone). NestJS and the Angular style guide prescribe feature folders without type subfolders.

Rejected:

- Flat folders with flow prefixes: the mixing stays unchecked and the prefix optional.
- A sub-module only for a sub-feature with its own entry point and data source: it needs judgment and cannot be tested, and its own exception list contradicted it.
- Role or tier subfolders inside a module: measured above, and against vendor guidance ("Avoid creating subdirectories based on the type of code", angular.dev).
- A parent module that imports its children (the Nest CLI default): a child could not inject the parent's shared providers without a cycle.
- A split root's shared files in a subfolder (`core/`, `_shared/`): 79–94 import paths change, the folder rules would need exceptions named after the folder, and notices' contract-pinned files must stay at its root anyway. VS Code cannot nest a file under a folder, so one row is the floor.
- Layer folders everywhere, and slice folders without sub-modules (keeps hidden cross-slice imports).

### D4. File names: a closed suffix vocabulary

- Every file under `src/` takes a role suffix from the closed list in `__tests__/architecture/` (`.module`, `.controller`, `.service`, `.repository`, `.client`, `.poller`, `.rules`, `.mapper`, `.query`, `.config`, `.schema`, `.wire`, `.types`, `.document`, `.constants`, `.error`, the HTTP pipeline roles (`.guard` among them), `.bootstrap`, `.util` in `shared/` only, `.ports` for `src/perimeter/perimeter.ports.ts` alone, `.spec`, `.generated`); `src/infra/` files are named by the resource they wrap, and a perimeter implementation by the port it implements ([ADR 0023](0023-perimeter-ports.md), D4). Names, class names, exported types and verbs are checked by `naming`, `exported-types` and `method-verbs`.
- **Method verbs carry a return contract**, read from the declared return type (`find*` one or `null`, `list*` a collection, no `get*` on a repository). Written only as prose such a rule drifts: in a Python codebase studied for this decision, about a fifth of the `get_*` methods broke their documented "raises when missing" contract.
- **A brand holds only an invariant code relies on.** Each brand has one minter in the declaring folder's `.rules`; entry points compose it and never cast. The invariant of an ID another system owns is what this code relies on, tagged `QUIRK(<system>)`, never an invented business rule: "a building id is at least 100" would reject every real id (1 to 88) and stop the sync. Which buildings to show is a filter over valid ids (`brand-casts`, `brand-minters`). Rejected for the minter: a shared zod schema per id (a predicate composes into zod, not back); zod's `.brand<>()` (a second nominal type tied to the schema library); the predicate in `.types` (no runtime code there); a value-object class (documents, JSON and Mongo `_id`s carry plain values, so every boundary would wrap and unwrap).
- **A `.service` need not be a Nest provider**: a plain engine that composes one flow's use case, holds its mutable state and gets its I/O as a deps object, built by its poller in `onModuleInit` (`BusEtaLiveService`), keeps the suffix, because composing a use case is what `.service` names.
- A `.rules` function decides or computes, a `.mapper` only reshapes, a `.query` writes Mongo. A rule that must reach the database splits: the decision stays in `.rules`, its Mongo form goes to `.query`.

### D5. Validation: zod

- Request input goes through `ZodValidationPipe`, which takes the `AppError` code to throw, so the public error codes and messages stay as they are.
- **A committed config file fails the boot** with every issue, through `parseConfigFile` (`config-files`). It parses at import, or when Nest builds the provider whose check needs another provider.
- **Runtime data that leaves the repository is a dataset** ([ADR 0013](0013-runtime-data-in-mongodb.md)): validated at push and parsed at read, never a boot failure. Operator-edited content fails soft per item at read (a bad festival layer set is left out and the base map serves, `storedLayerSets`), because failing the boot would take every route down for one event's typo. A committed file that must fail soft instead takes a reasoned `config-files` exemption citing this decision.
- Externally written DB data: D2.

Rejected: class-validator, Nest's documented default. It is class-based, does not fit plain JSON or DB documents, and would leave two validation styles.

### D6. Responses: handlers return values

- The global `ResponseInterceptor` writes `{ meta: { lang }, data }`, leaving `meta.lang` out of a response a shared cache may store (`public` or `s-maxage`), because Cloudflare keys that cache without `Accept-Language` (`public-cache-lang`). Extra `meta` is `withMeta()`, headers are `@CacheControl()`, ETag and 304 are `EtagInterceptor`.
- `@Res()` remains only for the attachment stream and `/health`, whose probes read the status code alone.
- A handler reads the language with `@Lang()`, never `req.lang as SupportedLang`: the cast hid the `undefined`, and the decorator throws when the middleware did not run (ESLint `boundaries/lang`).
- CORS exposes `ETag` on every response, a 304 included.

### D7. Rate limiting and auth: middleware, declared next to the controllers

- Both stay middleware, and both decisions sit behind perimeter ports ([ADR 0023](0023-perimeter-ports.md)): the middleware classes in `src/http/` are public bindings. The authentication middleware asks `REQUEST_AUTHENTICATOR` and must set `req.principal` before the limiter, which may key on it; a guard runs after middleware. A limiter middleware hands each request to the handler `RATE_LIMIT_POLICY` returns for its class.
- The module that owns a URL prefix binds the limiter once in its `configure()`. A sub-module under the same prefix binds nothing: the policy holds one handler per class per process, so a second binding counts each request twice. Every controller path is limited or on the exempt list (`internal/*`, `health`): `rate-limit-coverage`.

### D8. Config: `infra/config` only

Every module reads config from `src/infra/config.ts`. The required list is one side-effect-free file (`src/infra/required-env.ts`) that both `src/infra/config.ts` and the Nest bootstrap check ([ADR 0004](0004-strict-config-pre-deploy-dry-load.md)).

### D9. Enforcement: lint and architecture tests, with a ratchet

The rules are ESLint blocks (`eslint.config.js`) and Jest tests (`__tests__/architecture/`); read them for the exact rule. What they cannot say:

- A runtime import of another feature is allowed only for its `.module` and `.service` files; `import type` across features is allowed, since types are erased and the runtime boundary is Nest DI.
- `sub-modules` is a test, not ESLint, because flat config replaces a rule's options per block: exempting a file in one block would also exempt it from the cross-feature boundary.
- `require()`, `import()` and a `..` after a folder name are banned outside specs, because every boundary reads import declarations and matches their paths as written. One `require` is the exception: `src/perimeter/perimeter-overlay.rules.ts` loads the perimeter overlay's entry by a path built from its own folder, since the entry is supplied at build time and nothing may import it ([ADR 0023](0023-perimeter-ports.md), D4). It carries the one inline disable, and `eslint-syntax.test.ts` pins that it is the only `require` in `src/`.
- **Strict over all of `src/`.** No allowlist holds a file under `src/`, and a module is bound from its first file (scopes derive from the tree). A file a rule cannot fit takes a reasoned entry in `__tests__/architecture/exemptions/` that cites a decision `docs/decisions/` declares; `list-growth` and `list-registry` check it. A rule added later fixes `src/` in its own commit or uses that exemption. An allowlist records debt outside `src/` and the module test folders only (`scope-entries`), and only shrinks.
- **Size caps count comment lines**, so moving an explanation into a comment buys no room, and a test keeps every limit within a few lines of the worst offender so a cap never holds slack for new code.
- **A role file at its cap splits its flow along a domain seam** into sub-modules. Code never spills into another role file of the folder or up into the module root, since the cap would then choose the placement. With no domain seam the file takes a per-file cap in `exemptions/size-caps.json` whose reason says why no seam exists; the role's cap for every other file stays. Rejected: moving the overflow to `src/shared/` (it holds what several features share, not one flow's overflow), and a cap per module or folder (raises the limit for files that do not need it).
- What needs judgment (where a join goes, which repository owns an index, rules vs mapper vs query, how to name) is written in `.claude/rules/architecture.md` and `.claude/rules/naming.md`, not forced into heuristic tests.

Rejected:

- eslint-plugin-boundaries or dependency-cruiser: they express folder rules more directly but add dependencies, and the repository already uses tests as rules.
- `@typescript-eslint/no-magic-numbers`: on building's `.rules` and `.query` files every hit was a unit factor inside an already named constant (`5 * 60 * 1000`); an ignore list wide enough to pass would pass a new magic number too.

### D10. Comments: the code says what, a comment only what the code cannot

The default is no comment: what a block does becomes a function name, what a value means a constant, a compound condition an `is…` predicate, a heading over part of a file its own file. A comment is allowed only for what code cannot carry, and opens with its kind's tag: `QUIRK(<system>):` (behavior outside this repository the code relies on), `CONTRACT(<repo>):` citing `<repo>/<path>` (another repository or script that reads or writes this data), `EVIDENCE:` (the measurement, incident or limit behind a value), `WHY:` (a deliberate choice a reader would undo), or `SEE: docs/<path>` for a pointer. Never what the code does, history, a heading, a restated signature, a list of callers, a TODO without a tracked task or commented-out code. At most three lines; a longer rationale goes to `docs/` and the comment cites it. A shared layer's comment names no feature, since a shared layer does not know its callers. Checked by `comment-tags`, `comment-blocks`, `history-comments`, `route-comments`, `section-comments` and `shared-comments`.

Exceptions: specs (`.claude/rules/tests.md`); `eslint-disable` lines, `@ts-expect-error <reason>` and triple-slash directives; the vendored, hash-locked contract files.

Why this strict: about a quarter of the non-blank lines in `src/` were comments on 2026-10-10 and nothing checked them. In building alone the pilot found a pointer to a file that no longer existed, a comment "mirrors `$ifNull`" above code whose sibling explains why it deliberately does not, and a claim that the reads project out `updatedAt`, which none did. An agent reads a comment as true; a name, a constant or a type is checked by the compiler. Section dividers are banned for the same reason: building's mapper held a sync half and a response half behind headings that had drifted.

Rejected: a cap on the share of comment lines per file, which pushes out a needed why as readily as a restated what; judgment alone, which left a repository a quarter comments after the first comment pass.

### D11. Tests next to sources

Unit tests sit next to their source as `<name>.spec.ts`; route and infrastructure tests stay in `__tests__/`. Specs are type-checked with the sources and never built into `dist/`. The test strategy is [ADR 0011](0011-test-strategy.md).

### D12. Phase order

The migration to this shape finished on 2026-10-15. A later structural migration across modules follows the same rules: guardrails before moves, providers before consumers, risk last; one PR per stage, deployed `dev` → `main` and verified by diffing production responses; route-test assertions are not edited during structural commits; a move (`git mv`) is committed apart from edits, so rename detection shows the real diff; no stage migrates stored data, so reverting its PR is a complete rollback.

### D13. Boundary contracts

Every shape that left the repository was defined by hand two or more times and nothing checked the copies, so drift was found in production each time (`createdAt` vs `crawledAt`, `pushAttempts` never initialised, the crawler dropping the v2 summary keys).

| Boundary | Source | Mechanism | Strictness |
| --- | --- | --- | --- |
| Third party → a server deployable | the server's `.rules` minter (D4) | parsed at the `.client`, only the constraints the code relies on, tagged `QUIRK(<system>)` | strict on the relied-on fields only |
| server `src/` ↔ server `scripts/` | the server's `.schema` | an equivalence spec feeds the same inputs to both; datasets instead run the server's compiled code ([ADR 0013](0013-runtime-data-in-mongodb.md), D5) | strict |
| one server deployable ↔ another (poller → api) | the shared definition in `src/` | import; nothing is exported | as the reader needs |
| crawler → Mongo `notices` → server | the crawler's pydantic `NoticeDocument` | the crawler exports JSON Schema and fixtures, the umbrella copies them to `contracts/consumed/`, the server generates its types and its reader passes the fixtures | writer strict, reader open |
| server → app, web, mini apps | the server's `.wire` zod | `contracts/produced/` and fixtures; clients generate types and test tolerant parsers against the fixtures | server strict, clients tolerant |
| server → FCM Cloud Function → device | the server's `.wire` zod (`src/infra/fcm.wire.ts`) | as for HTTP responses; a push `webview` or `external` link takes any absolute https URL, not the home layout's own-origin `webview` rule, which would refuse the third-party pages a push may open (restricting it is an open owner decision) | server strict, relay and device tolerant |
| crawler ↔ ai | the ai's FastAPI OpenAPI | the umbrella copies it | both strict |
| brands; the fixed envelope | the server only | not exported; a route's wire describes its `data` and extra `meta` | — |

- **The writer owns the schema**, in its own validator (server zod, crawler pydantic, ai FastAPI). Across a repository or language it publishes JSON Schema and golden fixtures; readers generate from it or test against the fixtures, never restate it, and stay tolerant.
- **The provider defines both directions of its API** (the server its HTTP API, the ai its own).
- **A relay does not own its payload.** The Cloud Function adds targeting and passes the data fields through; the server gives them meaning (`actionType`, `actionValue`), so the server owns the push payload.
- **Same repository: import, never export.** A shape one deployable from this repository writes and another reads (`bus_cache`, `shuttle_eta`) has one definition in `src/`. The rule names deployables, not repositories, so a future ingest deployable in this repository moves no row.

The `.wire` role:

- A wire schema must export to draft-07 JSON Schema without losing a constraint, so it uses no `transform`, `refine`, `brand`, `pipe`, strict object and the like (`wire-schemas`). The export alone is not a check: zod 4.6.5 throws only on `custom` and `date`, silently drops `refine` and `brand`, and exports the input side of a `transform` or `pipe`. No object is strict, so a consumer holding an older copy accepts a response with a new field. Draft-07 because the consumers' generators (json2ts, quicktype) read it; pydantic emits 2020-12, so a consumed export picks its target per producer.
- **A `.schema` wraps a wire schema, never the reverse**: brands, refinements and transforms stay internal.
- **`tsc` ties the sent shape to the schema** through the controller's declared wire return type, but an extra field still passes `tsc` (no excess-property check on a variable); the fixture check catches it (`wire-routes`, `__tests__/contracts/`).
- **A backfilled wire records what is served today**, unread fields included. Publishing never changes a response; removing a field is its own behavior change.
- The export runs inside Jest (`__tests__/contracts/`), so drift fails `npm test` with no new CI step: a `dist/`-based script sees drift only after a build, Node's type stripping cannot resolve the extensionless imports in `src/`, and ts-node or tsx would be a new dependency.
- Fixtures are cut from production captures, trimmed to the cases that differ in shape, with no user data; push payload fixtures are synthetic and say what they mirror. The schema is open for consumers and closed for the server's own fixtures, so it documents every field the server sends.

**Open:** the crawler does not yet publish `NoticeDocument` as JSON Schema with fixtures, so `src/notices/notices.document.ts` stays hand-written. `contracts/consumed/` holds only the schema of the `schedule` field, which `src/notices/schedule/notices-schedule.schema.ts` mirrors in zod under a contract test that fails on a required-key or enum difference. When the document schema lands, strip pydantic's auto `title` before generating: `json-schema-to-typescript` turns `title: "Date"` into `export type Date = string`. Copying the produced artifacts to their readers is umbrella work.

Rejected:

- A JSON Schema-first umbrella with code generation per language: TypeScript generators are weak (`json-schema-to-zod` archived 2026-06, `z.fromJSONSchema` semi-experimental and typed `unknown`), brands are not representable, the standard-library-only umbrella would need four hand-written generators, and the source moves away from the writer.
- MongoDB `$jsonSchema` as the source: a draft-4 subset (no `integer`, `$ref`, `format`, `const`), no code generation, and `error` mode can stop the crawler or a push. Possible later as a `warn`-mode guard.
- Rewriting the crawler in TypeScript: 14k source and 19k test lines, an HTML stack to re-match, and the ai stays Python.
- Fixtures only: type drift such as `articleNo: string` is caught only if a fixture happens to carry it.
- Shipping the server's zod, or ts-rest, to the app: old OTA bundles stay installed, so a strict client breaks on a new field, and ts-rest reshapes the controllers.
- Wire schemas inside `.schema` files by convention, or a `z.registry()`: mixes publishable and internal schemas, the wrapping direction cannot be checked per file, and a registration is a side effect that is easy to forget.
- The suffix `.contract`: it collides with `CONTRACT(<repo>):` comments and the umbrella's contracts.

### D14. One architecture doc per module, in a checked format

Each feature module has one explanation, `docs/explanation/<module>-architecture.md`, copied from `docs/_module-template.md`, loaded for agents by `.claude/rules/<module>.md` and pointed to by a `SEE:` line on the module class. Its shape is checked: markdownlint MD043 (`docs/.markdownlint-cli2.jsonc`), `module-docs` and `glossary-coverage`; the glossary's `Not` column is the ESLint `glossary/<module>` `id-denylist` block.

- The sections follow arc42 §3 (a context table) and §12 (a glossary against synonyms) and the Bounded Context Canvas (purpose, language, business decisions as Invariants). Three fixed tables and 200 lines, the size an agent loads whole; field-by-field reference stays in the generated contracts (Diátaxis). One Mermaid `flowchart` with labelled one-way arrows, not Mermaid's experimental C4 syntax.
- Invariants cite an ADR instead of restating it.
- Reviewed, not checked: that Context says what the module owns and what it only mirrors, and that each glossary and field row is true.

Rejected: Vale (a Go binary outside npm that cannot read `src/`; revisit past about twenty banned words); remark-lint with a frontmatter schema (four dependencies for six keys); lychee or markdown-link-check (`module-docs` checks local links); custom markdownlint rules (cannot see `src/`); the full arc42 template (mostly empty for one module); the glossary in `.claude/rules/naming.md` (loads on every `src/` edit and is checked against nothing); free-form docs (map's and notices' were 487 and 194 lines in two shapes).

## Consequences

- **Placement is decidable from the rules**: a query goes in a repository, a third-party call in a client, a decision in `.rules`, and imitating any module produces correct code.
- **Mistakes fail CI, not review**: a misplaced file, a wrong suffix, a forbidden import or an unthrottled route fails `npm test` or `npm run lint`.
- **Typed collections**: wrong value types in filters and updates fail at compile time.
- **Smaller test seams**: pure files are tested without Mongo or Nest; repositories and clients are the only seams to double.
- **The ratchet is strict both ways**: a change that fixes a listed violation in passing fails until the entry is removed, and a limit is lowered in the commit that shrinks its worst offender.
- **Open:** moving notice push state to a `notice_dispatch` collection, and generating notice types from the crawler's export (D13).
