import copy
import unittest

from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS,
    quarantine_exact_architectural_2321_page18_visual_authority,
    unresolved_regions,
)


SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"


def raw_region(spec: dict[str, object]) -> dict[str, object]:
    region_id = str(spec["id"])
    block, paragraph, line = tuple(spec["lineage"])
    separator = "-line-" if spec.get("kind") == "line" else "-word-"
    return {
        "id": region_id,
        "text": spec["text"],
        **dict(spec["bounds"]),
        "confidence": spec["confidence"],
        "source": spec.get("source") or "fixed_visual_tile_coordinate_ocr",
        "searchable": False,
        "ocrKind": spec.get("kind") or "word",
        "ocrPrefix": region_id.rsplit(separator, 1)[0],
        "ocrBlockNumber": block,
        "ocrParagraphNumber": paragraph,
        "ocrLineNumber": line,
        "ocrValidationStatus": "unresolved_low_confidence",
    }


class Architectural2321Page18CandidateTests(unittest.TestCase):
    def inputs(self) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        low = [
            raw_region(spec)
            for spec in EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS
        ]
        raw_by_id = {
            str(region["id"]): copy.deepcopy(region) for region in low
        }
        for spec in EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS:
            for context in spec["context"]:
                region = raw_region(context)
                raw_by_id.setdefault(str(region["id"]), region)
        return low, list(raw_by_id.values())

    def quarantine(
        self,
        low: list[dict[str, object]],
        raw: list[dict[str, object]],
        **updates: object,
    ) -> list[dict[str, object]]:
        arguments: dict[str, object] = {
            "raw_regions": raw,
            "project_id": PROJECT_ID,
            "page_number": 18,
            "source_sha256": SOURCE_SHA256,
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return quarantine_exact_architectural_2321_page18_visual_authority(
            low, **arguments,
        )

    def test_only_exact_title_and_scale_artifacts_lose_visual_authority(self) -> None:
        low, raw = self.inputs()
        original_low = copy.deepcopy(low)
        original_raw = copy.deepcopy(raw)
        result = self.quarantine(low, raw)

        self.assertEqual(11, len(result))
        self.assertEqual(
            [
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_scale_legend",
                "quarantined_scale_legend",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_exact_drawing_title_identifier",
                "quarantined_scale_legend",
            ],
            [str(region["visualAuthorityStatus"]) for region in result],
        )
        self.assertTrue(all(region["searchable"] is False for region in result))
        self.assertEqual(original_low, low)
        self.assertEqual(original_raw, raw)

        unresolved = unresolved_regions(
            [{
                "id": "trusted-text", "text": "CANOPY DETAIL " * 20,
                "x": 0.2, "y": 0.2, "width": 0.1, "height": 0.01,
                "searchable": True,
            }],
            {"sheetMappingStatus": "verified"},
            native_character_count=5000,
            ocr_attempted=True,
            low_confidence_regions=result,
        )
        self.assertEqual([], unresolved)

    def test_binding_or_exact_evidence_drift_stays_fail_closed(self) -> None:
        low, raw = self.inputs()
        for key, value in {
            "project_id": "other-project",
            "page_number": 17,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }.items():
            with self.subTest(binding=key):
                self.assertEqual(low, self.quarantine(low, raw, **{key: value}))

        first = EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS[0]
        target_id = str(first["id"])
        for name, update in (
            ("text", {"text": "1'-0\""}),
            ("bounds", {"x": 0.07016}),
            ("bool-confidence", {"confidence": False}),
            ("string-confidence", {"confidence": "0.0"}),
            ("negative-confidence", {"confidence": -0.01}),
            ("oversized-confidence", {"confidence": 1.01}),
            ("nan-confidence", {"confidence": float("nan")}),
            ("source", {"source": "other"}),
            ("kind", {"ocrKind": "line"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
            ("bool-lineage", {"ocrBlockNumber": True}),
        ):
            with self.subTest(target=name):
                drifted_raw = [
                    {**region, **update}
                    if str(region.get("id") or "") == target_id else region
                    for region in raw
                ]
                result = self.quarantine(low, drifted_raw)
                target = next(region for region in result if region["id"] == target_id)
                self.assertNotIn("visualAuthorityStatus", target)

        context_id = str(first["context"][0]["id"])
        drifted_context = [
            {**region, "text": "WALL 1 CURB DETAIL"}
            if str(region.get("id") or "") == context_id else region
            for region in raw
        ]
        result = self.quarantine(low, drifted_context)
        target = next(region for region in result if region["id"] == target_id)
        self.assertNotIn("visualAuthorityStatus", target)

    def test_valid_confidence_drift_does_not_change_exact_artifact_identity(self) -> None:
        low, raw = self.inputs()
        first = EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS[0]
        target_id = str(first["id"])
        context_id = str(first["context"][0]["id"])
        drifted_low = [
            {**region, "confidence": 0.34}
            if str(region.get("id") or "") == target_id else region
            for region in low
        ]
        drifted_raw = [
            {
                **region,
                "confidence": (
                    0.34 if str(region.get("id") or "") == target_id else 0.87
                ),
            }
            if str(region.get("id") or "") in {target_id, context_id}
            else region
            for region in raw
        ]

        result = self.quarantine(drifted_low, drifted_raw)
        target = next(region for region in result if region["id"] == target_id)
        self.assertEqual(
            "quarantined_exact_drawing_title_identifier",
            target["visualAuthorityStatus"],
        )

        duplicated = [*raw, next(
            copy.deepcopy(region) for region in raw if region["id"] == target_id
        )]
        result = self.quarantine(low, duplicated)
        target = next(region for region in result if region["id"] == target_id)
        self.assertNotIn("visualAuthorityStatus", target)

    def test_unrelated_standalone_measurements_and_identifiers_remain_authoritative(self) -> None:
        low, raw = self.inputs()
        scale_spec = next(
            spec for spec in EXACT_ARCHITECTURAL_2321_PAGE18_VISUAL_AUTHORITY_SPECS
            if spec["authorityStatus"] == "quarantined_scale_legend"
        )
        standalone = {
            **raw_region(scale_spec),
            "id": "standalone-measurement",
            "text": "1'-0\"",
            "x": 0.62,
            "y": 0.42,
            "width": 0.02,
            "height": 0.006,
            "confidence": 0.2,
            "ocrPrefix": "other-pass",
            "ocrBlockNumber": 30,
        }
        identifier = {
            **standalone,
            "id": "standalone-identifier",
            "text": "'1'",
            "x": 0.71,
            "ocrBlockNumber": 31,
        }
        result = self.quarantine([*low, standalone, identifier], raw)
        by_id = {str(region["id"]): region for region in result}
        self.assertNotIn("visualAuthorityStatus", by_id["standalone-measurement"])
        self.assertNotIn("visualAuthorityStatus", by_id["standalone-identifier"])

    def test_exact_revision_delta_number_is_audited_not_searchable(self) -> None:
        spec = EXACT_ARCHITECTURAL_2321_PAGE18_TITLE_BLOCK_AUTHORITY_SPECS[0]
        target = raw_region(spec)
        target["searchable"] = True
        raw = [copy.deepcopy(target)]
        for context in spec["context"]:
            raw.append(raw_region(context))

        result = self.quarantine([target], raw)
        self.assertEqual(1, len(result))
        self.assertFalse(result[0]["searchable"])
        self.assertEqual(
            "quarantined_exact_drawing_title_identifier",
            result[0]["visualAuthorityStatus"],
        )

        for name, update in (
            ("text", {"text": "2"}),
            ("bounds", {"x": 0.952981}),
            ("source", {"source": "fixed_visual_tile_coordinate_ocr"}),
            ("lineage", {"ocrBlockNumber": 9}),
        ):
            with self.subTest(drift=name):
                drifted = [
                    {**region, **update}
                    if region["id"] == spec["id"] else region
                    for region in raw
                ]
                candidate = self.quarantine([target], drifted)[0]
                self.assertTrue(candidate["searchable"])
                self.assertNotIn("visualAuthorityStatus", candidate)


if __name__ == "__main__":
    unittest.main()
