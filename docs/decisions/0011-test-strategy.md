---
title: Test Strategy — Levels, Doubles and the Guards That Keep Tests Honest
type: adr
status: accepted
owner: spencer0124
last-updated: 2026-11-28
audience: internal
---

# 0011. Test Strategy — Levels, Doubles and the Guards That Keep Tests Honest

> Which level a test belongs to, what it may double, how a run stays deterministic and off the network, and what stops a test from being weakened unseen, with the why behind each. The rules an agent follows are `.claude/rules/tests.md`; the architecture tests named below enforce them. Accepted 2026-10-22.

## Context

- Agents write most tests here, and an agent imitates the test next to the one it writes. Route tests stubbed whole services, service specs mocked `infra/db` and `axios` module-wide, and each route builder copied the `src/main.ts` pipeline by hand, so tests checked copies and call shapes: when the first refactored module renamed a service's methods, its "frozen" route test had to be rewritten.
- An audit with hand mutants found the surviving bugs at the seams: query semantics (filter windows, soft-delete, pagination), cache keys and payload translation. The level that catches them was missing, not under-weighted.
- Nothing stopped a test from being deleted, skipped or loosened to get green, and the session that implemented a change could edit its test. It happened: a regression test was once deleted because a flake blocked the gate. ImpossibleBench (2025) finds most of Claude models' test cheating is editing the test.
- Production runs in `Asia/Seoul`, CI in UTC, laptops in KST. A route test once sent real requests to production hosts.

## Decision

### D1. Five levels, defined by what is real and what is doubled

| Level | Verifies | Real | Doubled |
| --- | --- | --- | --- |
| Unit | A pure decision or reshaping; a service's composition | The unit and its pure collaborators | Repositories and clients as typed fakes; time |
| Boundary | One adapter against what it adapts | The adapter, its translation, captured fixtures | The network; MongoDB unless a real `mongod` runs (D6) |
| Route | One HTTP surface through the production pipeline (D4) | Controller, service, rules, mappers, `bootstrapHttpApp` | Repositories, clients, pollers, the poller registry, `Clock` |
| End-to-end | The deployed system answers with the expected status and shape | Everything | Nothing; public `GET` routes only |
| Structural | Code, config, contracts and infrastructure obey their rules | Source trees, config files, scripts | The binaries a script calls |

- Each level owns the bugs only it can catch: unit the branches and thresholds, boundary the query meaning, cache keys and payload translation, route the envelope, status, headers, validation and wiring, end-to-end the configuration and deployment, structural the drift between declared and actual layout.
- Route tests are integration tests. Nest's docs call supertest tests "e2e", but here the database and upstreams are doubled, so a green route test is never read as proof of production behavior.
- Each role has one kind of test (the table in `.claude/rules/tests.md`; `service-specs`, `sibling-specs` and `spec-titles` check parts of it).

Rejected: a target ratio between levels (pyramid, trophy, honeycomb). No controlled study supports one, and the audit's gap was a missing level, not a skewed mix.

### D2. Doubles only at I/O edges, chosen by role

- Only what crosses the process boundary (MongoDB, HTTP, FCM, the clock) or a sibling module's exported provider may be doubled, never the unit or its pure collaborators.
- A `jest.mock` of a module stays at its boundary: `src/infra/db` only in a repository spec, `axios` only in a client spec. A service spec that mocks them is tied to the repository's call shape.
- State over interaction: assert the return value, the response or the fake's final state; assert a call only when the call is the behavior (one FCM send per notice) or for an argument the response cannot show.
- Enforced by `route-overrides` and `spec-mocks`; an exception is a reasoned entry in `exemptions/spec-mocks.json` or `production-callers.json` citing this decision.

Rejected: the mockist style, which stubs every collaborator. Its tests are change detectors, as the renamed-service rewrite showed.

### D3. A fake follows the real read

- A fake is `class Fake<Name> implements PublicOf<<Name>>` (`__tests__/helpers/fakes/public-of.ts`), checked by `fake-shape`. `PublicOf` restates each method as a function type because a class with private fields cannot be implemented directly, and TypeScript checks method parameters bivariantly: without function types, a real method widened to accept more (a new `"all"` campus) would still type-check against a fake that cannot handle it. An added or renamed method then breaks `npm run typecheck`, not a run.
- A fake applies the real read's filter, projection and sort, and the repository spec pins that query object, so a change to one shows in the other. A fake that returns whole documents hides a dropped projection.

### D4. Route tests run the production pipeline

`buildTestApp` boots the modules through `bootstrapHttpApp`, the function `src/main.ts` calls, so a route test runs the real middleware order, CORS, interceptor and filter. It listens once on `127.0.0.1`: a bare `listen(0)` binds every address, and a local app holding the port on loopback answered instead (random 401/404s on macOS).

Rejected: keeping per-module copies of the pipeline and comparing them with `src/main.ts`. That still tests a copy.

### D5. Deterministic runs

- **Tests run in UTC** (`jest.config.js`, `test-timezone.test.ts`), not production's `Asia/Seoul`, on purpose: correct code names its zone, and under UTC a hidden host-zone dependency fails instead of passing by coincidence. KST date logic is tested at an instant where UTC and KST fall on different days, asserting the right answer and the absence of the wrong one.
- **The clock is injected** (`Clock`) or passed in. Rejected: Jest fake timers as the clock (global, and they also stop the `setTimeout` that pollers and `createCachedLoader` use); passing the time in from the controller (it never reaches a poller).
- **No test leaves the machine.** `__tests__/helpers/network-guard.ts` fails any non-loopback connection, DNS lookup or `fetch`, naming the host, and refuses a listen on anything but loopback.

### D6. Boundary tests: a real `mongod` where a query has meaning

- A real `mongod` (`mongodb-memory-server`, `__tests__/helpers/mongod.ts`, its version pinned to the one Atlas runs) runs the characterization and dataset tests. Adopted by the owner on 2026-10-15 on the pilot's numbers: about 1.3 s per file, the full suite within noise, ten consecutive green runs; a CI cache miss adds a ~100 MB download.
- Repository specs stay fake-backed. What their queries match in a real `mongod` is a test under `__tests__/nest/`: the notices list, detail and dispatch claim in `notices-characterization.routes.test.ts`, the shuttle pattern and override reads in `schedule-characterization.routes.test.ts`, and the mini-app notification Idempotency-Key claim in `miniapps-notifications-claim.test.ts`.
- A repository spec pins the exact filter object.
- A characterization route test for a module about to move seeds documents, overrides no repository or service and asserts HTTP responses only. A failure during the move is a regression to report, never a reason to edit the test.

### D7. Contracts and fixtures

- Every route that declares a wire schema has a route test that checks a real response against it with `expectWire`, added as a new assertion, never as an edit to a frozen one (`wire-assertions`). `__tests__/contracts/` checks `contracts/produced/` against the wire files.
- Every fixture states its origin in `_about`: the source, the capture date and what was trimmed, or that it is synthetic and why. No user data (`fixture-provenance`).
- A test input that disagrees with the real payload is fixed in the test. Production code is never widened to accept it.

### D8. Ratchets keep the tests honest

The guards run on the ratchet harness of ADR 0010 D9: `test-hygiene` (focused, skipped or empty tests, the AAA markers), `test-floors` (a module's test and `expect(` counts), `fake-shape`, `route-overrides` and `fixture-provenance`. A deletion or merge lowers its floor in the same diff, which is the review signal.

- Coverage below `coverageThreshold` fails `npm test`. Not built yet: the tighter floor (every `src/` file counted, and a CI step that fails when coverage runs more than 2 points above the threshold).

Rejected:

- `eslint-plugin-jest`: a new lint dependency, which ADR 0010 D9 rules out; the AST rules cover the same cases.
- A trailer check on removed `it(` lines: the gate runs before anything is committed.
- A hook that makes existing test files read-only while implementing: it also blocks legitimate red-phase edits. It is the next step if floor edits keep appearing in agent diffs.

### D9. One definition of TDD, split across sessions when needed

- Five steps, written once in `.claude/rules/tests.md` ("Write a test first"): pick the level, write the test from the behavior, watch it fail on its assertion, implement without editing it, and stop if it looks wrong. A test written against frozen code passes on its first run, which proves nothing, so each seam gets one or two hand mutants that must fail it, listed in the commit message.
- **Red and green in two sessions**, so the implementer cannot pass a test by editing it: the red commit carries `Expected-Red: <test file>, …` (counted only if that commit adds or changes the file), the green commit `Red-Fixed: <test file>, …` and leaves the test untouched. The test author first runs the red test against a sketch of the change in a scratch worktree: a red test can fail for the right reason and still be unpassable.
- **The commit gate** (a local hook in the maintainer's setup, outside this repository) checks the files a `git commit` will contain, not every Stop: subagents record their edits under the parent's session, so a Stop gate checked their half-done work. It runs typecheck, ESLint and markdownlint on the edited files and the related tests, plus the architecture suite when a test file changed and the file-reading suites when their inputs changed. It treats a file as expected red when the commits not yet on `main` list it in `Expected-Red` and not later in `Red-Fixed`. Its block message says: "Do not edit, skip or delete an existing test to get green. If a test looks wrong, stop and tell the user."

### D10. Mutation testing reports, never gates

Not built yet. Stryker on pull requests in `--incremental` mode over the changed lines of `*.rules.ts`, `*.mapper.ts` and `*.query.ts`, survivors written to the job summary, never failing the build; the owner decides after a month whether it stays.

Rejected: a global mutation-score gate. No study measures one as a gate, and Google's practice is diff-scoped and shown in review.

### D11. End-to-end: a read-only smoke after each deploy

Not built yet. After the rolling update, the deploy compares a committed list of public `GET` routes on one replica against committed baseline shapes (`scripts/compare-responses.js` in shape mode); a difference warns first, and fails through the rollback path after two clean deploys. `npm run verify:serve` stays the manual pre-deploy check.

Rejected: a scheduled synthetic monitor. Liveness is already watched; the gap is the shape after a deploy.

### D12. The shape of a spec

Each spec opens with a docblock naming the behavior it guards, and each test body marks `// Arrange`, `// Act`, `// Assert`, an explicit exception to ADR 0010 D10 (`test-hygiene`). A spec is deleted only in the commit that deletes the code it tests, except a spec that pins nothing but delegation, removed in a template pass and named in the commit.

## Consequences

- The level and the doubles are decidable from D1 and D2 rather than from the neighbouring file, and refactors inside a module's services keep its route tests green unedited.
- Weakening a test is a visible diff: a lowered floor, an exemption or a missing marker.
- A laptop in KST and CI in UTC get the same result, and no test reaches production.
- Fakes duplicate each read; the pinned query keeps them in step.
- Expected red masks the rest of its file while it lasts, so the window stays short.
- A real `mongod` adds a binary fetched at install and startup time to the runs that use it.

Out of scope: a browser or app-level end-to-end suite (the app repository's), and raising coverage as a goal.
