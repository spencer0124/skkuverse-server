#!/usr/bin/env python3
"""Unit tests of convert.py, without the network or the Seoul API key.

Run from the repository root (jest runs it from __tests__/nest/subway/subway-timetable-convert.test.ts):

    python3 -I scripts/subway-timetable/test_convert.py

The Korail tests build a small xlsx in memory with the layout of the 2026-08-28 files: row 2 시발역,
row 3 종착역, row 4 열차번호, then two rows per station (arrival with the name, departure below).
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
import zlib
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)

import convert  # noqa: E402


def column_letter(index):
    letters = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def xlsx(sheets):
    """xlsx bytes from {sheet name: {(row, column): str | float}}, strings inline."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        entries = "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i + 1, i + 1) for i, name in enumerate(sheets))
        archive.writestr("xl/workbook.xml", '<workbook xmlns="%s" xmlns:r="%s"><sheets>%s</sheets></workbook>' % (convert.XLSX_NS, convert.REL_NS, entries))
        rels = "".join('<Relationship Id="rId%d" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(sheets)))
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="%s">%s</Relationships>' % (convert.PKG_REL_NS, rels))
        for i, cells in enumerate(sheets.values()):
            rows = {}
            for (row, column), value in cells.items():
                rows.setdefault(row, []).append((column, value))
            xml_rows = []
            for row in sorted(rows):
                xml_cells = []
                for column, value in sorted(rows[row]):
                    ref = "%s%d" % (column_letter(column), row)
                    if isinstance(value, str):
                        xml_cells.append('<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(value)))
                    else:
                        xml_cells.append('<c r="%s"><v>%r</v></c>' % (ref, value))
                xml_rows.append('<row r="%d">%s</row>' % (row, "".join(xml_cells)))
            archive.writestr("xl/worksheets/sheet%d.xml" % (i + 1), '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (convert.XLSX_NS, "".join(xml_rows)))
    return buffer.getvalue()


def fraction(hh, mm, ss=0):
    return (hh * 3600 + mm * 60 + ss) / 86400.0


def korail_sheet(stations, trains):
    """Cells of one block: stations is a list of names in row order; trains maps a column to
    (train number, origin, destination, {station name: (arrival fraction | None, departure fraction | None)})."""
    cells = {(2, 0): "시발역", (3, 0): "종착역", (4, 0): "열차번호"}
    for index, name in enumerate(stations):
        cells[(5 + 2 * index, 0)] = name + "  "
    for column, (number, origin, destination, times) in trains.items():
        cells[(2, column)] = origin + "  "
        cells[(3, column)] = destination + " "
        cells[(4, column)] = number
        for index, name in enumerate(stations):
            arr, dep = times.get(name, (None, None))
            cells[(5 + 2 * index, column)] = "        " if arr is None else arr
            if dep is not None:
                cells[(6 + 2 * index, column)] = dep
    return cells


UP_STATIONS = ["천안", "수원", "화서", "성균관", "의왕", "군포", "금정"]


class TrainNumbers(unittest.TestCase):
    def test_strips_letters_and_pads_to_four_digits(self):
        # Arrange
        cases = {"K602": "0602", "S418": "0418", "K4302": "4302", "1906": "1906", "K1902": "1902", " K602 ": "0602"}

        # Act
        normalized = {raw: convert.normalize_train_no(raw) for raw in cases}

        # Assert
        self.assertEqual(normalized, cases)

    def test_refuses_what_is_not_a_train_number(self):
        for raw in ("K12345", "열차번호", "", "K60A"):
            with self.subTest(raw=raw):
                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.normalize_train_no(raw)


class Times(unittest.TestCase):
    def test_excel_fraction_becomes_seconds_after_the_service_day_start(self):
        # Arrange
        cases = [
            (0.2534722222222222, 21900),  # 06:05:00, K602 at 성균관 in the 2026-08-28 file
            (0.25381944444444443, 21930),  # 06:05:30
            (fraction(0, 13, 30), 87210),  # after midnight
            (1 + fraction(0, 13, 30), 87210),  # a fraction past 1.0 is the same clock time
            (fraction(2, 59, 30), 86400 + 10770),  # just before the service day starts
            (fraction(3, 0), 10800),  # the service day start itself
        ]

        # Act
        seconds = [convert.service_seconds(convert.excel_seconds(f, "test")) for f, _ in cases]

        # Assert
        self.assertEqual(seconds, [expected for _, expected in cases])

    def test_excel_value_that_is_not_a_time_is_refused(self):
        # Act & Assert
        with self.assertRaises(convert.ConvertError):
            convert.excel_seconds(-0.1, "test")

    def test_seoul_clock_times_past_24_and_the_zero_sentinel(self):
        # Arrange
        cases = {"05:41:00": 20460, "24:13:30": 87210, "25:00:00": 90000, "00:00:00": None}

        # Act
        seconds = {value: convert.hms_seconds(value, "test") for value in cases}

        # Assert
        self.assertEqual(seconds, cases)

    def test_seoul_time_in_another_format_is_refused(self):
        for value in ("5:41:00", "05:41", "", None):
            with self.subTest(value=value):
                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.hms_seconds(value, "test")


class KorailNames(unittest.TestCase):
    def test_maps_the_eleven_covered_short_names(self):
        # Arrange
        names = ["병점", "세류", "수원", "화서", "성균관", "의왕", "당정", "군포", "금정", "명학", "안양"]

        # Act
        codes = [convert.korail_code(name, "test") for name in names]

        # Assert
        self.assertEqual(codes, ["KR-1-P157", "KR-1-1715", "KR-1-P155", "KR-1-P154", "KR-1-P153", "KR-1-P152", "KR-1-P151", "KR-1-P150", "KR-1-P149", "KR-1-P148", "KR-1-P147"])

    def test_leaves_other_stations_unmapped(self):
        # Act & Assert
        self.assertEqual([convert.korail_code(name, "test") for name in ("서동탄", "세마", "도봉산", "구일")], [None, None, None, None])

    def test_maps_the_stretch_from_anyang_to_hoegi_that_jongno_5_ga_needs(self):
        # Arrange
        names = ["관악", "석수", "금천구", "독산", "가산디", "구로", "신도림", "영등포", "신길", "대방", "노량진", "용산", "남영", "지하서", "시청", "종각", "1종로", "종로5", "1동대", "동묘앞", "신설동", "제기동", "1지청", "회기"]

        # Act
        codes = [convert.korail_code(name, "test") for name in names]

        # Assert
        self.assertEqual(codes, [
            "KR-1-P146", "KR-1-P145", "KR-1-P144", "KR-1-P143", "KR-1-P142", "KR-1-141", "KR-1-140", "KR-1-139", "KR-1-138", "KR-1-137", "KR-1-136", "KR-1-135", "KR-1-134",
            "S1-1-150", "S1-1-151", "S1-1-152", "S1-1-153", "S1-1-154", "S1-1-155", "S1-1-159", "S1-1-156", "S1-1-157", "S1-1-158", "KR-1-123",
        ])

    def test_refuses_a_covered_looking_name_with_the_sheet_and_row(self):
        # Arrange
        cells = korail_sheet(["화서", "성균관대", "의왕"], {1: ("K602", "천안", "1지청", {"화서": (None, fraction(6, 3))})})
        workbook = convert.read_workbook(xlsx({"경부장항_평일_상": cells}))

        # Act
        with self.assertRaises(convert.ConvertError) as caught:
            convert.korail_trains(workbook)

        # Assert
        self.assertIn("경부장항_평일_상 row 7", str(caught.exception))
        self.assertIn("성균관대", str(caught.exception))


class KorailWorkbook(unittest.TestCase):
    def setUp(self):
        local = {name: (fraction(6, m), fraction(6, m, 30)) for name, m in zip(UP_STATIONS, range(0, 14, 2))}
        local["천안"] = (None, fraction(6, 0, 30))
        local["금정"] = (fraction(6, 12), None)
        express = {
            "천안": (None, fraction(7, 0)),
            "수원": (fraction(7, 10), fraction(7, 11)),
            "화서": (None, fraction(7, 12)),  # a pass: a departure-row time only
            "성균관": (fraction(7, 14), fraction(7, 14, 30)),
            "금정": (fraction(7, 20), None),
        }
        late = {"성균관": (None, fraction(23, 58)), "의왕": (fraction(23, 59, 30), fraction(0, 0)), "군포": (fraction(0, 2), None)}
        skips = {"천안": (None, fraction(8, 0)), "수원": (fraction(8, 10), None)}
        self.cells = korail_sheet(UP_STATIONS, {1: ("K602", "천안", "1지청", local), 2: ("K1902", "천안", "서울", express), 3: ("S418", "성균관", "구로", late), 4: ("K604", "천안", "수원", skips)})

    def trains(self, cells=None, sheet="경부장항_평일_상"):
        return {t["trainNo"]: t for t in convert.korail_trains(convert.read_workbook(xlsx({sheet: cells or self.cells, "광명셔틀_평일_상": {(4, 0): "열차번호"}})))}

    def test_reads_stops_at_covered_stations_in_travel_order(self):
        # Act
        train = self.trains()["0602"]

        # Assert
        self.assertEqual(train["direction"], "up")
        self.assertEqual(train["destination"], "1지청")
        self.assertFalse(train["express"])
        self.assertEqual([s["station"] for s in train["stops"]], ["KR-1-P155", "KR-1-P154", "KR-1-P153", "KR-1-P152", "KR-1-P150", "KR-1-P149"])
        self.assertEqual(train["stops"][2], {"station": "KR-1-P153", "arr": 6 * 3600 + 6 * 60, "dep": 6 * 3600 + 6 * 60 + 30})

    def test_keeps_only_trains_that_stop_at_the_served_station_and_ignores_other_sheets(self):
        # Act
        numbers = sorted(self.trains())

        # Assert
        self.assertEqual(numbers, ["0418", "0602", "1902"])

    def test_express_passes_are_not_stops(self):
        # Act
        train = self.trains()["1902"]

        # Assert
        self.assertTrue(train["express"])
        self.assertEqual([s["station"] for s in train["stops"]], ["KR-1-P155", "KR-1-P153", "KR-1-P149"])

    def test_origin_and_terminus_have_one_time_and_midnight_rolls_over(self):
        # Act
        stops = self.trains()["0418"]["stops"]

        # Assert
        self.assertEqual(stops, [
            {"station": "KR-1-P153", "arr": None, "dep": 23 * 3600 + 58 * 60},
            {"station": "KR-1-P152", "arr": 23 * 3600 + 59 * 60 + 30, "dep": 86400},
            {"station": "KR-1-P150", "arr": 86400 + 120, "dep": None},
        ])

    def test_a_pass_on_a_train_not_numbered_1xxx_is_refused(self):
        # Arrange
        cells = dict(self.cells)
        cells[(2 * UP_STATIONS.index("화서") + 5, 1)] = "        "

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "passes a station"):
            self.trains(cells)

    def test_a_sheet_name_that_disagrees_with_the_station_order_is_refused(self):
        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "sheet name says down"):
            self.trains(sheet="경부장항_평일_하")


class KorailGyeonginSheets(unittest.TestCase):
    """종로5가 is served from the 경인 sheets too: their 인천-청량리 trains run through it. The 경인급행 sheets end at 용산."""

    STATIONS = ["구로", "신도림", "영등포", "용산", "지하서", "시청", "종각", "1종로", "종로5", "1동대"]

    def trains(self, sheet):
        times = {name: (fraction(9, m), fraction(9, m, 30)) for name, m in zip(self.STATIONS, range(0, 20, 2))}
        times["구로"] = (None, fraction(9, 0, 30))
        times["1동대"] = (fraction(9, 18), None)
        cells = korail_sheet(self.STATIONS, {1: ("K1102", "인천", "1지청", times)})
        express = korail_sheet(["구로", "신도림", "영등포", "용산"], {1: ("K1202", "동인천", "용산", {"구로": (None, fraction(9, 0)), "용산": (fraction(9, 10), None)})})
        workbook = convert.read_workbook(xlsx({sheet: cells, "경인급행_평일_상": express}))
        return {t["trainNo"]: t for t in convert.korail_trains(workbook)}

    def test_reads_a_gyeongin_sheet_train_that_stops_at_jongno_5_ga(self):
        # Act
        train = self.trains("경인_평일_상")["1102"]

        # Assert
        self.assertEqual(train["direction"], "up")
        self.assertIn({"station": "S1-1-154", "arr": 9 * 3600 + 16 * 60, "dep": 9 * 3600 + 16 * 60 + 30}, train["stops"])

    def test_a_local_may_pass_a_station_the_line_does_not_cover(self):
        # Arrange
        stations = ["덕계", "마전", "양주"] + self.STATIONS[::-1]
        times = {name: (fraction(9, m), fraction(9, m, 30)) for name, m in zip(stations, range(0, 26, 2))}
        times["덕계"] = (None, fraction(9, 0, 30))
        times["마전"] = (None, fraction(9, 2, 30))
        times["구로"] = (fraction(9, 24), None)
        cells = korail_sheet(stations, {1: ("K2952", "덕계", "인천", times)})

        # Act
        trains = convert.korail_trains(convert.read_workbook(xlsx({"경인_평일_하": cells})))

        # Assert
        self.assertEqual([t["trainNo"] for t in trains], ["2952"])
        self.assertEqual(trains[0]["stops"][0]["station"], "S1-1-155")

    def test_leaves_the_gyeongin_express_sheet_unread(self):
        # Act
        numbers = sorted(self.trains("경인_평일_상"))

        # Assert
        self.assertEqual(numbers, ["1102"])


class SeoulLineCoverage(unittest.TestCase):
    """ADR 0022 D4: 사당 (lines 2 and 4), 금정 (line 4) and 종로5가 (line 1) are served, with every station between the
    served platforms covered and about ten minutes beyond them (ADR 0017 D6)."""

    def test_line_4_serves_hyehwa_sadang_and_geumjeong_from_suyu_to_sangnoksu(self):
        # Arrange
        line = line_of("4")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("S1-4-420", "S1-4-433", "KR-4-443"))
        self.assertEqual(codes, ["S1-4-%d" % n for n in range(414, 435)] + ["KR-4-%d" % n for n in range(435, 449)])
        self.assertEqual(dict(line["stations"])["KR-4-443"], "1458")
        self.assertEqual(dict(line["stations"])["KR-4-445"], "1763")

    def test_line_2_serves_sadang_and_reaches_guro_digital_complex(self):
        # Arrange
        line = line_of("2")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("S1-2-216", "S1-2-222", "S1-2-226"))
        self.assertEqual(codes, ["S1-2-%d" % n for n in range(212, 233)])

    def test_line_1_serves_sungkyunkwan_geumjeong_and_jongno_5_ga(self):
        # Act
        served = line_of("1")["served"]

        # Assert
        self.assertEqual(served, ("KR-1-P153", "KR-1-P149", "S1-1-154"))


class CommuteViaCoverage(unittest.TestCase):
    """The commute shuttle's via stops 미금, 복정, 가락시장 and 송파 are served with every line that stops there, each
    station between the served platforms covered and far enough beyond them that a train is in view for ten minutes (ADR 0017 D6)."""

    def test_line_3_serves_garak_market_inside_its_covered_stretch(self):
        # Arrange
        line = line_of("3")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("S1-3-332", "S1-3-334", "S1-3-340"))
        self.assertEqual(codes, ["S1-3-%d" % n for n in range(326, 343)])
        self.assertEqual(dict(line["stations"])["S1-3-340"], "0340")

    def test_line_8_serves_songpa_garak_market_and_bokjeong_and_reaches_moran(self):
        # Arrange
        line = line_of("8")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("S1-8-2815", "S1-8-2817", "S1-8-2818", "S1-8-2821"))
        self.assertEqual(codes[-8:], ["S1-8-2821", "S1-8-2828", "S1-8-2822", "S1-8-2823", "S1-8-2824", "S1-8-2825", "S1-8-2826", "S1-8-2827"])
        self.assertEqual([dict(line["stations"])[code] for code in ("S1-8-2817", "S1-8-2818", "S1-8-2821", "S1-8-2827")], ["2817", "2818", "2821", "2827"])

    def test_line_k1_serves_migeum_and_bokjeong_inside_its_covered_stretch(self):
        # Arrange
        line = line_of("K1")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("KR-K1-K217", "KR-K1-K222", "KR-K1-K230", "KR-K1-K231"))
        self.assertEqual(codes, ["KR-K1-K%d" % n for n in range(210, 238)])

    def test_line_d1_serves_migeum_inside_its_covered_stretch(self):
        # Arrange
        line = line_of("D1")

        # Act
        codes = convert.station_codes(line)

        # Assert
        self.assertEqual(line["served"], ("DX-D1-4307", "DX-D1-4308", "DX-D1-4312", "DX-D1-D13", "DX-D1-4318"))
        self.assertIn("DX-D1-D13", codes)

    def test_every_served_platform_is_a_covered_station_of_its_line(self):
        # Act
        uncovered = [(line["line"], code) for line in convert.LINES for code in line["served"] if code not in convert.station_codes(line)]

        # Assert
        self.assertEqual(uncovered, [])


class SavedSeoulRows(unittest.TestCase):
    """A Seoul answer saved under --seoul-rows is read back instead of called again; one not saved is fetched and saved."""

    ROW = {"LINE_NUM": "04호선", "STATION_CD": "1458", "STATION_NM": "금정", "TRAIN_NO": "K4302", "ARRIVETIME": "05:18:00", "LEFTTIME": "05:18:30", "SUBWAYENAME": "불암산", "EXPRESS_YN": "G", "WEEK_TAG": "1", "INOUT_TAG": "1"}

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = scratch.name
        self.calls = []

    def fetch(self, code, week, inout):
        self.calls.append((code, week, inout))
        return [dict(self.ROW)]

    def test_fetches_an_unsaved_answer_once_and_saves_only_the_fields_read(self):
        # Arrange
        read = convert.saved_fetch(self.directory, self.fetch, "2026-10-25")

        # Act
        first = read("1458", "1", "1")
        again = convert.saved_fetch(self.directory, self.fetch, "2026-10-26")("1458", "1", "1")

        # Assert
        self.assertEqual(self.calls, [("1458", "1", "1")])
        self.assertEqual(first, [self.ROW])
        self.assertEqual(again, [{key: self.ROW[key] for key in convert.SEOUL_ROW_FIELDS}])
        with open(os.path.join(self.directory, "1458.json"), encoding="utf-8") as handle:
            saved = json.load(handle)
        self.assertEqual(saved["answers"]["1-1"], {"fetchedOn": "2026-10-25", "rows": [["K4302", "05:18:00", "05:18:30", "불암산", "G"]]})

    def test_keeps_each_saved_tag_of_a_station(self):
        # Arrange
        read = convert.saved_fetch(self.directory, self.fetch, "2026-10-25")

        # Act
        read("1458", "1", "1")
        read("1458", "3", "2")

        # Assert
        with open(os.path.join(self.directory, "1458.json"), encoding="utf-8") as handle:
            self.assertEqual(sorted(json.load(handle)["answers"]), ["1-1", "3-2"])


class PulledRows(unittest.TestCase):
    """--seoul-keep-pulled rebuilds a covered station's rows from the pulled table, so only new stations are called."""

    def table(self):
        circle = {"trainNo": "2364", "direction": "up", "destination": "내선순환", "express": False, "stops": [
            {"station": "S1-2-215", "arr": None, "dep": 66300},
            {"station": "S1-2-216", "arr": 66420, "dep": 66450},
        ]}
        late = {"trainNo": "2365", "direction": "down", "destination": "신도림", "express": False, "stops": [
            {"station": "S1-2-217", "arr": 87210, "dep": 87240},
            {"station": "S1-2-216", "arr": 87330, "dep": None},
        ]}
        return convert.timetable("seoul-station-timetable", convert.SEOUL_API, "2026-10-18", "S1", "2", "weekday", ["S1-2-215", "S1-2-216", "S1-2-217"], [circle, late])

    def test_rows_rebuilt_from_a_pulled_table_join_back_into_its_trains(self):
        # Arrange
        line = line_of("2")
        table = self.table()

        # Act
        rows = convert.pulled_rows(table, line)
        trains = []
        for direction, inout in convert.SEOUL_INOUT:
            by_station = [(code, rows.get((station_cd, inout), [])) for code, station_cd in line["stations"]]
            trains += convert.seoul_trips(by_station, direction, line)

        # Assert
        self.assertEqual(convert.timetable("seoul-station-timetable", convert.SEOUL_API, "2026-10-18", "S1", "2", "weekday", table["stations"], trains), table)

    def test_gives_no_rows_for_a_station_the_pulled_table_does_not_list(self):
        # Act
        rows = convert.pulled_rows(self.table(), line_of("2"))

        # Assert
        self.assertEqual(sorted({code for code, _ in rows}), ["0215", "0216", "0217"])


class KorailDestinations(unittest.TestCase):
    def test_maps_each_abbreviation_to_the_name_the_upstreams_write(self):
        # Act
        names = {name: convert.korail_destination(name, "test") for name in ("1지청", "지하서")}

        # Assert
        self.assertEqual(names, {"1지청": "청량리", "지하서": "서울"})

    def test_keeps_a_terminus_the_xlsx_writes_in_full(self):
        # Arrange
        termini = ["광운대", "구로", "동묘앞", "서울", "병점", "서동탄", "천안", "신창", "용산", "연천"]

        # Act
        names = [convert.korail_destination(name, "test") for name in termini]

        # Assert
        self.assertEqual(names, termini)

    def test_refuses_a_name_in_neither_table_with_where(self):
        for name in ("2지청", "지하청", "청량", ""):
            with self.subTest(name=name):
                # Act
                with self.assertRaises(convert.ConvertError) as caught:
                    convert.korail_destination(name, "korail weekday train 0602")

                # Assert
                self.assertIn("korail weekday train 0602", str(caught.exception))
                self.assertIn(repr(name), str(caught.exception))


class KorailBuild(unittest.TestCase):
    def setUp(self):
        local = {name: (fraction(6, m), fraction(6, m, 30)) for name, m in zip(UP_STATIONS, range(0, 14, 2))}
        local["천안"] = (None, fraction(6, 0, 30))
        local["금정"] = (fraction(6, 12), None)
        express = {"천안": (None, fraction(7, 0)), "수원": (fraction(7, 10), fraction(7, 11)), "성균관": (fraction(7, 14), fraction(7, 14, 30)), "금정": (fraction(7, 20), None)}
        self.trains = {1: ("K602", "천안", "1지청", local), 2: ("K1912", "천안", "1지청", express), 3: ("K1902", "천안", "서울", express)}

    def build(self, trains):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        directory = scratch.name
        path = os.path.join(directory, "korail.xlsx")
        with open(path, "wb") as handle:
            handle.write(xlsx({"경부장항_평일_상": korail_sheet(UP_STATIONS, trains)}))
        with contextlib.redirect_stdout(io.StringIO()):
            convert.build_korail(directory, path, path)
        with open(os.path.join(directory, "KR-1-weekday.json"), encoding="utf-8") as handle:
            return {t["trainNo"]: t["destination"] for t in json.load(handle)["trains"]}

    def test_writes_each_train_with_the_destination_the_upstreams_write(self):
        # Act
        destinations = self.build(self.trains)

        # Assert
        self.assertEqual(destinations, {"0602": "청량리", "1902": "서울", "1912": "청량리"})

    def test_refuses_a_destination_in_neither_table_and_names_the_train(self):
        # Arrange
        trains = dict(self.trains)
        trains[1] = ("K602", "천안", "2지청", trains[1][3])

        # Act
        with self.assertRaises(convert.ConvertError) as caught:
            self.build(trains)

        # Assert
        self.assertIn("0602", str(caught.exception))
        self.assertIn("'2지청'", str(caught.exception))


class SeoulTrips(unittest.TestCase):
    @staticmethod
    def row(number, arrive, leave, destination="진접"):
        return {"TRAIN_NO": number, "ARRIVETIME": arrive, "LEFTTIME": leave, "SUBWAYENAME": destination + " ", "EXPRESS_YN": "G"}

    def test_joins_a_train_across_stations_in_travel_order(self):
        # Arrange
        rows = [
            ("S1-4-419", [self.row("4004", "05:43:00", "05:43:30")]),
            ("S1-4-420", [self.row("4004", "05:41:00", "05:41:30")]),
            ("S1-4-421", [self.row("4004", "05:38:30", "05:39:00")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual(len(trains), 1)
        self.assertEqual(trains[0]["destination"], "진접")
        self.assertEqual([s["station"] for s in trains[0]["stops"]], ["S1-4-421", "S1-4-420", "S1-4-419"])
        self.assertEqual(trains[0]["stops"][1], {"station": "S1-4-420", "arr": 20460, "dep": 20490})

    def test_a_repeated_number_splits_by_time_continuity(self):
        # Arrange
        rows = [
            ("S1-4-420", [self.row("K4302", "06:11:00", "06:11:30", "불암산"), self.row("4302", "20:11:00", "20:11:30", "불암산")]),
            ("S1-4-419", [self.row("4302", "20:13:00", "20:13:30", "불암산"), self.row("K4302", "06:13:00", "06:13:30", "불암산")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual([[s["arr"] for s in t["stops"]] for t in trains], [[22260, 22380], [72660, 72780]])
        self.assertTrue(all(t["_split"] for t in trains))

    def test_a_later_row_past_the_hop_limit_starts_a_new_run(self):
        # Arrange
        rows = [
            ("S1-4-421", [self.row("K4302", "06:09:00", "06:09:30", "불암산")]),
            ("S1-4-420", [self.row("K4302", "06:11:00", "06:11:30", "불암산")]),
            ("S1-4-419", [self.row("4302", "20:13:00", "20:13:30", "불암산")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual([[s["station"] for s in t["stops"]] for t in trains], [["S1-4-421", "S1-4-420"], ["S1-4-419"]])

    def test_zero_sentinel_marks_an_origin(self):
        # Arrange
        rows = [("S1-4-419", [self.row("4509", "00:00:00", "05:33:30", "오이도")]), ("S1-4-420", [self.row("4509", "05:35:00", "05:35:30", "오이도")])]

        # Act
        stops = convert.seoul_trips(rows, "down")[0]["stops"]

        # Assert
        self.assertEqual(stops[0], {"station": "S1-4-419", "arr": None, "dep": 20010})

    def test_an_unknown_express_code_is_refused(self):
        # Arrange
        row = dict(self.row("4004", "05:41:00", "05:41:30"), EXPRESS_YN="X")

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "EXPRESS_YN"):
            convert.seoul_trips([("S1-4-420", [row])], "up")


def line_of(code):
    return {line["line"]: line for line in convert.LINES}[code]


K1_DOWN_STATIONS = ["모란", "이매", "서현", "수내", "정자", "미금", "오리", "죽전", "보정"]


class SuinBundang(unittest.TestCase):
    def setUp(self):
        self.line = line_of("K1")
        local = {name: (fraction(7, m), fraction(7, m, 30)) for name, m in zip(K1_DOWN_STATIONS, range(0, 18, 2))}
        local["모란"] = (None, fraction(7, 0, 30))
        local["보정"] = (fraction(7, 16), None)
        express = dict(local)
        express["보정"] = (fraction(7, 16), None)
        express["오리"] = (None, fraction(7, 12))  # a pass at a covered station
        self.trains = {1: ("K6001", "모란", "신인천", local), 2: ("K6303", "모란", "고색", express)}

    def build(self, trains):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        cells = korail_sheet(K1_DOWN_STATIONS, trains)
        with contextlib.redirect_stdout(io.StringIO()):
            convert.build_korail_line(scratch.name, self.line, "weekday", xlsx({"평일하행": cells, "휴일하행": cells}))
        with open(os.path.join(scratch.name, "KR-K1-weekday.json"), encoding="utf-8") as handle:
            return {t["trainNo"]: t for t in json.load(handle)["trains"]}

    def test_maps_the_twenty_eight_covered_short_names_from_wangsimni_to_giheung(self):
        # Arrange
        names = [
            "왕십리", "서울숲", "로데오", "강남구", "선정릉", "선릉", "한티", "도곡", "구룡역", "개포동", "대모산", "수서", "복정", "가천대",
            "태평", "모란", "야탑", "이매", "서현", "수내", "정자", "미금", "오리", "죽전", "보정", "구성", "신갈", "기흥",
        ]

        # Act
        codes = [convert.korail_code(name, "test", self.line) for name in names]

        # Assert
        self.assertEqual(codes, ["KR-K1-K%d" % n for n in range(210, 238)])

    def test_leaves_the_stations_beyond_the_covered_ones_unmapped(self):
        # Act & Assert
        self.assertEqual([convert.korail_code(name, "test", self.line) for name in ("청량리", "상갈", "신인천")], [None, None, None])

    def test_writes_the_xlsx_terminus_names_as_the_upstreams_write_them(self):
        # Act
        names = {name: convert.korail_destination(name, "test", self.line) for name in ("신인천", "신수원", "왕십리", "청량리", "죽전", "고색", "오이도")}

        # Assert
        self.assertEqual(names, {"신인천": "인천", "신수원": "수원", "왕십리": "왕십리", "청량리": "청량리", "죽전": "죽전", "고색": "고색", "오이도": "오이도"})

    def test_reads_one_day_type_s_sheets_and_writes_the_destination_the_upstreams_write(self):
        # Arrange
        trains = {1: self.trains[1]}

        # Act
        built = self.build(trains)

        # Assert
        self.assertEqual(list(built), ["6001"])
        self.assertEqual(built["6001"]["destination"], "인천")
        self.assertEqual(built["6001"]["direction"], "down")
        self.assertEqual([s["station"] for s in built["6001"]["stops"]], ["KR-K1-K225", "KR-K1-K227", "KR-K1-K228", "KR-K1-K229", "KR-K1-K230", "KR-K1-K231", "KR-K1-K232", "KR-K1-K233", "KR-K1-K234"])

    def test_refuses_an_express_that_passes_a_window_station(self):
        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "6303.*passes KR-K1-K232"):
            self.build(self.trains)

    def test_accepts_an_express_that_passes_bojeong_and_leaves_that_station_out_of_its_stops(self):
        # Arrange
        express = dict(self.trains[2][3])
        express["오리"] = (fraction(7, 12), fraction(7, 12, 30))
        express["보정"] = (None, fraction(7, 16))
        express["구성"] = (fraction(7, 18), None)
        stations = K1_DOWN_STATIONS + ["구성"]
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        cells = korail_sheet(stations, {2: ("K6303", "모란", "고색", express)})

        # Act
        with contextlib.redirect_stdout(io.StringIO()):
            convert.build_korail_line(scratch.name, self.line, "weekday", xlsx({"평일하행": cells, "휴일하행": cells}))
        with open(os.path.join(scratch.name, "KR-K1-weekday.json"), encoding="utf-8") as handle:
            built = {t["trainNo"]: t for t in json.load(handle)["trains"]}

        # Assert
        self.assertTrue(built["6303"]["express"])
        self.assertEqual([s["station"] for s in built["6303"]["stops"]][-3:], ["KR-K1-K232", "KR-K1-K233", "KR-K1-K235"])

    def test_refuses_a_pass_on_a_train_not_numbered_63xx(self):
        # Arrange
        local = dict(self.trains[1][3])
        local["보정"] = (fraction(7, 16), None)
        local["죽전"] = (None, fraction(7, 14, 30))

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "passes a station but is not numbered 63xx"):
            self.build({1: ("K6001", "모란", "신인천", local)})


class Output(unittest.TestCase):
    """The converter writes into the directory `npm run data -- pull subway-timetables` made, one file per part key."""

    TRAIN = {"trainNo": "4004", "direction": "up", "destination": "진접", "express": False, "stops": [{"station": "S1-4-420", "arr": 36000, "dep": 36030}]}

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = scratch.name

    def document(self, revision):
        return convert.timetable("seoul-station-timetable", convert.SEOUL_API, revision, "S1", "4", "weekday", ["S1-4-420"], [dict(self.TRAIN)])

    def write(self, document):
        with contextlib.redirect_stdout(io.StringIO()):
            convert.write(self.directory, line_of("4"), document)
        with open(os.path.join(self.directory, "S1-4-weekday.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def test_names_each_file_by_its_part_key(self):
        # Act
        self.write(self.document("2026-10-20"))

        # Assert
        self.assertEqual(os.listdir(self.directory), ["S1-4-weekday.json"])

    def test_keeps_the_revision_of_a_pulled_part_whose_trains_are_unchanged(self):
        # Arrange
        pulled = self.document("2026-10-16")
        with open(os.path.join(self.directory, "S1-4-weekday.json"), "w", encoding="utf-8") as handle:
            handle.write(json.dumps(pulled, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

        # Act
        written = self.write(self.document("2026-11-01"))

        # Assert
        self.assertEqual(written["source"]["revision"], "2026-10-16")

    def test_writes_the_new_revision_when_a_train_changed(self):
        # Arrange
        self.write(self.document("2026-10-16"))
        changed = self.document("2026-11-01")
        changed["trains"][0]["stops"][0]["arr"] = 36060

        # Act
        written = self.write(changed)

        # Assert
        self.assertEqual(written["source"]["revision"], "2026-11-01")

    def test_requires_the_output_directory(self):
        # Act
        with contextlib.redirect_stderr(io.StringIO()) as stderr, self.assertRaises(SystemExit) as caught:
            convert.main(["--only", "korail"])

        # Assert
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("--out", stderr.getvalue())


def pdf(objects):
    """PDF bytes from {number: dictionary bytes or (dictionary bytes, stream bytes)}, catalog first."""
    out = b"%PDF-1.5\n"
    for number, value in objects.items():
        head, stream = value if isinstance(value, tuple) else (value, None)
        out += b"%d 0 obj\n" % number + head
        if stream is not None:
            out += b"\nstream\r\n" + stream + b"\r\nendstream"
        out += b"\nendobj\n"
    return out + b"trailer\n<</Root 1 0 R>>\n%%EOF\n"


class PdfText(unittest.TestCase):
    CMAP = b"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0057> <0060> <0030>\nendbfrange\n1 beginbfchar\n<3949> <C815>\nendbfchar\n"

    def test_reads_each_shown_string_at_its_position_through_its_font(self):
        # Arrange
        content = b"BT /F1 9 Tf 1 0 0 1 405.9 449.4 Tm [(05)] TJ ET\nBT /F2 9 Tf 1 0 0 1 450 449.4 Tm [<0057>-3<00583949>] TJ 10 -2 Td /F1 9 Tf (a\\(b\\)\\101 (c)) Tj ET"
        data = pdf({
            1: b"<</Type/Catalog/Pages 2 0 R>>",
            2: b"<</Type/Pages/Kids[ 3 0 R]/Count 1>>",
            3: b"<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R/F2 5 0 R>>>>/Contents 6 0 R>>",
            4: b"<</Type/Font/Subtype/TrueType/Encoding/WinAnsiEncoding>>",
            5: b"<</Type/Font/Subtype/Type0/Encoding/Identity-H/ToUnicode 7 0 R>>",
            6: (b"<</Filter/FlateDecode/Length %d>>" % len(zlib.compress(content)), zlib.compress(content)),
            7: (b"<</Length %d>>" % len(self.CMAP), self.CMAP),
        })
        objects = convert.pdf_objects(data)

        # Act
        runs = convert.pdf_text_runs(objects, convert.pdf_pages(objects)[0])

        # Assert
        self.assertEqual(runs, [(405.9, 449.4, "05"), (450.0, 449.4, "01정"), (460.0, 447.4, "a(b)A (c)")])

    def test_reads_a_ucs2_font_and_a_page_s_resources_by_reference(self):
        # Arrange
        stream = "BT /CJK1 22 Tf 1 0 0 1 331.6 528.5 Tm (".encode() + "정".encode("utf-16-be") + b") Tj 21.9 0 Td (" + "자".encode("utf-16-be") + b") Tj ET"
        data = pdf({
            3: b"<</Type /Catalog /Pages 2 0 R>>",
            2: b"<</Type /Pages /Kids [\r\n5 0 R\r\n] /Count 1>>",
            5: b"<</Type /Page /Parent 2 0 R /Resources 8 0 R /Contents [9 0 R]>>",
            8: b"<< /Font <<\r\n/CJK1 6 0 R\r\n>> >>",
            6: b"<</Type /Font /Subtype /Type0 /BaseFont /X /Encoding /UniKS-UCS2-H>>",
            9: (b"<</Length %d>>" % len(stream), stream),
        })
        objects = convert.pdf_objects(data)

        # Act
        runs = convert.pdf_text_runs(objects, convert.pdf_pages(objects)[0])

        # Assert
        self.assertEqual(runs, [(331.6, 528.5, "정"), (353.5, 528.5, "자")])


def page_runs(rows):
    """Runs of a station page in the 평일 edition's shape, one run per cell: rows of (hour, 신사방면 text, 광교방면 text)."""
    runs = [
        (322.25, 530.2, "정자 열차시각표"),
        (23.2, 490.2, "기본계획번호 :"), (82.1, 490.2, "SBL4020"), (205.9, 489.7, "적용기간 :"), (253.9, 490.2, "2026-09-28~9999-12-31"),
        (450.8, 489.7, "운행요일 :"), (495.6, 489.7, "평일"),
        (178.0, 469.5, "신사방면"), (406.75, 469.5, "시"), (604.9, 469.5, "광교방면"),
    ]
    for index, (hour, up, down) in enumerate(rows):
        y = 449.4 - 19.4 * index
        runs += [(368.2, y, " "), (405.9, y, hour)]
        runs += [(330.3, y, up)] if up else []
        runs += [(450.9, y, down)] if down else []
    return runs


class ShinbundangPage(unittest.TestCase):
    def test_reads_each_direction_s_minutes_with_the_short_turn_mark(self):
        # Act
        page = convert.shinbundang_page(page_runs([("05", "30 39", "40 52(정자)"), ("00", "", "10")]), "test")

        # Assert
        self.assertEqual((page["title"], page["plan"], page["from"], page["days"]), ("정자", "SBL4020", "2026-09-28", "평일"))
        self.assertEqual(page["columns"], {
            "신사방면": [(5 * 3600 + 30 * 60, False), (5 * 3600 + 39 * 60, False)],
            "광교방면": [(5 * 3600 + 40 * 60, False), (5 * 3600 + 52 * 60, True), (86400 + 10 * 60, False)],
        })

    def test_reads_the_holiday_edition_s_one_glyph_runs(self):
        # Arrange
        runs = [(x, 528.5, c) for x, c in zip((331.6, 353.6, 375.5, 382.9, 404.8, 426.8, 448.7, 470.7), "정자 열차시각표")]
        runs += [(x, 485.8, c) for x, c in zip(range(30, 300, 5), "기본계획번호 :SBL4020")]
        runs += [(x, 485.8, c) for x, c in zip(range(214, 400, 5), "적용기간 :2026-09-28~9999-12-31")]
        runs += [(x, 485.8, c) for x, c in zip(range(461, 520, 5), "운행요일 :공휴일")]
        runs += [(185.3, 464.3, "신"), (195.3, 464.3, "사"), (205.3, 464.3, "방"), (215.3, 464.3, "면"), (415.7, 464.3, "시")]
        runs += [(616.2, 464.3, "광"), (626.2, 464.3, "교"), (636.2, 464.3, "방"), (646.2, 464.3, "면")]
        runs += [(x, 442.8, c) for x, c in zip((339.0, 344.5, 350.4, 353.8, 359.7), "30 40")] + [(414.7, 442.8, "0"), (420.7, 442.8, "5")]
        runs += [(x, 442.8, c) for x, c in zip((461.2, 467.1), "40")] + [(378.0, 49.6, " "), (414.7, 49.6, "0"), (420.7, 49.6, "0"), (461.0, 49.6, "  ")]

        # Act
        page = convert.shinbundang_page(runs, "test")

        # Assert
        self.assertEqual((page["title"], page["days"]), ("정자", "공휴일"))
        self.assertEqual(page["columns"], {"신사방면": [(19800, False), (20400, False)], "광교방면": [(20400, False)]})

    def test_refuses_a_cell_that_is_not_two_digit_minutes(self):
        for text in ("30 7", "30 61", "30(미금)", "30,40"):
            with self.subTest(text=text):
                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.shinbundang_page(page_runs([("05", text, "")]), "test")

    def test_refuses_hours_out_of_order(self):
        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "does not follow"):
            convert.shinbundang_page(page_runs([("06", "10", ""), ("05", "30", "")]), "test")


class ShinbundangPages(unittest.TestCase):
    def pages(self):
        return [{"title": title, "plan": "SBL4020", "from": "2026-09-28", "days": "평일", "columns": {}} for _, title in line_of("D1")["stations"]]

    def test_passes_the_sixteen_kric_names_in_route_order(self):
        # Act
        pages = convert.check_shinbundang_pages(self.pages(), "weekday")

        # Assert
        self.assertEqual([p["title"] for p in pages][:4], ["신사", "논현", "신논현", "강남"])

    def test_refuses_another_title_another_edition_or_another_day_type(self):
        for index, field, value in ((4, "title", "양재(서초구청)"), (0, "plan", "SBL4021"), (9, "from", "2026-10-01"), (15, "days", "공휴일")):
            with self.subTest(field=field):
                # Arrange
                pages = self.pages()
                pages[index] = dict(pages[index], **{field: value})

                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.check_shinbundang_pages(pages, "weekday")


class ShinbundangChain(unittest.TestCase):
    """A hand-written four-station stretch of 신분당선 (청계산입구, 판교, 정자, 미금), 광교방면 only."""

    LINE = dict(convert.LINED1, stations=(("DX-D1-4310", "청계산입구"), ("DX-D1-4311", "판교"), ("DX-D1-4312", "정자"), ("DX-D1-D13", "미금")))

    @staticmethod
    def at(hh, mm):
        return hh * 3600 + mm * 60

    def pages(self, times):
        return [{"title": title, "columns": {"광교방면": [(self.at(*t[:2]), len(t) > 2) for t in times[code]]}} for code, title in self.LINE["stations"]]

    def times(self):
        return {
            "DX-D1-4310": [(10, 0), (10, 7, "정자"), (10, 15)],
            "DX-D1-4311": [(10, 7), (10, 14, "정자"), (10, 22)],
            "DX-D1-4312": [(10, 5), (10, 11), (10, 26)],
            "DX-D1-D13": [(10, 8), (10, 14), (10, 29)],
        }

    def test_chains_runs_without_overtaking_ends_a_short_turn_at_jeongja_and_starts_one_there(self):
        # Act
        runs = convert.shinbundang_chain(self.pages(self.times()), "down", self.LINE)

        # Assert
        self.assertEqual(sorted(runs, key=lambda r: r[0][1]), [
            [("DX-D1-4310", self.at(10, 0), True), ("DX-D1-4311", self.at(10, 7), True), ("DX-D1-4312", self.at(10, 11), True), ("DX-D1-D13", self.at(10, 14), True)],
            [("DX-D1-4312", self.at(10, 5), True), ("DX-D1-D13", self.at(10, 8), True)],
            # 정자's page leaves the short turn out; it arrives one 판교-정자 segment (4 min, both runs) after 판교.
            [("DX-D1-4310", self.at(10, 7), True), ("DX-D1-4311", self.at(10, 14), True), ("DX-D1-4312", self.at(10, 18), False)],
            [("DX-D1-4310", self.at(10, 15), True), ("DX-D1-4311", self.at(10, 22), True), ("DX-D1-4312", self.at(10, 26), True), ("DX-D1-D13", self.at(10, 29), True)],
        ])

    def test_refuses_a_run_that_starts_where_no_train_enters(self):
        # Arrange
        times = self.times()
        times["DX-D1-D13"] = times["DX-D1-D13"] + [(10, 40)]

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "10:40 starts a run"):
            convert.shinbundang_chain(self.pages(times), "down", self.LINE)

    def test_refuses_a_segment_whose_times_spread_over_more_than_a_minute(self):
        # Arrange
        times = self.times()
        times["DX-D1-4311"] = [(10, 7), (10, 14, "정자"), (10, 24)]
        times["DX-D1-4312"] = [(10, 5), (10, 11), (10, 28)]
        times["DX-D1-D13"] = [(10, 8), (10, 14), (10, 31)]

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "segment DX-D1-4310-DX-D1-4311"):
            convert.shinbundang_chain(self.pages(times), "down", self.LINE)

    def test_refuses_a_short_turn_mark_on_one_station_of_a_run_only(self):
        # Arrange
        times = self.times()
        times["DX-D1-4311"] = [(10, 7), (10, 14), (10, 22)]

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "marked"):
            convert.shinbundang_chain(self.pages(times), "down", self.LINE)


class SeoulLines(unittest.TestCase):
    @staticmethod
    def row(number, arrive, leave, destination):
        return {"TRAIN_NO": number, "ARRIVETIME": arrive, "LEFTTIME": leave, "SUBWAYENAME": destination, "EXPRESS_YN": "G"}

    def test_drops_the_korail_suffix_of_a_line_3_train(self):
        # Act
        normalized = [convert.normalize_train_no(raw) for raw in ("3024K", "K3312", "3312")]

        # Assert
        self.assertEqual(normalized, ["3024", "3312", "3312"])

    def test_writes_a_line_2_circle_trip_to_seongsu_as_its_circle_and_keeps_a_real_terminus(self):
        # Arrange
        up = [("S1-2-215", [self.row("2364", "18:25:00", "18:25:30", "성수")]), ("S1-2-216", [self.row("2364", "18:27:00", "18:27:30", "성수")])]
        down = [("S1-2-217", [self.row("2365", "18:25:00", "18:25:30", "성수"), self.row("2389", "18:40:00", "18:40:30", "신도림")])]

        # Act
        trains = convert.seoul_trips(up, "up", line_of("2")) + convert.seoul_trips(down, "down", line_of("2"))

        # Assert
        self.assertEqual({t["trainNo"]: t["destination"] for t in trains}, {"2364": "내선순환", "2365": "외선순환", "2389": "신도림"})
        self.assertEqual([s["station"] for s in trains[0]["stops"]], ["S1-2-215", "S1-2-216"])

    def test_refuses_a_line_2_branch_trip(self):
        for number in ("1675", "5683"):
            with self.subTest(number=number):
                # Arrange
                rows = [("S1-2-216", [self.row(number, "18:27:00", "18:27:30", "성수")])]

                # Act & Assert
                with self.assertRaisesRegex(convert.ConvertError, "branch"):
                    convert.seoul_trips(rows, "up", line_of("2"))

    def test_keeps_seongsu_named_on_a_line_that_is_not_a_circle(self):
        # Arrange
        rows = [("S1-4-420", [self.row("4004", "05:41:00", "05:41:30", "성수")])]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual(trains[0]["destination"], "성수")


class SeoulArrivalFixes(unittest.TestCase):
    @staticmethod
    def row(arrive):
        return {"STATION_CD": "0330", "TRAIN_NO": "3305", "ARRIVETIME": arrive, "LEFTTIME": "21:08:30", "SUBWAYENAME": "오금", "EXPRESS_YN": "G"}

    def test_fills_the_one_saturday_arrival_the_api_leaves_out_mid_route(self):
        # Act
        fixed = convert.with_arrival_fixes([self.row("00:00:00")], "0330", "2", "2")

        # Assert
        self.assertEqual(fixed[0]["ARRIVETIME"], "21:08:00")

    def test_leaves_every_other_row_as_the_api_wrote_it(self):
        for args in (("0330", "3", "2"), ("0330", "2", "1"), ("0331", "2", "2")):
            with self.subTest(args=args):
                # Act
                fixed = convert.with_arrival_fixes([self.row("00:00:00")], *args)

                # Assert
                self.assertEqual(fixed[0]["ARRIVETIME"], "00:00:00")


class OneDirectionDestinations(unittest.TestCase):
    @staticmethod
    def train(number, direction, destination):
        return {"trainNo": number, "direction": direction, "destination": destination, "express": False, "stops": []}

    def test_refuses_a_destination_that_names_both_directions(self):
        for code in ("4", "3", "8", "1"):
            with self.subTest(line=code):
                # Arrange
                trains = [self.train("4004", "up", "성수"), self.train("4005", "down", "성수")]

                # Act & Assert
                with self.assertRaisesRegex(convert.ConvertError, "'성수'"):
                    convert.check_one_direction(trains, "test", line_of(code))

    def test_passes_line_2_circle_labels_and_its_declared_two_direction_terminus_only(self):
        # Arrange
        labelled = [self.train("2364", "up", "내선순환"), self.train("2365", "down", "외선순환"), self.train("2520", "up", "삼성"), self.train("2517", "down", "삼성")]
        both = labelled + [self.train("2388", "up", "신도림"), self.train("2389", "down", "신도림")]

        # Act
        convert.check_one_direction(labelled, "test", line_of("2"))

        # Assert
        with self.assertRaisesRegex(convert.ConvertError, "'신도림'"):
            convert.check_one_direction(both, "test", line_of("2"))

    def test_passes_line_1_trains_ending_at_guro_or_seoul_from_either_side(self):
        # Arrange
        trains = [self.train("0602", "up", "구로"), self.train("0603", "down", "구로"), self.train("1904", "up", "서울"), self.train("0605", "down", "서울")]

        # Act
        convert.check_one_direction(trains, "test", line_of("1"))

        # Assert
        with self.assertRaisesRegex(convert.ConvertError, "'청량리'"):
            convert.check_one_direction(trains + [self.train("0606", "up", "청량리"), self.train("0607", "down", "청량리")], "test", line_of("1"))

    def test_passes_line_4_trains_ending_at_geumjeong_or_sadang_from_either_side(self):
        # Arrange
        trains = [self.train("4706", "up", "금정"), self.train("4335", "down", "금정"), self.train("4684", "up", "사당"), self.train("4005", "down", "사당")]

        # Act
        convert.check_one_direction(trains, "test", line_of("4"))

        # Assert
        with self.assertRaisesRegex(convert.ConvertError, "'오이도'"):
            convert.check_one_direction(trains + [self.train("4004", "up", "오이도"), self.train("4005", "down", "오이도")], "test", line_of("4"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
