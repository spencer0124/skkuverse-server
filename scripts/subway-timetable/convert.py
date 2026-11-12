#!/usr/bin/env python3
"""Build the subway timetables, one file per part of the `subway-timetables` dataset
(docs/how-to/update-subway-timetables.md; ADR 0013, D3). The server reads the stored
dataset; `npm run data` is its only writer and checks every file with the server's own schema and coverage rule.

When to rerun:

    - Korail publishes a new 1호선 timetable (a 사업계획변경 신고, usually with a new semester or a
      timetable change notice on korail.com). Update KORAIL_WEEKDAY_URL, KORAIL_HOLIDAY_URL and
      KORAIL_REVISION below to the new files, then rerun. The same for a new 수인분당선 file
      (KORAIL_K1_URL, KORAIL_K1_REVISION; Korail publishes two or three a year).
    - Seoul Metro changes the 2/3/4/8호선 timetable (a 열차운행시각 조정 notice). Rerun; the Seoul API
      already serves the new table. `--line 2` (repeatable) rebuilds one line only.
    - 신분당선 posts a new 역별 열차시각표 (all_kor.zip; a reversal of the 2026-10 speed cut would bring one).
      Update SHINBUNDANG_FILES, SHINBUNDANG_PLAN and SHINBUNDANG_REVISION to the new edition, then rerun.
    - A served station or one of its upstream or watched stations changes (the line's entry in LINES:
      its stations and served platforms).

How to rerun (from the repository root; docs/how-to/update-subway-timetables.md):

    npm run data -- pull subway-timetables
    python3 -I scripts/subway-timetable/convert.py --out .data/dev/subway-timetables/parts [--line 2]
    npm run data -- push subway-timetables --dry-run
    npm run data -- push subway-timetables --note "Seoul Metro 2026-11 timetable"

then the same against production with --prod, from a production pull. `--out` is required: the converter writes
only into the pulled directory, and a rebuild of one source or line leaves the other files as pulled. The push
reports each table as unchanged, changed, added or removed, and stores only the changed ones.

--seoul-rows scripts/subway-timetable/seoul-rows reads each Seoul answer saved there (<STATION_CD>.json, the fields the
converter reads, one row per line) and saves each one it has to fetch; --seoul-keep-pulled keeps the stop times of the
stations a pulled Seoul table already lists, rebuilt as the rows the API would answer, and calls only for the others.
Together they add a station to a line without calling for the stations it had: 사당, 금정 and the stretches around them
were added so (2026-10-25), their answers committed under seoul-rows/. A new Seoul Metro timetable needs neither option.

The Seoul part reads SEOUL_OPENAPI_GENERAL_KEY from the environment, and no other variable; no service
reads that key. `--only korail` needs no key. `--korail-weekday FILE` and `--korail-holiday FILE` read local
copies of the two 1호선 Korail URLs instead of downloading them, `--korail-k1 FILE` of the 수인분당 one,
`--shinbundang-zip FILE` of all_kor.zip. Only the Seoul part needs the key.

What it writes, one file per operator line and day type, named by its part key (<operator>-<line>-<dayType>):

    KR-1-weekday.json, KR-1-holiday.json                       1호선, Korail xlsx
    KR-K1-weekday.json, KR-K1-holiday.json                     수인분당선, Korail xlsx (one file)
    S1-{2,3,4,8}-{weekday,saturday,holiday}.json               2/3/4/8호선, SearchSTNTimeTableByIDService
    DX-D1-weekday.json, DX-D1-holiday.json                     신분당선, the operator's per-station PDFs

A rebuilt Seoul table whose trains equal the pulled file's keeps the pulled revision (keep_revision), so it pushes
as unchanged.

Each file lists the trains that stop at one of its line's served platforms (LINES) with their stops among
the covered stations, in travel order. A line covers every station between its served platforms and, on each side,
far enough that every train is in view for at least 10 minutes before it reaches a served platform, or from where it
starts (ADR 0017, D6): a gap in the covered stations is a stretch where the tracker
loses a train, and on lines that report no departure it holds the train at the last station it saw, late.
Times are seconds after 00:00 of the service day. A clock time before SERVICE_DAY_START (03:00)
belongs to the previous service day and gets 86400 added, so 00:13:30 is 87210; Seoul already writes
those as 24:13:30. Either way the times must then increase along the train, or the run fails.

Rules taken from the data (checked on the 2026-08-28 Korail files and the 2026-10-16 Seoul tables):

    - Train numbers keep their digits, zero-padded to four: K602 -> 0602, S418 -> 0418,
      K4302 -> 4302, K1902 -> 1902, and the Seoul timetable's Korail-run 3호선 3024K -> 3024.
    - Korail: a station is a stop when its arrival row has a time. The origin has only a departure,
      the terminus only an arrival. A departure-row time without an arrival mid-route is a pass:
      only express trains pass a covered station. A local may pass an uncovered one: on the 2026-08-28
      경인 sheets most trains pass 마전, far north of every covered station.
    - Korail destinations: the 종착역 row writes the underground platforms of the Seoul Metro section
      short (1지청 for 청량리, 지하서 for 서울); each is written as the train map and the Seoul API
      write it (KORAIL_ABBREVIATIONS), any other name must be in KORAIL_TERMINI, and a name in neither
      fails the run. The tracker reads a train's direction off its destination.
    - Korail express: train numbers 1000-1999 (the K19xx 급행; the 서울급행 sheet holds only those).
      A train with a pass outside that range fails the run.
    - 수인분당선: the sheets 평일상행/평일하행/휴일상행/휴일하행 of one file, Saturday counting as 휴일. The
      xlsx writes 인천 as 신인천 and 수원 as 신수원. Its express is K63xx, and an express that passes a
      covered station from 왕십리 to 죽전 fails the run: on 2026-08-22 every 분당 express stops at each of them
      and passes 보정, 구성 and 신갈.
    - Seoul express: EXPRESS_YN "G" is 일반, "D" is 급행; any other value fails the run. Every
      2026-10-16 row was "G". ARRIVETIME or LEFTTIME "00:00:00" means none (the origin or terminus);
      the one mid-route hole of 2026-10-17 is filled from SEOUL_ARRIVAL_FIXES.
    - Seoul joins one train across the line's station codes by its normalized number, within one
      WEEK_TAG and INOUT_TAG. A number that appears twice at one station is split into runs by time
      continuity: each row joins the run of the same number that left an earlier station at most
      MAX_HOP_SECONDS before it. No number repeated on 2026-10-16.
    - 2호선: INOUT_TAG 1 is 내선순환 (up). The API and the timetable name nearly every circle trip 성수 in
      both directions, so a 성수 destination is written as 내선순환 or 외선순환 by direction, as the train
      map writes it; real termini (신도림, 삼성, ...) stay named. A 성수지선 or 신정지선 number (15xx-17xx,
      55xx-57xx) fails the run: no covered station sees a branch train.
    - No destination names trains of both directions (check_one_direction), except one the line declares
      with its evidence: the tracker reads a train's direction off its destination.
    - 신분당선: the PDFs give each station's minutes per direction and no train numbers. Runs are chained
      station to station with no overtaking (shinbundang_chain), get arrival = departure = the minute, and
      are numbered 1002, 1004, ... up and 1001, 1003, ... down in order of their first time. A minute marked
      (정자) belongs to a run that ends at 정자, whose arrival there is derived from the segment's most
      common run time, because 정자's page leaves it out. The termini's pages list no arrivals, so through
      runs end at 광교중앙 or 논현.

Only the standard library is used (zipfile and xml.etree read the xlsx, zlib and re the PDFs). The API key is never printed:
failures name only the station code, the tags and the HTTP status or API result code.
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
import zlib
import xml.etree.ElementTree as ET

KORAIL_REVISION = "2026-08-28"
KORAIL_WEEKDAY_URL = "https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c6bb40560.xlsx"
KORAIL_HOLIDAY_URL = "https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c713b2610.xlsx"
# "경인_" and not "경인": the 경인급행 sheets end at 용산, short of every served platform.
KORAIL_SHEET_PREFIXES = ("경부", "서동탄", "서울급행", "경인_")
# 수인분당선 전동열차 시각표(2026.8.22.부터): one file holds both day types, Saturday counting as 휴일.
KORAIL_K1_REVISION = "2026-08-22"
KORAIL_K1_URL = "https://www.korail.com/file/cubedata/COMMON/jfile/202608/21/202608211a02345f4b6660.xlsx"

SEOUL_API = "SearchSTNTimeTableByIDService"
SEOUL_URL = "http://openapi.seoul.go.kr:8088/{key}/json/" + SEOUL_API + "/{start}/{end}/{code}/{week}/{inout}/"
SEOUL_PAGE = 1000
SEOUL_WEEK_TAGS = (("weekday", "1"), ("saturday", "2"), ("holiday", "3"))
SEOUL_INOUT = (("up", "1"), ("down", "2"))
SEOUL_EXPRESS = {"G": False, "D": True}

SERVICE_DAY_START = 3 * 3600
DAY = 86400
MAX_HOP_SECONDS = 600

# Arrivals the Seoul API leaves out mid-route, keyed by (STATION_CD, WEEK_TAG, INOUT_TAG, TRAIN_NO, LEFTTIME). On
# 2026-10-17 it answered 3305 at 교대 (0330) on Saturdays with ARRIVETIME 00:00:00, though the train starts at 구파발
# (0310); its holiday row, identical to the Saturday table everywhere else, reads 21:08:00. A key that no longer
# matches is printed, so the entry can go once the API is fixed.
SEOUL_ARRIVAL_FIXES = {("0330", "2", "2", "3305", "21:08:30"): "21:08:00"}

# KRIC code (운영기관_역사_코드정보, 2022-08-26; 명학 and 안양 as in the 2026-05-11 list, 관악 to 회기 as in the 2026-07-11
# list) and the Korail xlsx short name, south to north: 병점, ten minutes before 성균관대 for the 급행 too, through 금정 and
# the underground Seoul Metro section (S1-1-150 서울역 to S1-1-158 청량리) to 회기, ten minutes before 종로5가 southbound.
LINE1_STATIONS = (
    ("KR-1-P157", "병점"),
    ("KR-1-1715", "세류"),
    ("KR-1-P155", "수원"),
    ("KR-1-P154", "화서"),
    ("KR-1-P153", "성균관"),
    ("KR-1-P152", "의왕"),
    ("KR-1-P151", "당정"),
    ("KR-1-P150", "군포"),
    ("KR-1-P149", "금정"),
    ("KR-1-P148", "명학"),
    ("KR-1-P147", "안양"),
    ("KR-1-P146", "관악"),
    ("KR-1-P145", "석수"),
    ("KR-1-P144", "금천구"),
    ("KR-1-P143", "독산"),
    ("KR-1-P142", "가산디"),
    ("KR-1-141", "구로"),
    ("KR-1-140", "신도림"),
    ("KR-1-139", "영등포"),
    ("KR-1-138", "신길"),
    ("KR-1-137", "대방"),
    ("KR-1-136", "노량진"),
    ("KR-1-135", "용산"),
    ("KR-1-134", "남영"),
    ("S1-1-150", "지하서"),
    ("S1-1-151", "시청"),
    ("S1-1-152", "종각"),
    ("S1-1-153", "1종로"),
    ("S1-1-154", "종로5"),
    ("S1-1-155", "1동대"),
    ("S1-1-159", "동묘앞"),
    ("S1-1-156", "신설동"),
    ("S1-1-157", "제기동"),
    ("S1-1-158", "1지청"),
    ("KR-1-123", "회기"),
)

# KRIC code and the Seoul STATION_CD (SearchSTNBySubwayLineInfo, 2026-10-25), north to south: 수유, ten minutes before 혜화
# southbound, through 사당 and the Korail section from 선바위 (KR-4-435) to 상록수, ten minutes before 금정 northbound.
# The Seoul timetable writes a Korail train K4302 and the Seoul Metro stations 4302: the same train (it leaves 금정
# 05:18:30 and reaches 서울역 05:59:30 in the 2026-10 weekday tables).
LINE4_STATIONS = (
    tuple(("S1-4-%d" % n, "%04d" % n) for n in range(414, 435))
    + tuple(zip(("KR-4-%d" % n for n in range(435, 449)), ("1450", "1451", "1452", "1453", "1454", "1455", "1456", "1457", "1458", "1751", "1763", "1752", "1753", "1754")))
)

# Every 시발역/종착역 name of the 2026-08-28 files, weekday and holiday, written as the train map and the Seoul API
# write a destination: the KRIC name without its parenthesized suffix (신창(순천향대) -> 신창). 연천 opened after the
# 2022-08-26 code list; the train map writes 연천행.
KORAIL_TERMINI = frozenset((
    "광명", "광운대", "구로", "동두천", "동묘앞", "동인천", "병점", "부천", "부평", "서동탄", "서울",
    "소요산", "신창", "양주", "연천", "영등포", "용산", "의정부", "인천", "창동", "천안",
))
# The xlsx's short names for the underground platforms of the Seoul Metro section (S1-1-158 청량리(서울시립대입구),
# S1-1-150 서울역), which the train map and the Seoul API write as 청량리 and 서울.
KORAIL_ABBREVIATIONS = {"1지청": "청량리", "지하서": "서울"}

# One entry per line. Keys:
#   line, operator     the file's line and operator, which the server matches to a platform id
#   file               the output name before -<day type>.json
#   source             korail (an xlsx per day type) or seoul (SearchSTNTimeTableByIDService)
#   stations           (KRIC code, Korail short name or Seoul STATION_CD) in the order the file lists them
#   up_order           "listed" when up trains travel the stations in that order, "reversed" otherwise
#   served             the platforms a train must stop at to be written
#   termini, abbreviations, is_express   Korail only: see korail_destination and korail_train
LINE1 = {
    "line": "1",
    "operator": "KR",
    "source": "korail",
    "stations": LINE1_STATIONS,
    "up_order": "listed",
    "served": ("KR-1-P153", "KR-1-P149", "S1-1-154"),
    # 구로 ends trains from 병점 northbound and from 회기 southbound, 서울 underground ones from 회기 and the 서울급행 at
    # ground level from 병점 (2026-08-28 weekday file); every number is even up and odd down, so the tracker reads parity.
    "two_direction_destinations": ("구로", "서울"),
    "termini": KORAIL_TERMINI,
    "abbreviations": KORAIL_ABBREVIATIONS,
    "is_express": lambda train_no: train_no.startswith("1"),
    "express_rule": "numbered 1xxx",
    "revision": KORAIL_REVISION,
    "urls": {"weekday": KORAIL_WEEKDAY_URL, "holiday": KORAIL_HOLIDAY_URL},
    "sheet_prefixes": KORAIL_SHEET_PREFIXES,
}
LINE4 = {
    "line": "4",
    "operator": "S1",
    "source": "seoul",
    "stations": LINE4_STATIONS,
    "up_order": "reversed",
    "served": ("S1-4-420", "S1-4-433", "KR-4-443"),
    # The last Korail trains end at 금정 from both sides (K4706 up from 오이도, K4335 down from 사당, weekday 2026-10-25),
    # and a Saturday train ends at 사당 northbound (4684) besides the southbound short turns; every line 4 number at the
    # covered stations is even up and odd down (2026-10-25 tables), so the tracker reads their parity.
    "two_direction_destinations": ("금정", "사당"),
}

# KRIC code and the Seoul STATION_CD (SearchInfoBySubwayNameService, 2026-10-17 and 2026-10-18), in line order: 건대입구
# (212) to 구로디지털단지 (232), ten minutes before 사당 on the outer circle; 내선순환 (up) runs in this order. 성수 (211), one
# station further, stays out: every 내선 trip that reaches 잠실 starts there, and an outer-circle trip starts its lap
# there under the number it reaches 잠실 with an hour later, so a sighting there would read as that trip having passed.
LINE2 = {
    "line": "2",
    "operator": "S1",
    "source": "seoul",
    "stations": tuple(("S1-2-%d" % n, "%04d" % n) for n in range(212, 233)),
    "up_order": "listed",
    "served": ("S1-2-216", "S1-2-222", "S1-2-226"),
    # The timetable and the API name almost every circle trip 성수 in both directions; the train map writes the
    # circle instead, which says the direction.
    "circle_destination": "성수",
    "circle_labels": {"up": "내선순환", "down": "외선순환"},
    # 성수지선 and 신정지선 trips, which never stop in these windows.
    "branch_trains": ((1500, 1799), (5500, 5799)),
    # The last trips of both circles end at 삼성 (2520 inner and 2517 outer, weekday 2026-10-17).
    "two_direction_destinations": ("삼성",),
}
# 압구정 (326), ten minutes before 양재 toward 오금, to the 오금 terminus (342); up runs toward 대화, against this order.
LINE3 = {
    "line": "3",
    "operator": "S1",
    "source": "seoul",
    "stations": tuple(("S1-3-%d" % n, "%04d" % n) for n in range(326, 343)),
    "up_order": "reversed",
    "served": ("S1-3-332", "S1-3-334", "S1-3-340"),
}
# 장자호수공원 to the 모란 terminus, in line order: about ten minutes of running before 잠실 and from 모란 to 복정; up runs
# toward 별내, against this order. North of 천호 and at 남위례 (opened after the numbering) the KRIC code and the
# STATION_CD differ: KRIC writes 장자호수공원 GU-8-2808 (구리도시공사) and 암사역사공원 S1-8-2809, the STATION_CDs are 2809
# and 2810. 산성 to 모란 are written as S1-8-<STATION_CD> (2822 to 2827, SearchInfoBySubwayNameService 2026-11-10), as every
# Seoul Metro station of the line from 천호 on is; the KRIC list itself was not read for them, and 남위례's 2828 follows 모란's 2827.
LINE8 = {
    "line": "8",
    "operator": "S1",
    "source": "seoul",
    "stations": (
        ("GU-8-2808", "2809"),
        ("S1-8-2809", "2810"),
        ("S1-8-2811", "2811"),
    )
    + tuple(("S1-8-%d" % n, "%04d" % n) for n in range(2812, 2822))
    + (("S1-8-2828", "2828"),)
    + tuple(("S1-8-%d" % n, "%04d" % n) for n in range(2822, 2828)),
    "up_order": "reversed",
    "served": ("S1-8-2815", "S1-8-2817", "S1-8-2818", "S1-8-2821"),
}
# KRIC code (2026-05-11 list) and the xlsx short name, in line order: 왕십리 (K210), where most trains to 도곡 start,
# through 도곡 and 정자 to 기흥 (K237), the express's first stop south of 죽전, about twelve minutes before 정자 for a
# local and an express alike. 청량리 (K209) stays out: no position row named it on 2026-10-18, and the few trains from
# it are in view from 왕십리 for fourteen minutes. Up runs toward 왕십리/청량리, against this order.
LINEK1 = {
    "line": "K1",
    "operator": "KR",
    "source": "korail",
    "stations": (
        ("KR-K1-K210", "왕십리"),
        ("KR-K1-K211", "서울숲"),
        ("KR-K1-K212", "로데오"),
        ("KR-K1-K213", "강남구"),
        ("KR-K1-K214", "선정릉"),
        ("KR-K1-K215", "선릉"),
        ("KR-K1-K216", "한티"),
        ("KR-K1-K217", "도곡"),
        ("KR-K1-K218", "구룡역"),
        ("KR-K1-K219", "개포동"),
        ("KR-K1-K220", "대모산"),
        ("KR-K1-K221", "수서"),
        ("KR-K1-K222", "복정"),
        ("KR-K1-K223", "가천대"),
        ("KR-K1-K224", "태평"),
        ("KR-K1-K225", "모란"),
        ("KR-K1-K226", "야탑"),
        ("KR-K1-K227", "이매"),
        ("KR-K1-K228", "서현"),
        ("KR-K1-K229", "수내"),
        ("KR-K1-K230", "정자"),
        ("KR-K1-K231", "미금"),
        ("KR-K1-K232", "오리"),
        ("KR-K1-K233", "죽전"),
        ("KR-K1-K234", "보정"),
        ("KR-K1-K235", "구성"),
        ("KR-K1-K236", "신갈"),
        ("KR-K1-K237", "기흥"),
    ),
    "up_order": "reversed",
    "served": ("KR-K1-K217", "KR-K1-K222", "KR-K1-K230", "KR-K1-K231"),
    # Every 종착역 of the 2026-08-22 file, as the Seoul API writes it.
    "termini": frozenset(("왕십리", "청량리", "죽전", "고색", "오이도", "인천", "수원")),
    "abbreviations": {"신인천": "인천", "신수원": "수원"},
    # The 분당 express K6300-K6313 stops at every station 죽전-왕십리 and passes 보정, 구성 and 신갈 (2026-08-22); the 수인
    # express K6350-K6358 runs 오이도-인천.
    "is_express": lambda train_no: train_no.startswith("63"),
    "express_rule": "numbered 63xx",
    "express_stops_at": frozenset("KR-K1-K%d" % n for n in range(210, 234)),
    "revision": KORAIL_K1_REVISION,
    "urls": {"weekday": KORAIL_K1_URL, "holiday": KORAIL_K1_URL},
    "sheets": {"weekday": ("평일상행", "평일하행"), "holiday": ("휴일상행", "휴일하행")},
}
# KRIC code (2026-05-11 list) and the page title of the operator's per-station PDF, which is the KRIC name without its
# parenthesized suffix, in line order. Up runs toward 신사, against this order.
LINED1 = {
    "line": "D1",
    "operator": "DX",
    "source": "shinbundang",
    "stations": (
        ("DX-D1-D04", "신사"),
        ("DX-D1-4305", "논현"),
        ("DX-D1-4306", "신논현"),
        ("DX-D1-4307", "강남"),
        ("DX-D1-4308", "양재"),
        ("DX-D1-4309", "양재시민의숲"),
        ("DX-D1-4310", "청계산입구"),
        ("DX-D1-4311", "판교"),
        ("DX-D1-4312", "정자"),
        ("DX-D1-D13", "미금"),
        ("DX-D1-D14", "동천"),
        ("DX-D1-D15", "수지구청"),
        ("DX-D1-4316", "성복"),
        ("DX-D1-4317", "상현"),
        ("DX-D1-4318", "광교중앙"),
        ("DX-D1-4319", "광교"),
    ),
    "up_order": "reversed",
    "served": ("DX-D1-4307", "DX-D1-4308", "DX-D1-4312", "DX-D1-D13", "DX-D1-4318"),
    # The weekday PDF ends one 신사-bound run at 정자 (광교 10:18), besides four 광교-bound ones.
    "two_direction_destinations": ("정자",),
}
LINES = (LINE1, LINEK1, LINE2, LINE3, LINE4, LINE8, LINED1)
SEOUL_LINES = (LINE2, LINE3, LINE4, LINE8)

def station_codes(line):
    return [code for code, _ in line["stations"]]


def travel_order(line, direction):
    """The line's KRIC codes in the order a train of that direction reaches them."""
    codes = station_codes(line)
    forward = (direction == "up") == (line["up_order"] == "listed")
    return codes if forward else codes[::-1]

XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


class ConvertError(Exception):
    pass


# ---------------------------------------------------------------- shared rules

def normalize_train_no(raw):
    """K602 -> 0602, S418 -> 0418, K4302 -> 4302, 1906 -> 1906, and the Seoul timetable's Korail-run 3024K -> 3024."""
    match = re.fullmatch(r"\s*(?:[A-Z]*(\d{1,4})|(\d{4})K)\s*", raw or "")
    if match is None:
        raise ConvertError("train number %r is neither letters and at most four digits nor four digits and a K" % (raw,))
    return (match.group(1) or match.group(2)).zfill(4)


def service_seconds(clock_seconds):
    """Seconds after 00:00 of the service day: a clock time before 03:00 belongs to the previous day."""
    return clock_seconds + DAY if clock_seconds < SERVICE_DAY_START else clock_seconds


def excel_seconds(fraction, where):
    """An Excel day fraction (0.2534722 for 06:05:00) as clock seconds, which must be whole."""
    exact = fraction * DAY
    seconds = int(round(exact))
    if abs(exact - seconds) > 0.5 or not 0 <= seconds < 2 * DAY:
        raise ConvertError("%s: %r is not a time of day" % (where, fraction))
    return seconds % DAY


def hms_seconds(value, where):
    """HH:MM:SS as clock seconds; None for 00:00:00, which the Seoul API sends for none. HH may pass 24."""
    match = re.fullmatch(r"(\d{2}):([0-5]\d):([0-5]\d)", value or "")
    if match is None:
        raise ConvertError("%s: %r is not HH:MM:SS" % (where, value))
    seconds = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3))
    return None if seconds == 0 else seconds


def stop_time(stop):
    return stop["arr"] if stop["arr"] is not None else stop["dep"]


def validate_train(train, served, label):
    """The train stops at a served station (one KRIC code or several), and its times increase along its stops."""
    served = (served,) if isinstance(served, str) else tuple(served)
    if not any(stop["station"] in served for stop in train["stops"]):
        raise ConvertError("%s: train %s (%s) has no stop at %s" % (label, train["trainNo"], train["direction"], " or ".join(served)))
    previous = None
    for index, stop in enumerate(train["stops"]):
        if stop["arr"] is None and stop["dep"] is None:
            raise ConvertError("%s: train %s has no time at %s" % (label, train["trainNo"], stop["station"]))
        if stop["arr"] is not None and stop["dep"] is not None and stop["dep"] < stop["arr"]:
            raise ConvertError("%s: train %s leaves %s before it arrives" % (label, train["trainNo"], stop["station"]))
        if index > 0 and stop["arr"] is None:
            raise ConvertError("%s: train %s has no arrival at %s" % (label, train["trainNo"], stop["station"]))
        first = stop_time(stop)
        if previous is not None and first <= previous:
            raise ConvertError("%s: train %s goes back in time at %s" % (label, train["trainNo"], stop["station"]))
        previous = stop["dep"] if stop["dep"] is not None else stop["arr"]


def sort_trains(trains):
    return sorted(trains, key=lambda t: (t["trainNo"], t["direction"], stop_time(t["stops"][0])))


def check_one_direction(trains, label, line):
    """No destination names trains of both directions, except one the line declares: the tracker reads a train's
    direction off its destination (toDirectionByDestination)."""
    by_direction = {d: {t["destination"] for t in trains if t["direction"] == d} for d in ("up", "down")}
    both = sorted(by_direction["up"] & by_direction["down"] - set(line.get("two_direction_destinations", ())))
    if both:
        raise ConvertError("%s: destination %s names trains of both directions" % (label, ", ".join(repr(d) for d in both)))


def check_unique(trains, label, allow_split):
    seen = {}
    for train in trains:
        key = (train["trainNo"], train["direction"])
        if key in seen and not (allow_split and train.get("_split")):
            raise ConvertError("%s: train %s (%s) appears twice" % (label, key[0], key[1]))
        seen[key] = True


# ---------------------------------------------------------------- xlsx

def column_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    index = 0
    for char in letters:
        index = index * 26 + ord(char) - 64
    return index - 1


def read_workbook(data):
    """{sheet name: {row number: {column index: str | float}}} from xlsx bytes, cached values only."""
    import io

    archive = zipfile.ZipFile(io.BytesIO(data))
    names = set(archive.namelist())
    shared = []
    if "xl/sharedStrings.xml" in names:
        for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("{%s}si" % XLSX_NS):
            parts = [t.text or "" for t in item.findall("{%s}t" % XLSX_NS)]
            parts += [t.text or "" for run in item.findall("{%s}r" % XLSX_NS) for t in run.findall("{%s}t" % XLSX_NS)]
            shared.append("".join(parts))
    rels = {rel.get("Id"): rel.get("Target") for rel in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")).findall("{%s}Relationship" % PKG_REL_NS)}
    sheets = {}
    for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find("{%s}sheets" % XLSX_NS):
        target = rels[sheet.get("{%s}id" % REL_NS)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = {}
        for row in ET.fromstring(archive.read(target)).iter("{%s}row" % XLSX_NS):
            cells = {}
            for cell in row.findall("{%s}c" % XLSX_NS):
                kind = cell.get("t")
                value = cell.find("{%s}v" % XLSX_NS)
                if kind == "inlineStr":
                    cells[column_index(cell.get("r"))] = "".join(t.text or "" for t in cell.iter("{%s}t" % XLSX_NS))
                elif value is None:
                    continue
                elif kind == "s":
                    cells[column_index(cell.get("r"))] = shared[int(value.text)]
                elif kind in ("str", "e", "b"):
                    cells[column_index(cell.get("r"))] = value.text or ""
                else:
                    cells[column_index(cell.get("r"))] = float(value.text)
            rows[int(row.get("r"))] = cells
        sheets[sheet.get("name")] = rows
    return sheets


# ---------------------------------------------------------------- Korail

def korail_code(name, where, line=LINE1):
    """The KRIC code of a covered short name, None for an uncovered station; refuses a near miss."""
    names = {short: code for code, short in line["stations"]}
    if name in names:
        return names[name]
    for covered in names:
        if name[:2] == covered[:2]:
            raise ConvertError("%s: station name %r looks like %r but is not in the name table" % (where, name, covered))
    return None


def is_blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def korail_cell(rows, row, column, where):
    value = rows.get(row, {}).get(column)
    if is_blank(value):
        return None
    if isinstance(value, float):
        return excel_seconds(value, where)
    raise ConvertError("%s: unexpected value %r" % (where, value))


def korail_blocks(rows, sheet):
    """(name column, train columns) per block: a block starts where row 4 reads 열차번호."""
    header = rows.get(4, {})
    starts = sorted(c for c, v in header.items() if isinstance(v, str) and v.strip() == "열차번호")
    if not starts:
        raise ConvertError("%s: no 열차번호 in row 4" % sheet)
    blocks = []
    for index, start in enumerate(starts):
        for row, label in ((2, "시발역"), (3, "종착역")):
            value = rows.get(row, {}).get(start)
            if not (isinstance(value, str) and value.strip() == label):
                raise ConvertError("%s: row %d column %d is not %s" % (sheet, row, start + 1, label))
        end = starts[index + 1] if index + 1 < len(starts) else max(header) + 1
        columns = [c for c in range(start + 1, end) if not is_blank(header.get(c))]
        blocks.append((start, columns))
    return blocks


def sheet_direction(sheet):
    """The direction a sheet name states: a _상/_하 suffix (1호선) or a 상행/하행 suffix (수인분당), else None."""
    if sheet.endswith("상행"):
        return "up"
    if sheet.endswith("하행"):
        return "down"
    return {"상": "up", "하": "down"}.get(sheet.rsplit("_", 1)[-1])


def korail_direction(station_rows, sheet, line=LINE1):
    """up when the block lists the covered stations in up travel order, down when in down travel order."""
    codes = [code for _, _, code in station_rows if code is not None]
    if not any(code in line["served"] for code in codes):
        raise ConvertError("%s: no row of a served station (%s)" % (sheet, ", ".join(line["served"])))
    if len(set(codes)) != len(codes):
        raise ConvertError("%s: a covered station is listed twice" % sheet)
    up_order = travel_order(line, "up")
    positions = [up_order.index(code) for code in codes]
    if len(positions) < 2:
        raise ConvertError("%s: too few covered stations to tell the direction" % sheet)
    if positions == sorted(positions):
        direction = "up"
    elif positions == sorted(positions, reverse=True):
        direction = "down"
    else:
        raise ConvertError("%s: covered stations are out of line order" % sheet)
    stated = sheet_direction(sheet)
    if stated is not None and stated != direction:
        raise ConvertError("%s: the sheet name says %s but the stations run %s" % (sheet, stated, direction))
    return direction


def korail_train(rows, sheet, column, station_rows, direction, line=LINE1):
    """One train column as a train with its stops at covered stations, or None if it stops at no served station."""
    where = "%s column %d" % (sheet, column + 1)
    raw_no = rows[4][column]
    try:
        train_no = normalize_train_no(raw_no)
    except ConvertError as error:
        raise ConvertError("%s: %s" % (where, error))
    timed = []
    for row, _, code in station_rows:
        arr = korail_cell(rows, row, column, "%s row %d" % (where, row))
        dep = korail_cell(rows, row + 1, column, "%s row %d" % (where, row + 1))
        if arr is not None or dep is not None:
            timed.append((row, code, arr, dep))
    if not timed:
        return None
    stops = []
    passes = []
    for index, (row, code, arr, dep) in enumerate(timed):
        is_origin = index == 0
        is_terminus = index == len(timed) - 1
        if is_origin:
            if dep is None:
                raise ConvertError("%s row %d: the origin has no departure" % (where, row))
            arr = None
        elif is_terminus:
            if arr is None:
                raise ConvertError("%s row %d: the terminus has no arrival" % (where, row))
            dep = None
        elif arr is None:
            passes.append(code)
            continue
        elif dep is None:
            raise ConvertError("%s row %d: an arrival without a departure mid-route" % (where, row))
        if code is not None:
            stops.append({"station": code, "arr": None if arr is None else service_seconds(arr), "dep": None if dep is None else service_seconds(dep)})
    express = line["is_express"](train_no)
    covered_passes = [code for code in passes if code is not None]
    if covered_passes and not express:
        raise ConvertError("%s: train %s passes a station but is not %s" % (where, raw_no.strip(), line["express_rule"]))
    stop_passes = [code for code in covered_passes if code in line.get("express_stops_at", ())]
    if stop_passes:
        raise ConvertError("%s: express %s passes %s, a covered station every express stops at" % (where, train_no, ", ".join(stop_passes)))
    if not any(stop["station"] in line["served"] for stop in stops):
        return None
    destination = rows.get(3, {}).get(column)
    if is_blank(destination):
        raise ConvertError("%s: no 종착역" % where)
    return {"trainNo": train_no, "direction": direction, "destination": destination.strip(), "express": express, "stops": stops}


def korail_destination(name, where, line=LINE1):
    """The name the train map and the Seoul API write for a Korail 종착역; refuses a name in neither table."""
    abbreviations = line["abbreviations"]
    if name in abbreviations:
        return abbreviations[name]
    if name in line["termini"] or name in abbreviations.values():
        return name
    raise ConvertError("%s: destination %r is neither in the line's termini nor in its abbreviations; check it against the KRIC code list and the train map" % (where, name))


def with_upstream_destinations(trains, label, line=LINE1):
    return [dict(train, destination=korail_destination(train["destination"], "%s train %s" % (label, train["trainNo"]), line)) for train in trains]


def korail_sheet_selected(line, sheet, day_type):
    """1호선 reads every sheet of a day type's file whose name starts with a prefix; 수인분당 names its sheets per day type."""
    if "sheets" in line:
        return sheet in line["sheets"][day_type]
    return sheet.startswith(line["sheet_prefixes"])


def korail_trains(sheets, line=LINE1, day_type=None):
    """Every train of the selected sheets that stops at a served station."""
    trains = []
    for sheet, rows in sheets.items():
        if not korail_sheet_selected(line, sheet, day_type):
            continue
        for name_column, columns in korail_blocks(rows, sheet):
            station_rows = []
            for row in sorted(r for r in rows if r > 4):
                name = rows[row].get(name_column)
                if is_blank(name):
                    continue
                if not isinstance(name, str):
                    raise ConvertError("%s row %d: station name %r is not text" % (sheet, row, name))
                if not is_blank(rows.get(row + 1, {}).get(name_column)):
                    raise ConvertError("%s row %d: the departure row below a station holds a name" % (sheet, row + 1))
                station_rows.append((row, name.strip(), korail_code(name.strip(), "%s row %d" % (sheet, row), line)))
            direction = korail_direction(station_rows, sheet, line)
            for column in columns:
                train = korail_train(rows, sheet, column, station_rows, direction, line)
                if train is not None:
                    validate_train(train, line["served"], sheet)
                    trains.append(train)
    return trains


# ---------------------------------------------------------------- Seoul

def seoul_trips(rows_by_station, direction, line=LINE4):
    """Join one direction's station rows into trains, by normalized number and time continuity.

    rows_by_station: [(KRIC code, [API row, ...])] in the order the API was asked, any order.
    """
    order = travel_order(line, direction)
    candidates = []
    for code, rows in rows_by_station:
        for row in rows:
            where = "%s %s %s" % (code, direction, row.get("TRAIN_NO"))
            arr = hms_seconds(row.get("ARRIVETIME"), where + " ARRIVETIME")
            dep = hms_seconds(row.get("LEFTTIME"), where + " LEFTTIME")
            if arr is None and dep is None:
                raise ConvertError("%s: neither an arrival nor a departure" % where)
            if row.get("EXPRESS_YN") not in SEOUL_EXPRESS:
                raise ConvertError("%s: EXPRESS_YN %r is neither G nor D" % (where, row.get("EXPRESS_YN")))
            train_no = normalize_train_no(row.get("TRAIN_NO"))
            if any(low <= int(train_no) <= high for low, high in line.get("branch_trains", ())):
                raise ConvertError("%s: a branch train, which no covered station serves" % where)
            candidates.append({
                "trainNo": train_no,
                "index": order.index(code),
                "station": code,
                "arr": None if arr is None else service_seconds(arr),
                "dep": None if dep is None else service_seconds(dep),
                "destination": (row.get("SUBWAYENAME") or "").strip(),
                "express": SEOUL_EXPRESS[row["EXPRESS_YN"]],
            })
    candidates.sort(key=lambda c: (c["trainNo"], stop_time(c), c["index"]))
    trips = []
    open_trips = {}
    for stop in candidates:
        best = None
        for trip in open_trips.get(stop["trainNo"], []):
            last = trip["stops"][-1]
            gap = stop_time(stop) - (last["dep"] if last["dep"] is not None else last["arr"])
            if last["index"] < stop["index"] and 0 < gap <= MAX_HOP_SECONDS and (best is None or gap < best[0]):
                best = (gap, trip)
        if best is None:
            trip = {"trainNo": stop["trainNo"], "stops": []}
            open_trips.setdefault(stop["trainNo"], []).append(trip)
            trips.append(trip)
        else:
            trip = best[1]
        trip["stops"].append(stop)
    trains = []
    for trip in trips:
        stops = trip["stops"]
        destinations = {s["destination"] for s in stops}
        if len(destinations) != 1 or "" in destinations:
            raise ConvertError("train %s (%s): destinations %s disagree or are empty" % (trip["trainNo"], direction, sorted(destinations)))
        expresses = {s["express"] for s in stops}
        if len(expresses) != 1:
            raise ConvertError("train %s (%s): EXPRESS_YN disagrees across stations" % (trip["trainNo"], direction))
        destination = destinations.pop()
        if destination == line.get("circle_destination"):
            destination = line["circle_labels"][direction]
        trains.append({
            "trainNo": trip["trainNo"],
            "direction": direction,
            "destination": destination,
            "express": expresses.pop(),
            "stops": [{"station": s["station"], "arr": s["arr"], "dep": s["dep"]} for s in stops],
            "_split": len(open_trips[trip["trainNo"]]) > 1,
        })
    return trains


def seoul_fetch(key, code, week, inout):
    """Every row of one station, day type and direction, paged by SEOUL_PAGE."""
    rows = []
    start = 1
    label = "station %s WEEK_TAG %s INOUT_TAG %s" % (code, week, inout)
    while True:
        url = SEOUL_URL.format(key=key, start=start, end=start + SEOUL_PAGE - 1, code=code, week=week, inout=inout)
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ConvertError("%s: HTTP %d" % (label, error.code)) from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise ConvertError("%s: request failed (%s)" % (label, type(error).__name__)) from None
        result = body.get(SEOUL_API)
        if result is None:
            code_ = (body.get("RESULT") or {}).get("CODE")
            raise ConvertError("%s: API result %s" % (label, code_))
        status = (result.get("RESULT") or {}).get("CODE")
        if status != "INFO-000":
            raise ConvertError("%s: API result %s" % (label, status))
        page = result.get("row") or []
        for row in page:
            if (row.get("STATION_CD"), row.get("WEEK_TAG"), row.get("INOUT_TAG")) != (code, week, inout):
                raise ConvertError("%s: a row for another station or tag" % label)
        rows += page
        total = int(result.get("list_total_count", 0))
        if len(rows) >= total or not page:
            break
        start += SEOUL_PAGE
    if len(rows) != total:
        raise ConvertError("%s: %d rows of %d" % (label, len(rows), total))
    return rows


def with_arrival_fixes(rows, station_cd, week, inout):
    """The rows with each SEOUL_ARRIVAL_FIXES arrival filled in where the API wrote 00:00:00."""
    fixed = []
    for row in rows:
        key = (station_cd, week, inout, row.get("TRAIN_NO"), row.get("LEFTTIME"))
        if key in SEOUL_ARRIVAL_FIXES and row.get("ARRIVETIME") == "00:00:00":
            row = dict(row, ARRIVETIME=SEOUL_ARRIVAL_FIXES[key])
        fixed.append(row)
    return fixed


SEOUL_ROW_FIELDS = ("TRAIN_NO", "ARRIVETIME", "LEFTTIME", "SUBWAYENAME", "EXPRESS_YN")


def render_saved_rows(saved):
    """A station's saved answers, one row per line, so a rerun's diff shows the rows that changed."""
    answers = []
    for tag in sorted(saved["answers"]):
        answer = saved["answers"][tag]
        rows = ",\n".join("        " + json.dumps(row, ensure_ascii=False) for row in answer["rows"])
        answers.append('    "%s": {"fetchedOn": "%s", "rows": [\n%s\n    ]}' % (tag, answer["fetchedOn"], rows))
    head = '{\n  "api": "%s",\n  "stationCd": "%s",\n  "fields": %s,\n  "answers": {\n' % (saved["api"], saved["stationCd"], json.dumps(saved["fields"]))
    return head + ",\n".join(answers) + "\n  }\n}\n"


def saved_fetch(directory, fetch, today):
    """fetch(code, week, inout) that reads an answer saved in directory, <STATION_CD>.json, and saves one it had to
    fetch, with only the fields the converter reads, so a rerun over the same stations calls nothing."""
    def read(code, week, inout):
        path = os.path.join(directory, "%s.json" % code)
        try:
            with open(path, encoding="utf-8") as handle:
                saved = json.load(handle)
        except FileNotFoundError:
            saved = {"api": SEOUL_API, "stationCd": code, "fields": list(SEOUL_ROW_FIELDS), "answers": {}}
        if saved.get("api") != SEOUL_API or saved.get("stationCd") != code or saved.get("fields") != list(SEOUL_ROW_FIELDS):
            raise ConvertError("%s: not the saved %s answers of station %s" % (path, SEOUL_API, code))
        tag = "%s-%s" % (week, inout)
        if tag in saved["answers"]:
            return [dict(zip(SEOUL_ROW_FIELDS, row)) for row in saved["answers"][tag]["rows"]]
        rows = fetch(code, week, inout)
        saved["answers"][tag] = {"fetchedOn": today, "rows": [[row.get(field) for field in SEOUL_ROW_FIELDS] for row in rows]}
        os.makedirs(directory, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(render_saved_rows(saved))
        return rows
    return read


def clock_text(seconds):
    """Service seconds as the Seoul API writes them, HH past 24 after midnight; None as its 00:00:00."""
    return "00:00:00" if seconds is None else "%02d:%02d:%02d" % (seconds // 3600, seconds % 3600 // 60, seconds % 60)


def pulled_rows(table, line):
    """{(STATION_CD, INOUT_TAG): rows} for each station the pulled table lists, as the Seoul API would answer them for its
    trains: what --seoul-keep-pulled keeps instead of calling again."""
    station_cd = dict(line["stations"])
    inout = dict(SEOUL_INOUT)
    circle_labels = set(line.get("circle_labels", {}).values())
    rows = {(station_cd[code], tag): [] for code in table["stations"] if code in station_cd for _, tag in SEOUL_INOUT}
    for train in table["trains"]:
        destination = line["circle_destination"] if train["destination"] in circle_labels else train["destination"]
        for stop in train["stops"]:
            key = (station_cd.get(stop["station"]), inout[train["direction"]])
            if key not in rows:
                raise ConvertError("train %s stops at %s, which the line no longer covers" % (train["trainNo"], stop["station"]))
            rows[key].append({"TRAIN_NO": train["trainNo"], "ARRIVETIME": clock_text(stop["arr"]), "LEFTTIME": clock_text(stop["dep"]), "SUBWAYENAME": destination, "EXPRESS_YN": "D" if train["express"] else "G"})
    return rows


def seoul_trains(fetch, week, line=LINE4):
    trains = []
    for direction, inout in SEOUL_INOUT:
        rows_by_station = [(code, with_arrival_fixes(fetch(station_cd, week, inout), station_cd, week, inout)) for code, station_cd in line["stations"]]
        for train in seoul_trips(rows_by_station, direction, line):
            if any(stop["station"] in line["served"] for stop in train["stops"]):
                validate_train(train, line["served"], "seoul %s WEEK_TAG %s" % (line["line"], week))
                trains.append(train)
    return trains


# ---------------------------------------------------------------- PDF (신분당선)

# 신분당선 역별 열차시각표 (all_kor.zip on shinbundang.co.kr): one PDF per day type, a page per station in route
# order. 기본계획번호 SBL4020, 적용기간 from 2026-09-28, printed after the speed cut from 90 to 80 km/h.
SHINBUNDANG_ZIP_URL = "https://www.shinbundang.co.kr/util/download.jsp?fPath=/files/notice/&fName=all_kor.zip"
SHINBUNDANG_PLAN = "SBL4020"
SHINBUNDANG_REVISION = "2026-09-28"
SHINBUNDANG_FILES = {"weekday": ("20260928_역별 열차시각표_평일.pdf", "평일"), "holiday": ("20260928_역별 열차시각표_휴일.pdf", "공휴일")}
SHINBUNDANG_TERMINI = {"up": "신사", "down": "광교"}
SHINBUNDANG_FIRST_RUN = {"up": 1002, "down": 1001}
SHINBUNDANG_COLUMNS = {"up": "신사방면", "down": "광교방면"}
SHINBUNDANG_SHORT_TURN = "DX-D1-4312"
SHINBUNDANG_ENTRIES = ("DX-D1-4312", "DX-D1-4311")
SHINBUNDANG_MIN_HOP = 60
# Minute-only times put one segment's run times at most one minute apart; a wider spread means a broken chain.
SHINBUNDANG_HOP_SPREAD = 60
SHINBUNDANG_COLUMN_GAP = 15

PDF_OBJECT = re.compile(rb"(\d+)\s+\d+\s+obj\b")
PDF_DELIMITERS = b"()<>[]{}/%"


def pdf_objects(data):
    """{object number: (dictionary bytes, stream bytes or None)}, scanned in file order so that no stream's bytes
    are searched for an object header."""
    objects = {}
    pos = 0
    while True:
        match = PDF_OBJECT.search(data, pos)
        if match is None:
            return objects
        start = match.end()
        end = data.find(b"endobj", start)
        stream_at = data.find(b"stream", start)
        if end < 0:
            raise ConvertError("PDF object %s has no endobj" % match.group(1).decode())
        stream = None
        head = data[start:end]
        if 0 <= stream_at < end:
            head = data[start:stream_at]
            body = stream_at + len(b"stream")
            body += 2 if data[body:body + 2] == b"\r\n" else 1
            length = re.search(rb"/Length\s+(\d+)(\s+\d+\s+R)?", head)
            body_end = body + int(length.group(1)) if length and not length.group(2) else data.find(b"endstream", body)
            stream = data[body:body_end]
            end = data.find(b"endobj", body_end)
        objects[int(match.group(1))] = (head, stream)
        pos = end + len(b"endobj")


def pdf_ref(head, key):
    match = re.search(rb"/" + key + rb"\s*(\d+)\s+\d+\s+R", head)
    return None if match is None else int(match.group(1))


def pdf_object(objects, number, what):
    if number not in objects:
        raise ConvertError("PDF: %s (object %s) is not a top-level object" % (what, number))
    return objects[number]


def pdf_stream(objects, number, what):
    head, stream = pdf_object(objects, number, what)
    if stream is None:
        raise ConvertError("PDF: %s (object %d) has no stream" % (what, number))
    if re.search(rb"/Filter\s*/FlateDecode", head):
        return zlib.decompress(stream)
    if b"/Filter" in head:
        raise ConvertError("PDF: %s (object %d) uses a filter other than FlateDecode" % (what, number))
    return stream


def pdf_pages(objects):
    """Page object numbers in page order."""
    catalogs = [n for n, (head, _) in objects.items() if re.search(rb"/Type\s*/Catalog\b", head)]
    if len(catalogs) != 1:
        raise ConvertError("PDF: %d catalogs" % len(catalogs))
    pages = []

    def walk(number):
        head = pdf_object(objects, number, "a page tree node")[0]
        if re.search(rb"/Type\s*/Pages\b", head):
            for kid in re.findall(rb"(\d+)\s+\d+\s+R", re.search(rb"/Kids\s*\[(.*?)\]", head, re.S).group(1)):
                walk(int(kid))
        elif re.search(rb"/Type\s*/Page\b", head):
            pages.append(number)
        else:
            raise ConvertError("PDF: object %d in the page tree is neither /Pages nor /Page" % number)

    walk(pdf_ref(objects[catalogs[0]][0], b"Pages"))
    return pages


def pdf_cmap(text, where):
    """A ToUnicode CMap with two-byte codes as {code: text}."""
    if re.findall(r"<([0-9A-Fa-f]+)>\s*<[0-9A-Fa-f]+>\s*endcodespacerange", text) != ["0000"]:
        raise ConvertError("%s: the ToUnicode CMap does not use two-byte codes" % where)
    cmap = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for code, value in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            cmap[int(code, 16)] = bytes.fromhex(value).decode("utf-16-be")
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        if "[" in block:
            raise ConvertError("%s: the ToUnicode CMap maps a range to an array" % where)
        for low, high, value in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            for offset in range(int(high, 16) - int(low, 16) + 1):
                cmap[int(low, 16) + offset] = chr(int(value, 16) + offset)
    return cmap


def pdf_font_decoder(objects, number):
    """A function from a shown string's bytes to text, for the three font encodings the 신분당 PDFs use."""
    head = pdf_object(objects, number, "a font")[0]
    where = "PDF font %d" % number
    to_unicode = pdf_ref(head, b"ToUnicode")
    if to_unicode is not None:
        cmap = pdf_cmap(pdf_stream(objects, to_unicode, "a ToUnicode CMap").decode("latin-1"), where)

        def decode(raw):
            codes = [int.from_bytes(raw[i:i + 2], "big") for i in range(0, len(raw), 2)]
            missing = [code for code in codes if code not in cmap]
            if len(raw) % 2 or missing:
                raise ConvertError("%s: codes %s are not in its ToUnicode CMap" % (where, missing))
            return "".join(cmap[code] for code in codes)

        return decode
    if re.search(rb"/Encoding\s*/UniKS-UCS2-H\b", head):
        return lambda raw: raw.decode("utf-16-be")
    if re.search(rb"/Encoding\s*/WinAnsiEncoding\b", head):
        return lambda raw: raw.decode("cp1252")
    raise ConvertError("%s: an encoding this reader does not know" % where)


def pdf_page_fonts(objects, page):
    head = objects[page][0]
    resources = pdf_ref(head, b"Resources")
    text = pdf_object(objects, resources, "page resources")[0] if resources is not None else head
    fonts = pdf_ref(text, b"Font")
    if fonts is not None:
        text = pdf_object(objects, fonts, "a font dictionary")[0]
    else:
        match = re.search(rb"/Font\s*<<(.*?)>>", text, re.S)
        if match is None:
            raise ConvertError("PDF page %d has no fonts" % page)
        text = match.group(1)
    return {name.decode(): pdf_font_decoder(objects, int(number)) for name, number in re.findall(rb"/([^\s/<>\[\]()]+)\s*(\d+)\s+\d+\s+R", text)}


def pdf_literal(content, i):
    """The bytes of the literal string that opens at content[i], and the index after it."""
    out = bytearray()
    depth = 0
    i += 1
    while i < len(content):
        c = content[i]
        if c == 0x5C:
            nxt = content[i + 1]
            if 0x30 <= nxt <= 0x37:
                j = i + 1
                while j < i + 4 and j < len(content) and 0x30 <= content[j] <= 0x37:
                    j += 1
                out.append(int(content[i + 1:j], 8) & 0xFF)
                i = j
                continue
            out += {ord("n"): b"\n", ord("r"): b"\r", ord("t"): b"\t", ord("b"): b"\b", ord("f"): b"\f", 0x0A: b"", 0x0D: b""}.get(nxt, bytes([nxt]))
            i += 2
            continue
        if c == 0x28:
            depth += 1
        elif c == 0x29:
            if depth == 0:
                return bytes(out), i + 1
            depth -= 1
        out.append(c)
        i += 1
    raise ConvertError("PDF: an unterminated string")


def pdf_tokens(content):
    """(kind, value) tokens of a content stream: str (bytes), num, name, op, and [ ] as op."""
    i = 0
    while i < len(content):
        c = content[i:i + 1]
        if c.isspace():
            i += 1
        elif c == b"%":
            while i < len(content) and content[i:i + 1] not in (b"\r", b"\n"):
                i += 1
        elif c == b"(":
            value, i = pdf_literal(content, i)
            yield "str", value
        elif content[i:i + 2] in (b"<<", b">>"):
            yield "op", content[i:i + 2].decode()
            i += 2
        elif c == b"<":
            end = content.index(b">", i)
            yield "str", bytes.fromhex(re.sub(rb"\s", b"", content[i + 1:end]).decode())
            i = end + 1
        elif c in (b"[", b"]", b"{", b"}"):
            yield "op", c.decode()
            i += 1
        else:
            j = i + 1
            while j < len(content) and not content[j:j + 1].isspace() and content[j] not in PDF_DELIMITERS:
                j += 1
            word = content[i:j].decode("latin-1")
            if c == b"/":
                yield "name", word[1:]
            elif re.fullmatch(r"[-+]?(\d+\.?\d*|\.\d+)", word):
                yield "num", float(word)
            else:
                yield "op", word
            i = j


def pdf_text_runs(objects, page):
    """(x, y, text) of every string a page shows, at the text matrix's origin when it is shown."""
    fonts = pdf_page_fonts(objects, page)
    head = objects[page][0]
    contents = re.search(rb"/Contents\s*\[?\s*((?:\d+\s+\d+\s+R\s*)+)\]?", head)
    if contents is None:
        raise ConvertError("PDF page %d has no contents" % page)
    content = b"\n".join(pdf_stream(objects, int(n), "page contents") for n in re.findall(rb"(\d+)\s+\d+\s+R", contents.group(1)))
    runs = []
    stack = []
    matrix = line = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    leading = 0.0
    font = None

    def move(tx, ty):
        a, b, c, d, e, f = line
        return (a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d)

    def show(strings):
        if font is None:
            raise ConvertError("PDF page %d shows text with no font" % page)
        runs.append((matrix[4], matrix[5], "".join(font(raw) for raw in strings)))

    for kind, value in pdf_tokens(content):
        if kind != "op":
            stack.append(value)
            continue
        if value == "[":
            stack.append("[")
            continue
        if value == "]":
            start = len(stack) - 1 - stack[::-1].index("[")
            items = stack[start + 1:]
            del stack[start:]
            stack.append(items)
            continue
        if value == "BT":
            matrix = line = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        elif value == "Tf":
            name = stack[-2]
            if name not in fonts:
                raise ConvertError("PDF page %d uses font %s, which its resources do not list" % (page, name))
            font = fonts[name]
        elif value == "Tm":
            matrix = line = tuple(stack[-6:])
        elif value in ("Td", "TD"):
            if value == "TD":
                leading = -stack[-1]
            matrix = line = move(stack[-2], stack[-1])
        elif value == "TL":
            leading = stack[-1]
        elif value == "T*":
            matrix = line = move(0, -leading)
        elif value == "Tj":
            show([stack[-1]])
        elif value == "TJ":
            show([item for item in stack[-1] if isinstance(item, bytes)])
        elif value in ("'", '"'):
            matrix = line = move(0, -leading)
            show([stack[-1]])
        elif value in ("BI", "ID"):
            raise ConvertError("PDF page %d holds an inline image, which this reader does not skip" % page)
        stack = []
    return runs


def pdf_rows(runs):
    """Runs grouped into rows, top to bottom, each sorted left to right: a gap of more than 3 points in y starts a
    row (the two editions put one row's runs up to 0.5 points apart)."""
    rows = []
    for x, y, text in sorted(runs, key=lambda r: -r[1]):
        if rows and rows[-1][0] - y <= 3:
            rows[-1][1].append((x, text))
        else:
            rows.append((y, [(x, text)]))
    return [(y, sorted(cells)) for y, cells in rows]


def shinbundang_page(runs, where):
    """One station page: {"title", "plan", "from", "days", "columns": {"신사방면" | "광교방면": [(seconds, short turn)]}}.

    The page heads a table with 신사방면, 시 and 광교방면; each row below holds an hour in the 시 column and that
    hour's minutes in each direction's column, a minute followed by (정자) for a train that ends at 정자.
    """
    rows = pdf_rows(runs)
    joined = ["".join(text for _, text in cells) for _, cells in rows]
    page = "".join(joined)
    titles = [text.replace(" ", "") for text in joined if text.replace(" ", "").endswith("열차시각표")]
    meta = {
        "plan": re.search(r"기본계획번호\s*:\s*([A-Z0-9]+)", page),
        "from": re.search(r"적용기간\s*:\s*(\d{4}-\d{2}-\d{2})~", page),
        "days": re.search(r"운행요일\s*:\s*(평일|공휴일|휴일)", page),
    }
    if len(titles) != 1 or None in meta.values():
        raise ConvertError("%s: no single title, 기본계획번호, 적용기간 and 운행요일" % where)
    headers = [index for index, text in enumerate(joined) if "방면" in text and "시" in text.replace("방면", "")]
    if len(headers) != 1:
        raise ConvertError("%s: no single header row with 시 and 방면" % where)
    header_y, header_cells = rows[headers[0]]
    hour_x = [x for x, text in header_cells if text.strip() == "시"]
    if len(hour_x) != 1:
        raise ConvertError("%s: the header row has no single 시" % where)
    hour_x = hour_x[0]

    def sides(cells):
        left = "".join(text for x, text in cells if x < hour_x - SHINBUNDANG_COLUMN_GAP)
        hour = "".join(text for x, text in cells if abs(x - hour_x) <= SHINBUNDANG_COLUMN_GAP)
        right = "".join(text for x, text in cells if x > hour_x + SHINBUNDANG_COLUMN_GAP)
        return left.strip(), hour.strip(), right.strip()

    left_name, _, right_name = sides(header_cells)
    if left_name not in ("", "신사방면") or right_name not in ("", "광교방면") or not (left_name or right_name):
        raise ConvertError("%s: header columns %r and %r are not 신사방면 and 광교방면" % (where, left_name, right_name))
    columns = {name: [] for name in (left_name, right_name) if name}
    previous_hour = None
    for y, cells in rows[headers[0] + 1:]:
        left, hour, right = sides(cells)
        if not (left or hour or right):
            continue
        if not re.fullmatch(r"\d{2}", hour):
            raise ConvertError("%s: row at y %.1f has hour %r" % (where, y, hour))
        clock_hour = int(hour) * 3600
        hour_seconds = service_seconds(clock_hour)
        if previous_hour is not None and hour_seconds <= previous_hour:
            raise ConvertError("%s: hour %s does not follow the row above" % (where, hour))
        previous_hour = hour_seconds
        for name, text in ((left_name, left), (right_name, right)):
            if not text:
                continue
            if not name or not re.fullmatch(r"\d{2}(\(정자\))?( \d{2}(\(정자\))?)*", re.sub(r"\s+", " ", text)):
                raise ConvertError("%s: hour %s holds %r, not minutes under a direction" % (where, hour, text))
            for minute, short in re.findall(r"(\d{2})(\(정자\))?", text):
                if int(minute) > 59:
                    raise ConvertError("%s: hour %s minute %s" % (where, hour, minute))
                columns[name].append((hour_seconds + int(minute) * 60, bool(short)))
    for name, times in columns.items():
        if [t for t, _ in times] != sorted({t for t, _ in times}):
            raise ConvertError("%s: %s times do not increase" % (where, name))
    return {"title": titles[0][: -len("열차시각표")], "plan": meta["plan"].group(1), "from": meta["from"].group(1), "days": meta["days"].group(1), "columns": columns}


def shinbundang_chain(pages, direction, line=LINED1):
    """Join one direction's per-station times into runs, in travel order, with no overtaking.

    Each open run takes the earliest unclaimed time at the next station that is at least SHINBUNDANG_MIN_HOP after
    its last one; a time no run takes starts a run, which only the line's first station and SHINBUNDANG_ENTRIES may
    do. A run marked (정자) ends at 정자, which its page does not list: it arrives there one segment time after its
    last time, the most common time of the runs that make that segment. Returns [[(KRIC code, seconds, listed)]].
    """
    column = SHINBUNDANG_COLUMNS[direction]
    order = travel_order(line, direction)
    pages_by_code = dict(zip(station_codes(line), pages))
    runs = []
    open_runs = []
    for index, code in enumerate(order):
        times = pages_by_code[code]["columns"].get(column)
        where = "%s %s %s" % (pages_by_code[code]["title"], column, direction)
        if times is None:
            if index != len(order) - 1:
                raise ConvertError("%s: no column before the last station" % where)
            break
        next_open = []
        k = 0
        taken = set()
        for run in open_runs:
            if run["short"] and code == SHINBUNDANG_SHORT_TURN:
                run["stops"].append((code, None, False))
                continue
            last = run["stops"][-1][1]
            while k < len(times) and times[k][0] < last + SHINBUNDANG_MIN_HOP:
                k += 1
            if k == len(times):
                raise ConvertError("%s: the run at %s %s finds no time" % (where, run["stops"][-1][0], clock(last)))
            if times[k][1] != run["short"]:
                raise ConvertError("%s: %s is marked (정자) on one station of its run only" % (where, clock(times[k][0])))
            run["stops"].append((code, times[k][0], True))
            taken.add(k)
            k += 1
            next_open.append(run)
        for j, (seconds, short) in enumerate(times):
            if j in taken:
                continue
            if index > 0 and code not in SHINBUNDANG_ENTRIES:
                raise ConvertError("%s: %s starts a run, and no run starts there" % (where, clock(seconds)))
            run = {"short": short, "stops": [(code, seconds, True)]}
            runs.append(run)
            next_open.append(run)
        open_runs = sorted(next_open, key=lambda r: r["stops"][-1][1])
    hops = {}
    for run in runs:
        for (a, ta, _), (b, tb, _) in zip(run["stops"], run["stops"][1:]):
            if tb is not None:
                hops.setdefault((a, b), {}).setdefault(tb - ta, 0)
                hops[(a, b)][tb - ta] += 1
    for (a, b), counts in hops.items():
        if max(counts) - min(counts) > SHINBUNDANG_HOP_SPREAD:
            raise ConvertError("%s: segment %s-%s takes %s minutes" % (direction, a, b, sorted(c // 60 for c in counts)))
    chained = []
    for run in runs:
        stops = list(run["stops"])
        if stops[-1][1] is None:
            segment = hops.get((stops[-2][0], stops[-1][0]))
            if not segment:
                raise ConvertError("%s: no run makes the segment %s-%s" % (direction, stops[-2][0], stops[-1][0]))
            hop = sorted(segment.items(), key=lambda item: (-item[1], item[0]))[0][0]
            stops[-1] = (stops[-1][0], stops[-2][1] + hop, False)
        chained.append(stops)
    return chained


def shinbundang_pages(data, day_type, line=LINED1):
    """The station pages of one day type's PDF, checked against the line's stations, edition and day type."""
    objects = pdf_objects(data)
    name = SHINBUNDANG_FILES[day_type][0]
    pages = [shinbundang_page(pdf_text_runs(objects, page), "%s page %d" % (name, index + 1)) for index, page in enumerate(pdf_pages(objects))]
    return check_shinbundang_pages(pages, day_type, line)


def check_shinbundang_pages(pages, day_type, line=LINED1):
    """The pages, when their titles are the line's KRIC names in route order and each is the edition and day type
    SHINBUNDANG_FILES expects; refuses them otherwise."""
    name, days = SHINBUNDANG_FILES[day_type]
    titles = [page["title"] for page in pages]
    expected = [title for _, title in line["stations"]]
    if titles != expected:
        raise ConvertError("%s: page titles %s are not the KRIC names %s" % (name, titles, expected))
    editions = {(page["plan"], page["from"], page["days"]) for page in pages}
    if editions != {(SHINBUNDANG_PLAN, SHINBUNDANG_REVISION, days)}:
        raise ConvertError("%s: edition %s is not %s from %s, %s" % (name, sorted(editions), SHINBUNDANG_PLAN, SHINBUNDANG_REVISION, days))
    return pages


def shinbundang_trains(pages, line=LINED1):
    """Every run of both directions as a train: arrival and departure at each listed minute, numbered per direction
    in order of its first time with the direction's parity, to its terminus or, marked (정자), to 정자."""
    trains = []
    for direction in ("up", "down"):
        order = travel_order(line, direction)
        runs = sorted(shinbundang_chain(pages, direction, line), key=lambda run: (run[0][1], order.index(run[0][0])))
        for index, run in enumerate(runs):
            ends_short = not run[-1][2]
            stops = [{"station": code, "arr": seconds, "dep": seconds if listed else None} for code, seconds, listed in run]
            trains.append({
                "trainNo": "%04d" % (SHINBUNDANG_FIRST_RUN[direction] + 2 * index),
                "direction": direction,
                "destination": "정자" if ends_short else SHINBUNDANG_TERMINI[direction],
                "express": False,
                "stops": stops,
            })
    for train in trains:
        validate_train(train, line["served"], "shinbundang train %s" % train["trainNo"])
    return trains


def zip_member(archive, name):
    """A member by name, whether the zip spells it in UTF-8 (the flag or a Unicode path field) or in bare cp949."""
    for info in archive.infolist():
        names = {info.filename}
        try:
            names.add(info.filename.encode("cp437").decode("cp949"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        if name in names:
            return archive.read(info)
    raise ConvertError("the 신분당 zip holds no %s" % name)


def clock(seconds):
    return "%02d:%02d" % (seconds // 3600, seconds % 3600 // 60)


# ---------------------------------------------------------------- output

def timetable(kind, ref, revision, operator, line, day_type, stations, trains):
    return {
        "source": {"kind": kind, "ref": ref, "revision": revision},
        "operator": operator,
        "line": line,
        "dayType": day_type,
        "stations": stations,
        "trains": [{k: v for k, v in t.items() if not k.startswith("_")} for t in sort_trains(trains)],
    }


def render(document):
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def keep_revision(path, document):
    """A rerun over unchanged trains keeps the file's revision, so the output is byte-identical."""
    try:
        with open(path, encoding="utf-8") as handle:
            existing = json.load(handle)
    except (OSError, ValueError):
        return document
    if existing.get("trains") == document["trains"] and existing.get("source", {}).get("ref") == document["source"]["ref"]:
        document["source"]["revision"] = existing["source"]["revision"]
    return document


def part_key(document):
    """The table's key in the subway-timetables dataset, which `npm run data` keys its part by (toTimetableKey)."""
    return "%s-%s-%s" % (document["operator"], document["line"], document["dayType"])


def write(out_dir, line, document):
    name = "%s.json" % part_key(document)
    path = os.path.join(out_dir, name)
    if document["source"]["kind"] == "seoul-station-timetable":
        document = keep_revision(path, document)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(render(document))
    by_direction = {d: sum(1 for t in document["trains"] if t["direction"] == d) for d in ("up", "down")}
    print("%s: %d trains at %s (up %d, down %d), revision %s" % (name, len(document["trains"]), ", ".join(line["served"]), by_direction["up"], by_direction["down"], document["source"]["revision"]))


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "skkuverse-server scripts/subway-timetable"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise ConvertError("%s: HTTP %d" % (url, error.code)) from None


def read_local_or_download(local, url):
    if local:
        with open(local, "rb") as handle:
            return handle.read()
    return download(url)


def build_korail_line(out_dir, line, day_type, data):
    label = "korail %s %s" % (line["line"], day_type)
    trains = with_upstream_destinations(korail_trains(read_workbook(data), line, day_type), label, line)
    check_unique(trains, label, allow_split=False)
    check_one_direction(trains, label, line)
    document = timetable("korail-xlsx", line["urls"][day_type], line["revision"], line["operator"], line["line"], day_type, station_codes(line), trains)
    write(out_dir, line, document)


def build_korail(out_dir, weekday_file, holiday_file):
    for day_type, local in (("weekday", weekday_file), ("holiday", holiday_file)):
        build_korail_line(out_dir, LINE1, day_type, read_local_or_download(local, LINE1["urls"][day_type]))


def build_korail_k1(out_dir, local):
    data = read_local_or_download(local, KORAIL_K1_URL)
    for day_type in ("weekday", "holiday"):
        build_korail_line(out_dir, LINEK1, day_type, data)


def build_shinbundang(out_dir, local):
    import io

    archive = zipfile.ZipFile(io.BytesIO(read_local_or_download(local, SHINBUNDANG_ZIP_URL)))
    for day_type, (name, _) in SHINBUNDANG_FILES.items():
        trains = shinbundang_trains(shinbundang_pages(zip_member(archive, name), day_type))
        label = "shinbundang %s" % day_type
        check_unique(trains, label, allow_split=False)
        check_one_direction(trains, label, LINED1)
        document = timetable("shinbundang-pdf", "%s#%s" % (SHINBUNDANG_ZIP_URL, name), SHINBUNDANG_REVISION, LINED1["operator"], LINED1["line"], day_type, station_codes(LINED1), trains)
        write(out_dir, LINED1, document)


def read_pulled(out_dir, line, day_type):
    path = os.path.join(out_dir, "%s-%s-%s.json" % (line["operator"], line["line"], day_type))
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise ConvertError("--seoul-keep-pulled needs the pulled %s" % path) from None


def build_seoul(out_dir, today, lines=SEOUL_LINES, rows_dir=None, keep_pulled=False):
    key = os.environ.get("SEOUL_OPENAPI_GENERAL_KEY")
    if not key and not (rows_dir or keep_pulled):
        raise ConvertError("SEOUL_OPENAPI_GENERAL_KEY is not set; set it in the environment")

    def call(code, week, inout):
        if not key:
            raise ConvertError("station %s WEEK_TAG %s INOUT_TAG %s is neither saved nor pulled, and SEOUL_OPENAPI_GENERAL_KEY is not set" % (code, week, inout))
        return seoul_fetch(key, code, week, inout)

    answer = saved_fetch(rows_dir, call, today) if rows_dir else call
    fetched = {}

    for line in lines:
        for day_type, week in SEOUL_WEEK_TAGS:
            kept = pulled_rows(read_pulled(out_dir, line, day_type), line) if keep_pulled else {}

            def fetch(code, week, inout, kept=kept):
                if (code, inout) in kept:
                    return kept[(code, inout)]
                fetched[(code, week, inout)] = answer(code, week, inout)
                return fetched[(code, week, inout)]

            trains = seoul_trains(fetch, week, line)
            check_unique(trains, "seoul %s %s" % (line["line"], day_type), allow_split=True)
            check_one_direction(trains, "seoul %s %s" % (line["line"], day_type), line)
            document = timetable("seoul-station-timetable", SEOUL_API, today, line["operator"], line["line"], day_type, station_codes(line), trains)
            write(out_dir, line, document)
    for (code, week, inout, train_no, left), _ in SEOUL_ARRIVAL_FIXES.items():
        rows = fetched.get((code, week, inout))
        if rows is not None and not any(r.get("TRAIN_NO") == train_no and r.get("LEFTTIME") == left and r.get("ARRIVETIME") == "00:00:00" for r in rows):
            print("convert.py: SEOUL_ARRIVAL_FIXES %s is no longer needed" % ((code, week, inout, train_no, left),), file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the subway-timetables parts from the Korail xlsx files, the Seoul API and the Shinbundang PDFs.")
    parser.add_argument("--only", choices=("korail", "seoul", "shinbundang"), help="build one source only")
    parser.add_argument("--line", action="append", choices=[line["line"] for line in LINES], help="build this line only; repeatable")
    parser.add_argument("--out", required=True, help="the parts/ directory of a pulled subway-timetables (.data/<dev|prod>/subway-timetables/parts)")
    parser.add_argument("--korail-weekday", help="a local copy of KORAIL_WEEKDAY_URL")
    parser.add_argument("--korail-holiday", help="a local copy of KORAIL_HOLIDAY_URL")
    parser.add_argument("--korail-k1", help="a local copy of KORAIL_K1_URL")
    parser.add_argument("--shinbundang-zip", help="a local copy of SHINBUNDANG_ZIP_URL")
    parser.add_argument("--seoul-rows", help="read each Seoul answer saved in this directory (scripts/subway-timetable/seoul-rows) and save each one fetched")
    parser.add_argument("--seoul-keep-pulled", action="store_true", help="keep the stop times of the stations a pulled Seoul table lists; call only for the others")
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    wanted = set(args.line or [line["line"] for line in LINES])
    try:
        if args.only in (None, "korail") and "1" in wanted:
            build_korail(args.out, args.korail_weekday, args.korail_holiday)
        if args.only in (None, "korail") and "K1" in wanted:
            build_korail_k1(args.out, args.korail_k1)
        if args.only in (None, "seoul"):
            build_seoul(args.out, today, [line for line in SEOUL_LINES if line["line"] in wanted], args.seoul_rows, args.seoul_keep_pulled)
        if args.only in (None, "shinbundang") and "D1" in wanted:
            build_shinbundang(args.out, args.shinbundang_zip)
    except ConvertError as error:
        print("convert.py: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
