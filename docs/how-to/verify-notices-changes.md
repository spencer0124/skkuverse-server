---
title: Verify Notices Changes
type: how-to
status: accepted
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# Verify Notices Changes

> The checks to run after changing `/notices/*` code, before merging and deploying it. The contract is [reference/notices-api.md](../reference/notices-api.md).

## Before you start

- A local `.env` with the names in `config/env.dev.keys` (`npm run env:pull` for maintainers). A missing required variable crashes the strict config ([decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)).
- Access to the development notices database (`MONGO_NOTICES_DB_NAME` with the `_dev` suffix).

## Static checks

```bash
npm run typecheck   # tsc over src/ and the tests
npm run lint        # ESLint, then markdownlint
npm test            # Jest, the notices suites included
```

- The specs sit next to each flow under `src/notices/` (`tabs/`, `list/`, `detail/`, `overview/`, `attachment/`, `dispatch/`, `facts/`, `row/`, `screen/`, `legacy/`), the route tests in `__tests__/nest/notices/`. They pin the cursor round-trip for every stored date shape, `NoticesListCursorError` and the sampled production documents (`notices-documents.routes.test.ts`).
- `jest.config.js` holds the coverage thresholds.

## Runtime smoke test (against the development database)

With the server running (`npm run dev`):

1. `GET /notices/tabs`: every tab of `categories.json`, the picker tabs with their `sources`, labels in the `Accept-Language` language.
2. `GET /notices/source/<sourceId>?limit=2`, then the same request with the returned `nextCursor`: the next page, with no row repeated or skipped.
3. `GET /notices?sourceIds=<a>,<b>`: an article posted on both boards appears once, and paging with `nextCursor` never repeats it.
4. `GET /notices/<sourceId>/<articleNo>`: `contentMarkdown` is there, and `content`, `contentText` and `cleanHtml` are not.
5. Error paths: an unknown `articleNo` is 404; an unknown `sourceId` is 400 `INVALID_SOURCE_ID`, with no database call; an unknown `type` is 400; a broken `cursor` is 400 `INVALID_CURSOR`; a repeated `sourceIds` key is 400 `INVALID_PARAMS`.
6. A repeat request with `If-None-Match` set to the returned `ETag` answers 304.

## Index ownership

- Check in MongoDB that the server's read indexes exist: `FORCE_INDEX` and `CLUSTER_INDEX` in `src/notices/list/notices-list.query.ts`. A polling role creates them at boot, and every list query is hinted to `FORCE_INDEX`, so a missing index fails the query.
- Check that the change leaves the crawler's unique `articleNo_1_sourceId_1` index alone: the server never touches it (umbrella ADR 0001).

## Extra checks for a dispatch change

After changing `src/notices/dispatch/` (service, poller, internal controller):

- Call `POST /internal/notices/dispatch-pending`; it answers the sweep counts. Under `PERIMETER_MODE=local-dev` (what `npm run dev` sets) `INTERNAL_AUTHORIZER` allows every internal call. A local run sends nothing: `PUSH_DELIVERY` resolves to `suppressed` in development, so each push is logged as `push.delivery.suppressed` and the claimed `_dev` notices are marked `pushedAt` ([test-the-app-against-a-local-server.md](test-the-app-against-a-local-server.md)).
- The claim lease holds: sweeping the same candidates twice sends each notice once.
- A config change (the dispatch settings, `FCM_FUNCTION_URL`) is caught by the strict config at boot ([decisions/0004](../decisions/0004-strict-config-pre-deploy-dry-load.md)).

## Related

- [reference/notices-api.md](../reference/notices-api.md): the route contracts
- [explanation/notices-architecture.md](../explanation/notices-architecture.md): the design behind these checks
