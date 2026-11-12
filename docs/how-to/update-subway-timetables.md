---
title: Update Subway Timetables
type: how-to
status: draft
owner: spencer0124
last-updated: 2026-11-10
audience: internal
---

# Update Subway Timetables

> How to change the timetables the subway arrivals are estimated from: pull the `subway-timetables` dataset, rerun the converter into the pulled directory, preview, push to `_dev` and then production, read the push report, and roll back. No deploy is needed.

## Overview

The timetables are the `subway-timetables` dataset in the content database, a parted dataset: one part per operator line and day type, keyed `<operator>-<line>-<dayType>` (`KR-1-weekday`, `S1-4-saturday`), 18 today ([subway-architecture.md](../explanation/subway-architecture.md#structure)). `scripts/subway-timetable/convert.py` builds the parts from the official sources, and `npm run data` is their only writer: a push checks every table with the server's own schema and refuses one while a platform the checkout serves has no table for a day type its source declares, or while a train stops at a served platform outside the service window (05:00 to 25:10 on weekdays, 24:30 on Saturdays and holidays). The poller and every api replica read a push within a minute, and read only the tables that changed.

Rerun when:

- Korail publishes a new 1호선 or 수인분당선 timetable: update the URLs and revision constants at the top of `convert.py` first;
- Seoul Metro changes the 2, 3, 4 or 8호선 timetable: the Seoul API already serves the new one;
- 신분당선 posts a new station timetable edition: update `SHINBUNDANG_FILES`, `SHINBUNDANG_PLAN` and `SHINBUNDANG_REVISION`;
- a served station, or one of its upstream or watched stations, changes: the line's entry in `LINES`, together with `subway-topology` ([edit-runtime-data.md](edit-runtime-data.md#edit-subway-coverage)).

`convert.py`'s docstring lists the rules it takes from each source and what makes a run fail.

## Prerequisites

- What [edit-runtime-data.md](edit-runtime-data.md#prerequisites) needs: `.env` from `npm run env:pull`, and a build, which `npm run data` runs first.
- Python 3, standard library only. Only the Seoul part reads a key, `SEOUL_OPENAPI_GENERAL_KEY` from the environment; `--only korail` and `--only shinbundang` need none.

## Steps

### Rebuild into a pulled directory

1. Pull `_dev`. This writes `.data/dev/subway-timetables/working.json` and one `parts/<key>.json` per table:

   ```bash
   npm run data -- pull subway-timetables
   ```

2. Rerun the converter into that `parts/` directory. `--out` is required, and each file it writes is named by its part key, so it replaces the pulled file. `--only <source>` or `--line <code>` (repeatable) rebuilds part of it and leaves the other files as pulled:

   ```bash
   SEOUL_OPENAPI_GENERAL_KEY=<key> python3 -I scripts/subway-timetable/convert.py --out .data/dev/subway-timetables/parts --line 2
   python3 -I scripts/subway-timetable/convert.py --out .data/dev/subway-timetables/parts --only korail
   ```

   A rebuilt Seoul table whose trains equal the pulled file's keeps the pulled source revision, so it pushes as unchanged.

   To add stations to a Seoul line without calling again for the ones its pulled tables hold, add `--seoul-keep-pulled` (keep those stations' stop times) and `--seoul-rows scripts/subway-timetable/seoul-rows` (read the saved answers, save the new ones; six calls a station). Commit the saved files with the change. A new Seoul Metro timetable takes neither option, and neither does a change that makes a covered station served: `--seoul-keep-pulled` rebuilds a kept station's rows from the pulled table, which lists only trains that called at a platform served before, so a train that calls only at the newly served one (line `8`'s `8001`, from 가락시장, on 2026-11-10) is lost.

3. Preview, then push to `_dev` with a note:

   ```bash
   npm run data -- push subway-timetables --dry-run
   npm run data -- push subway-timetables --note "Seoul Metro 2026-11 timetable, line 2"
   ```

### Read the push report

The push prints one line per table before it writes:

```text
diff of subway-timetables (revision 1 -> 2):
  unchanged  DX-D1-holiday
  changed    S1-2-weekday  source.revision: "2026-10-16" -> "2026-11-01"; trainCount: 481 -> 483; trains +5 -3 (added 2031, 2033, 2035, 2041, 2043; removed 2030, 2034, 2040)
  added      S1-9-weekday  {"source":{...},"trainCount":310}
  removed    S1-9-holiday  {"source":{...},"trainCount":250}
```

A train counts by its whole row, so a train whose times moved is listed as both added and removed. Check that only the tables you rebuilt changed, and that each train count is plausible. A refusal names the table and the path, such as `S1-4-saturday: no table for S1-4-420 saturday`, `KR-1-weekday.KR-1-P153: 1 stop time(s) outside the service window: 0409 17940 s` or `KR-1-weekday.json.trains.2.trainNo: ...`, and writes nothing. A train outside the service window needs the window widened first: change `SERVICE_WINDOW_OPENS_SEC` or `SERVICE_WINDOW_CLOSES_SEC` in `src/subway/timetable/subway-timetable.constants.ts`, deploy, then push.

Warnings follow the table lines and refuse nothing; `check` prints them too:

```text
2 warning(s), not refused:
  warning  subway-timetables  subway-topology.platforms.S1-4-420.down.upstreamPlatformIds  must be ["S1-4-418","S1-4-417","S1-4-416"], ...
  warning  subway-timetables  S1-4-weekday.S1-4-420.down  the tracked stops skip a station between S1-4-418 and S1-4-420
```

- A `subway-topology.…` warning means the pushed routes disagree with the stored topology. When the coverage change is deliberate, push the matching topology next ([edit-runtime-data.md](edit-runtime-data.md)); its push refuses until the two agree. Otherwise the converter lost a station: fix it before pushing.
- A warning at `<key>.<platform>.<direction>` names a run over 600 s between two stops the tracker follows, a train in view under 10 minutes before the platform, or a skipped station. The tracker's estimate is blind there, so close the gap in the topology's watched platforms and the converter's covered stations.

### Push to production

Pull production and repeat the rebuild there, or copy the `parts/` files of the reviewed `_dev` directory into the production one; never push the `_dev` directory with `--prod`, which the tool refuses.

```bash
npm run data -- pull subway-timetables --prod
cp .data/dev/subway-timetables/parts/S1-2-*.json .data/prod/subway-timetables/parts/
npm run data -- push subway-timetables --prod --dry-run
npm run data -- push subway-timetables --prod --note "Seoul Metro 2026-11 timetable, line 2"
npm run data -- check subway-timetables --prod
```

Within a minute the poller schedules from the new tables and every api replica serves its timetable-only arrivals from them. A part the server cannot read keeps the copy it holds serving for a day, and logs `subway.timetables.part_missing`, `.part_invalid` or `.part_read_failed` with the revision and the key.

### Roll back

```bash
npm run data -- history subway-timetables --prod
npm run data -- rollback subway-timetables <revision> --prod
```

`history` lists each revision's tables with their source and train count. A rollback stores that revision's manifest as a new revision; its parts are still stored while any of the 50 kept revisions names them.

## Troubleshooting

| Message or symptom | Meaning | What to do |
| --- | --- | --- |
| `convert.py: error: the following arguments are required: --out` | The converter writes only into a pulled directory. | Pull first, then pass `--out .data/<dev\|prod>/subway-timetables/parts`. |
| `no table for <platform> <dayType>` | A platform the checkout serves would have no table for that day type. | Rebuild that line, or push from the checkout that matches the deployed platforms. |
| `key "<key>" is in more than one part: <files>` | Two files hold the same table, for example a file you renamed and the one the converter wrote. | Delete one of them. |
| `subway.timetables.table_missing` at error, once per revision | The stored revision has no table for a platform the running code serves, usually a deploy ahead of its push. | Push the table from that deploy's checkout. Until then the tracker rejects every tick after writing the other platforms, and that platform's timetable-only answers are 503 `SUBWAY_TIMETABLES_UNAVAILABLE`. |
| Every other message | The tool's own. | [edit-runtime-data.md](edit-runtime-data.md#troubleshooting). |

## Related

- [edit-runtime-data.md](edit-runtime-data.md#edit-a-parted-dataset): a parted dataset's directory, report, history and rollback in general
- [subway-architecture.md](../explanation/subway-architecture.md): how the tracker and the arrivals route read the tables
- `scripts/subway-timetable/convert.py`: the sources, the rules it applies and its options
- [docs/README.md](../README.md): writing rules
