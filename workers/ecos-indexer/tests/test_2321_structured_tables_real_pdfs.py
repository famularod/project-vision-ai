"""Opt-in issued-PDF smoke tests for the pure structured-table boundary.

These tests intentionally do not run in the normal worker suite.  Set
``ECOS_RUN_2321_STRUCTURED_TABLE_PDF_TESTS=1`` to render and OCR the exact
SHA-pinned issued drawings.  OCR is a producer in this test only; the
``structured_tables`` module remains provider/PDF independent.
"""

import hashlib
import io
import json
import os
import re
import unittest
from pathlib import Path

import pymupdf as fitz
import pytesseract
from PIL import Image
from pytesseract import Output

from ecos_indexer.structured_tables import (
    StructuredTableInputRejected,
    detect_blocks,
    evaluate_blocks,
)
from ecos_indexer.structured_table_pipeline import (
    STRUCTURED_TABLE_FACT_SOURCE,
    analyze_page_structured_tables,
    validate_persisted_structured_table_analysis,
)


SOURCE_DIRECTORY = Path(os.getenv(
    "ECOS_2321_REGRESSION_DIRECTORY",
    str(
        Path.home()
        / "Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved"
        / "2321 approved"
    ),
))

PROJECT_ID = "exact-issued-2321-regression"
EVIDENCE_VERSION = "ecos-hosted-evidence/structured-tables-opt-in-v1"

# Bounds are test-only audit windows in normalized final-page coordinates.
# Production code receives bounds from coordinate/vector coverage producers and
# does not contain drawing- or project-specific coordinates.
BENCHMARKS = (
    {
        "filename": "03 - PLZ CORP - 2321 THIRD STREET - STRUCTURAL.pdf",
        "sha256": "db676ce857951ace78ed6dd2af0ceeafa29e1cf7664d187bd9f212fa02512840",
        "page": 2,
        "sheet": "SB-1.1",
        "schema": "slab_legend",
        "bounds": (0.68, 0.09, 0.16, 0.12),
    },
    {
        "filename": "03 - PLZ CORP - 2321 THIRD STREET - STRUCTURAL.pdf",
        "sha256": "db676ce857951ace78ed6dd2af0ceeafa29e1cf7664d187bd9f212fa02512840",
        "page": 2,
        "sheet": "SB-1.1",
        "schema": "footing_schedule",
        "bounds": (0.69, 0.235, 0.12, 0.09),
    },
    {
        "filename": "04 - PLZ CORP - 2321 THIRD STREET - MECHANICAL.pdf",
        "sha256": "b77bc0725e5cd28017dfab8c7ab1a0356898a676e941d1ca420a9dcbabc88884",
        "page": 2,
        "sheet": "MB-1.2",
        "schema": "equipment_schedule",
        "bounds": (0.61, 0.02, 0.27, 0.52),
    },
    {
        "filename": "05 - PLZ CORP - 2321 THIRD STREET - PLUMBING.pdf",
        "sha256": "b098fe54ea96aa02e8792df76c61e5825d4aafd38588fe03bea21d98c4a242b0",
        "page": 2,
        "sheet": "PB-1.2",
        "schema": "fixture_unit_totals",
        "bounds": (0.03, 0.02, 0.26, 0.24),
    },
    {
        "filename": "06 - PLZ CORP - 2321 THIRD STREET - ELECTRICAL.pdf",
        "sha256": "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77",
        "page": 11,
        "sheet": "E-2.5",
        "schema": "numbered_notes",
        "bounds": (0.74, 0.02, 0.17, 0.15),
    },
    {
        "filename": "06 - PLZ CORP - 2321 THIRD STREET - ELECTRICAL.pdf",
        "sha256": "202598b84307c1cda4a353b9aa8873b062de896dbea9f6111ecd81dbbf85cc77",
        "page": 13,
        "sheet": "E-2.7",
        "schema": "photometric_statistics",
        "bounds": (0.62, 0.91, 0.22, 0.06),
    },
    {
        "filename": "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf",
        "sha256": "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3",
        "page": 1,
        "sheet": "L-1",
        "schema": "landscape_summary",
        "bounds": (0.65, 0.70, 0.27, 0.22),
    },
    {
        "filename": "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf",
        "sha256": "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3",
        "page": 2,
        "sheet": "L-2",
        "schema": "hydrozone_summary",
        "bounds": (0.79, 0.28, 0.12, 0.07),
    },
    {
        "filename": "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf",
        "sha256": "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3",
        "page": 2,
        "sheet": "L-2",
        "schema": "water_budget",
        "bounds": (0.68, 0.39, 0.23, 0.26),
    },
    {
        "filename": "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE.pdf",
        "sha256": "1e10ba1a90422aefb7a46bf563afdca525f2c947a38beaeee579cb859f748eb3",
        "page": 4,
        "sheet": "L-4",
        "schema": "plant_material",
        "bounds": (0.65, 0.02, 0.27, 0.31),
    },
)


# These are the approved values visibly printed in the SHA-pinned issued
# drawings.  The opt-in test must prove this matrix, not merely prove that an
# empty/incomplete result is deterministic.
EXPECTED_RELATIONSHIPS = {
    ("SB-1.1", "slab_legend"): {
        ("slab_legend", "slab"): {
            "thickness": 6.0,
            "material": "concrete",
            "reinforcement": "reinforced",
        },
    },
    ("SB-1.1", "footing_schedule"): {
        ("footing_schedule", "F1"): {
            "dimensions": "5'-0\" x 5'-0\" x 18\"",
            "reinforcing": "6-#5 E.W. (T&B)",
        },
        ("footing_schedule", "F2"): {
            "dimensions": "4'-0\" x 4'-0\" x 18\"",
            "reinforcing": "5-#5 E.W. (T&B)",
        },
        ("footing_schedule", "F3"): {
            "dimensions": "3'-0\" x 3'-0\" x 18\"",
            "reinforcing": "4-#5 E.W. (T&B)",
        },
    },
    ("MB-1.2", "equipment_schedule"): {
        ("equipment_record", "EF-1"): {
            "airflow": 100,
            "service": "4 restrooms + 1 janitor closet",
        },
        ("equipment_record", "EF-2"): {
            "airflow": 630,
            "service": "3 control rooms",
        },
        ("equipment_record", "EF-3"): {
            "airflow": 630,
            "service": "2 control rooms",
        },
    },
    ("PB-1.2", "fixture_unit_totals"): {
        ("fixture_unit_total", "center"): {"totalFixtureUnits": 35},
        ("fixture_unit_total", "east"): {"totalFixtureUnits": 30},
    },
    ("E-2.5", "numbered_notes"): {
        ("numbered_note", "1"): {"busAmps": 125, "poles": 30},
        ("numbered_note", "2"): {"busAmps": 225, "poles": 42},
    },
    ("E-2.7", "photometric_statistics"): {
        ("photometric_statistics", "ALL"): {
            "avg": 2.6,
            "max": 21.1,
            "min": 0.0,
        },
    },
    ("L-1", "landscape_summary"): {
        ("landscape_metric", "landscapeArea"): {"value": 26532},
        ("landscape_metric", "irrigatedArea"): {"value": 21104},
        ("landscape_metric", "requiredTrees"): {"value": 71},
        ("landscape_metric", "providedTrees"): {"value": 78},
    },
    ("L-2", "hydrozone_summary"): {
        ("hydrozone_area", "high"): {"area": 0},
        ("hydrozone_area", "medium"): {"area": 146},
        ("hydrozone_area", "low"): {"area": 9470},
    },
    ("L-2", "water_budget"): {
        ("water_budget", "ETWU"): {"value": 87952},
        ("water_budget", "MAWA"): {"value": 147191},
    },
    ("L-4", "plant_material"): {
        ("plant_material", "Forest Pansy Redbud"): {"quantity": 6},
        ("plant_material", "Palo Verde"): {"quantity": 12},
        ("plant_material", "Lemon Scented Gum"): {"quantity": 3},
        ("plant_material", "Golden Rain Tree"): {"quantity": 9},
    },
}

NUMERIC_ROLES = {
    "thickness", "airflow", "totalFixtureUnits", "busAmps", "poles",
    "avg", "max", "min", "value", "area", "quantity",
}

# Bounded, test-only retry windows for cells that the full schedule pass cannot
# reliably read through heavy vector borders.  These values are never supplied
# as facts; each pass still OCRs the immutable issued PDF and returns exact
# page coordinates as provenance.
TARGETED_OCR_PASSES = {
    ("SB-1.1", "footing_schedule"): (
        {"bounds": (0.700, 0.290, 0.012, 0.009), "scale": 10, "psm": 10, "whitelist": "F123"},
        {"bounds": (0.701, 0.300, 0.008, 0.009), "scale": 10, "psm": 10, "whitelist": "F123"},
        {"bounds": (0.701, 0.310, 0.008, 0.009), "scale": 10, "psm": 10, "whitelist": "F123"},
        {"bounds": (0.713, 0.290, 0.040, 0.010), "scale": 4, "psm": 7},
        {"bounds": (0.713, 0.300, 0.040, 0.010), "scale": 4, "psm": 7},
        {"bounds": (0.714, 0.309, 0.011, 0.010), "scale": 5, "psm": 7},
        {"bounds": (0.725, 0.309, 0.013, 0.010), "scale": 5, "psm": 7},
        {"bounds": (0.738, 0.309, 0.013, 0.010), "scale": 5, "psm": 7},
        {"bounds": (0.751, 0.290, 0.034, 0.010), "scale": 5, "psm": 7},
        {"bounds": (0.751, 0.300, 0.034, 0.010), "scale": 5, "psm": 7},
        {"bounds": (0.751, 0.310, 0.034, 0.010), "scale": 8, "psm": 7},
    ),
    ("E-2.5", "numbered_notes"): (
        {"bounds": (0.74, 0.02, 0.17, 0.15), "scale": 3, "psm": 6},
        {"bounds": (0.768, 0.082, 0.020, 0.056), "scale": 3, "psm": 6},
    ),
    ("E-2.7", "photometric_statistics"): (
        {"bounds": (0.62, 0.91, 0.22, 0.06), "scale": 2, "psm": 11},
    ),
    ("L-2", "water_budget"): (
        {"bounds": (0.68, 0.39, 0.23, 0.26), "scale": 3, "psm": 6},
    ),
    ("L-4", "plant_material"): (
        {"bounds": (0.65, 0.02, 0.27, 0.31), "scale": 3, "psm": 6},
    ),
}


RUN_EXACT = os.getenv("ECOS_RUN_2321_STRUCTURED_TABLE_PDF_TESTS") == "1"
SOURCES_PRESENT = all((SOURCE_DIRECTORY / item["filename"]).exists() for item in BENCHMARKS)


@unittest.skipUnless(
    RUN_EXACT and SOURCES_PRESENT,
    "Set ECOS_RUN_2321_STRUCTURED_TABLE_PDF_TESTS=1 with exact issued 2321 PDFs to run.",
)
class Exact2321StructuredTableBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payloads = {}
        for benchmark in BENCHMARKS:
            filename = benchmark["filename"]
            if filename in cls.payloads:
                continue
            payload = (SOURCE_DIRECTORY / filename).read_bytes()
            expected = benchmark["sha256"]
            actual = hashlib.sha256(payload).hexdigest()
            if actual != expected:
                raise AssertionError(f"Issued 2321 source changed: {filename}: {actual}")
            cls.payloads[filename] = payload

    def test_exact_rendered_windows_remain_coordinate_bound_and_deterministic(self):
        for benchmark in BENCHMARKS:
            with self.subTest(sheet=benchmark["sheet"], schema=benchmark["schema"]):
                words = self._ocr_words(benchmark)
                self.assertTrue(words, f"No OCR words in {benchmark['sheet']} {benchmark['schema']}")
                identity = self._identity(benchmark)
                hint = {"schema": benchmark["schema"], "bounds": self._bounds(benchmark)}
                blocks = detect_blocks(identity, words, block_hints=[hint])
                result = evaluate_blocks(identity, blocks, words)
                reversed_blocks = detect_blocks(identity, list(reversed(words)), block_hints=[hint])
                reversed_result = evaluate_blocks(identity, reversed_blocks, list(reversed(words)))
                self.assertEqual(
                    json.dumps(result, sort_keys=True),
                    json.dumps(reversed_result, sort_keys=True),
                )
                self.assertEqual(result["pageIdentity"]["projectId"], PROJECT_ID)
                self.assertEqual(result["pageIdentity"]["sourceSha256"], benchmark["sha256"])
                source_ids = {word["id"] for word in words}
                for relationship in result["relationships"]:
                    self.assertEqual(relationship["projectId"], PROJECT_ID)
                    self.assertEqual(relationship["sourceSha256"], benchmark["sha256"])
                    self.assertIn(relationship["status"], {"complete", "incomplete", "conflicted"})
                    self.assertTrue(
                        set(item["id"] for item in relationship["constituents"]).issubset(source_ids),
                    )
                    if relationship["status"] == "complete":
                        self.assertFalse(relationship["missingRoles"])
                        self.assertFalse(relationship["conflictCodes"])
                self._assert_expected_relationships(benchmark, result)
                self._assert_production_round_trip(benchmark, words)

    def _assert_production_round_trip(self, benchmark, words):
        bounds = self._bounds(benchmark)
        facts, analysis, _unresolved = analyze_page_structured_tables(
            project_id=PROJECT_ID,
            source_sha256=benchmark["sha256"],
            page_number=benchmark["page"],
            evidence_version=EVIDENCE_VERSION,
            sheet_number=benchmark["sheet"],
            regions=words,
            block_hints=[{"schema": benchmark["schema"], "bounds": bounds}],
        )
        self.assertIsNotNone(analysis)
        assert analysis is not None
        expected_keys = set(EXPECTED_RELATIONSHIPS[
            (benchmark["sheet"], benchmark["schema"])
        ])
        actual_keys = {
            (
                fact["structuredTableRelationshipType"],
                fact["structuredTableRowKey"],
            )
            for fact in facts
        }
        self.assertEqual(actual_keys, expected_keys)
        self.assertTrue(all(
            fact["source"] == STRUCTURED_TABLE_FACT_SOURCE
            for fact in facts
        ))
        claimed_ids = {
            str(region_id)
            for block in analysis["blocks"]
            for region_id in block["regionIds"]
        }
        persisted = [
            ({**region, "searchable": False} if region["id"] in claimed_ids else region)
            for region in [*words, *facts]
        ]
        self.assertEqual(
            validate_persisted_structured_table_analysis(
                analysis,
                regions=persisted,
                expected_project_id=PROJECT_ID,
                expected_page_number=benchmark["page"],
                expected_source_sha256=benchmark["sha256"],
                expected_evidence_version=EVIDENCE_VERSION,
                expected_sheet_number=benchmark["sheet"],
            ),
            [],
        )

    def _assert_expected_relationships(self, benchmark, result):
        expected = EXPECTED_RELATIONSHIPS[(benchmark["sheet"], benchmark["schema"])]
        observed = {
            (relationship["type"], relationship["rowKey"]): relationship
            for relationship in result["relationships"]
            if relationship["status"] == "complete"
        }
        self.assertEqual(
            set(observed),
            set(expected),
            (
                f"{benchmark['sheet']} {benchmark['schema']} emitted an "
                "unexpected complete relationship or omitted an approved one"
            ),
        )
        for relationship_key, expected_roles in expected.items():
            with self.subTest(
                sheet=benchmark["sheet"],
                schema=benchmark["schema"],
                relationship=relationship_key,
            ):
                self.assertIn(relationship_key, observed)
                relationship = observed[relationship_key]
                for role, expected_value in expected_roles.items():
                    self.assertIn(role, relationship["roles"])
                    role_value = relationship["roles"][role]
                    self.assertEqual(role_value["state"], "complete")
                    self.assertEqual(role_value["value"], expected_value)
                    self.assertTrue(role_value["constituentIds"])
                    if role in NUMERIC_ROLES:
                        self.assertTrue(
                            any(
                                re.search(r"\d", constituent["text"])
                                for constituent in role_value["constituents"]
                            ),
                            f"{relationship_key} {role} lacks numeric source evidence",
                        )

        all_relationships = {
            (relationship["type"], relationship["rowKey"]): relationship
            for relationship in result["relationships"]
        }
        if benchmark["schema"] == "slab_legend":
            self.assertFalse(any(
                role.get("value") == 1.0
                for relationship in result["relationships"]
                for role in relationship.get("roles", {}).values()
                if isinstance(role, dict)
            ))
        if benchmark["schema"] == "numbered_notes":
            self.assertNotIn(("numbered_note", "562"), all_relationships)
        if benchmark["schema"] == "fixture_unit_totals":
            self.assertEqual(len(result["derivations"]), 1)
            derivation = result["derivations"][0]
            self.assertEqual(derivation["type"], "fixture_unit_total_sum")
            self.assertEqual(derivation["operator"], "sum")
            self.assertEqual(derivation["value"], 65)
            self.assertEqual(
                derivation["classification"],
                "deterministic_derivation_not_visible_drawing_fact",
            )
        if benchmark["schema"] == "photometric_statistics":
            self.assertEqual(observed[("photometric_statistics", "ALL")]["status"], "complete")

    def test_same_exact_page_cannot_be_replayed_as_2375(self):
        benchmark = BENCHMARKS[0]
        words = self._ocr_words(benchmark)
        identity_2321 = self._identity(benchmark)
        identity_2375 = {**identity_2321, "projectId": "exact-issued-2375-regression"}
        hint = {"schema": benchmark["schema"], "bounds": self._bounds(benchmark)}
        result_2321 = evaluate_blocks(
            identity_2321,
            detect_blocks(identity_2321, words, block_hints=[hint]),
            words,
        )
        self.assertEqual(result_2321["pageIdentity"]["projectId"], PROJECT_ID)
        with self.assertRaisesRegex(StructuredTableInputRejected, "region_project_mismatch"):
            detect_blocks(identity_2375, words, block_hints=[hint])

    @staticmethod
    def _bounds(benchmark):
        x, y, width, height = benchmark["bounds"]
        return {"x": x, "y": y, "width": width, "height": height}

    @staticmethod
    def _identity(benchmark):
        return {
            "projectId": PROJECT_ID,
            "sourceSha256": benchmark["sha256"],
            "pageNumber": benchmark["page"],
            "evidenceVersion": EVIDENCE_VERSION,
            "sheetNumber": benchmark["sheet"],
        }

    @classmethod
    def _ocr_words(cls, benchmark):
        document = fitz.open(stream=cls.payloads[benchmark["filename"]], filetype="pdf")
        try:
            page = document[benchmark["page"] - 1]
            passes = ({
                "bounds": benchmark["bounds"],
                "scale": 3,
                "psm": 11,
            }, *TARGETED_OCR_PASSES.get(
                (benchmark["sheet"], benchmark["schema"]),
                (),
            ))
            words_by_pass = []
            for pass_index, pass_spec in enumerate(passes):
                words_by_pass.append(
                    cls._ocr_pass(page, benchmark, pass_spec, pass_index),
                )
        finally:
            document.close()
        if len(words_by_pass) == 1:
            return words_by_pass[0]
        retry_bounds = [item["bounds"] for item in passes[1:]]
        base_words = [
            word for word in words_by_pass[0]
            if not any(cls._center_in_tuple_bounds(word, bounds) for bounds in retry_bounds)
        ]
        retry_words = [
            word
            for retry_words in words_by_pass[1:]
            for word in retry_words
        ]
        return [*base_words, *retry_words]

    @staticmethod
    def _center_in_tuple_bounds(word, bounds):
        x, y, width, height = bounds
        center_x = float(word["x"]) + float(word["width"]) / 2
        center_y = float(word["y"]) + float(word["height"]) / 2
        return x <= center_x <= x + width and y <= center_y <= y + height

    @staticmethod
    def _ocr_pass(page, benchmark, pass_spec, pass_index):
        page_width = float(page.rect.width)
        page_height = float(page.rect.height)
        x, y, width, height = pass_spec["bounds"]
        clip = fitz.Rect(
            x * page_width,
            y * page_height,
            (x + width) * page_width,
            (y + height) * page_height,
        )
        scale = int(pass_spec.get("scale") or 3)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
        image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
        config = f"--oem 1 --psm {int(pass_spec.get('psm') or 11)}"
        whitelist = str(pass_spec.get("whitelist") or "").strip()
        if whitelist:
            config += f" -c tessedit_char_whitelist={whitelist}"
        data = pytesseract.image_to_data(
            image,
            output_type=Output.DICT,
            config=config,
        )
        words = []
        for index, text in enumerate(data.get("text") or []):
            cleaned = str(text or "").strip()
            if not cleaned:
                continue
            try:
                confidence = max(0.0, float(data["conf"][index]) / 100.0)
            except (KeyError, TypeError, ValueError):
                confidence = 0.0
            left = float(data["left"][index]) / image.width
            top = float(data["top"][index]) / image.height
            word_width = max(1.0, float(data["width"][index])) / image.width
            word_height = max(1.0, float(data["height"][index])) / image.height
            words.append({
                "id": (
                    f"{benchmark['sheet']}-{benchmark['schema']}"
                    f"-ocr-pass-{pass_index}-{index}"
                ),
                "text": cleaned,
                "x": round(x + left * width, 6),
                "y": round(y + top * height, 6),
                "width": round(word_width * width, 6),
                "height": round(word_height * height, 6),
                "confidence": confidence,
                "source": (
                    "opt_in_exact_pdf_coordinate_ocr"
                    if pass_index == 0
                    else "opt_in_exact_pdf_targeted_coordinate_ocr"
                ),
                "projectId": PROJECT_ID,
                "sourceSha256": benchmark["sha256"],
                "pageNumber": benchmark["page"],
                "evidenceVersion": EVIDENCE_VERSION,
            })
        return words


if __name__ == "__main__":
    unittest.main()
