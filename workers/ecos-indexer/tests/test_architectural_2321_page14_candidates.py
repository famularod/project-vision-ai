import unittest

from ecos_indexer.extraction import (
    EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE,
    EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS,
    EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC,
    reconstruct_exact_architectural_2321_page14_candidates,
    unresolved_regions,
)


SOURCE_SHA256 = "5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb"
PROJECT_ID = "607c7eed-5dea-4a5a-8b52-0f165c71c4b5"


def raw_region(
    spec: dict[str, object],
    *,
    lineage: tuple[int, int, int] | None = None,
    confidence: float = 0.0,
) -> dict[str, object]:
    region_id = str(spec["id"])
    block, paragraph, line = lineage or tuple(spec["lineage"])
    return {
        "id": region_id,
        "text": spec["text"],
        **dict(spec["bounds"]),
        "source": "fixed_visual_tile_coordinate_ocr",
        "confidence": confidence,
        "searchable": confidence >= 0.35,
        "ocrKind": "word",
        "ocrPrefix": region_id.split("-word-", 1)[0],
        "ocrBlockNumber": block,
        "ocrParagraphNumber": paragraph,
        "ocrLineNumber": line,
    }


class Architectural2321Page14CandidateTests(unittest.TestCase):
    def inputs(self) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        raw: list[dict[str, object]] = []
        low: list[dict[str, object]] = []
        for candidate_index, candidate in enumerate(
            EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS
        ):
            for constituent_index, constituent in enumerate(candidate["constituents"]):
                region = raw_region(constituent)
                raw.append(region)
                if constituent_index == 0:
                    low.append(dict(region))

        title = EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC
        title_region = raw_region(title, confidence=0.22)
        raw.append(title_region)
        low.append(dict(title_region))
        for context in title["context"]:
            raw.append(raw_region(
                context,
                lineage=tuple(title["lineage"]),
                confidence=0.95,
            ))
        return low, raw

    def reconstruct(
        self,
        low: list[dict[str, object]],
        raw: list[dict[str, object]],
        **updates: object,
    ) -> list[dict[str, object]]:
        arguments: dict[str, object] = {
            "raw_regions": raw,
            "project_id": PROJECT_ID,
            "page_number": 14,
            "source_sha256": SOURCE_SHA256,
            "evidence_version": "ecos-hosted-evidence/1.3",
        }
        arguments.update(updates)
        return reconstruct_exact_architectural_2321_page14_candidates(
            low, **arguments,
        )

    def test_complete_dimensions_replace_only_malformed_page14_authorities(self) -> None:
        low, raw = self.inputs()
        result = self.reconstruct(low, raw)
        composites = [
            region for region in result
            if region.get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
        ]
        self.assertEqual(2, len(composites))
        self.assertEqual(
            ["80'-0\"", "80'-0\""],
            [str(region["text"]) for region in composites],
        )
        self.assertEqual(
            [spec["bounds"] for spec in EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS],
            [
                {key: region[key] for key in ("x", "y", "width", "height")}
                for region in composites
            ],
        )
        self.assertTrue(all(region["searchable"] is False for region in composites))

        superseded = [
            region for region in result
            if region.get("visualAuthorityStatus")
            == "superseded_by_exact_rendered_page14_dimension_composite"
        ]
        self.assertEqual(3, len(superseded))
        self.assertTrue(all(region["searchable"] is False for region in superseded))

        title = next(
            region for region in result
            if region.get("id")
            == EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC["id"]
        )
        self.assertEqual(
            "quarantined_exact_drawing_title_identifier",
            title["visualAuthorityStatus"],
        )
        unresolved = unresolved_regions(
            [],
            {"sheetMappingStatus": "verified"},
            native_character_count=500,
            ocr_attempted=True,
            low_confidence_regions=result,
        )
        dimension_unresolved = [
            item for item in unresolved
            if len(item.get("diagnosticCandidates") or []) == 1
            and item["diagnosticCandidates"][0].get("source")
            == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SOURCE
        ]
        self.assertEqual(2, len(dimension_unresolved))
        self.assertTrue(all(
            item["diagnosticCandidates"][0]["text"] == "80'-0\""
            for item in dimension_unresolved
        ))
        self.assertFalse(any(
            candidate["text"] in {"80’", "80'-2'", "‘1’"}
            for item in unresolved
            for candidate in item.get("diagnosticCandidates") or []
        ))

    def test_page14_reconstruction_fails_closed_on_binding_or_evidence_drift(self) -> None:
        low, raw = self.inputs()
        for key, value in {
            "project_id": "other-project",
            "page_number": 13,
            "source_sha256": "0" * 64,
            "evidence_version": "ecos-hosted-evidence/1.2",
        }.items():
            with self.subTest(binding=key):
                self.assertEqual(low, self.reconstruct(low, raw, **{key: value}))

        first = EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS[0]["constituents"][0]
        target_id = str(first["id"])
        for name, update in (
            ("text", {"text": "80'-0\""}),
            ("bounds", {"x": 0.628731}),
            ("source", {"source": "other"}),
            ("kind", {"ocrKind": "line"}),
            ("pass", {"ocrPrefix": "other-pass"}),
            ("lineage", {"ocrBlockNumber": 99}),
        ):
            with self.subTest(constituent=name):
                drifted = [
                    {**region, **update}
                    if str(region.get("id") or "") == target_id
                    else region
                    for region in raw
                ]
                result = self.reconstruct(low, drifted)
                self.assertFalse(any(
                    region.get("id")
                    == EXACT_ARCHITECTURAL_2321_PAGE14_DIMENSION_SPECS[0]["id"]
                    for region in result
                ))

        title = EXACT_ARCHITECTURAL_2321_PAGE14_TITLE_IDENTIFIER_SPEC
        context_id = str(title["context"][0]["id"])
        drifted = [
            {**region, "text": "WALL"}
            if str(region.get("id") or "") == context_id else region
            for region in raw
        ]
        result = self.reconstruct(low, drifted)
        title_result = next(
            region for region in result
            if region.get("id") == title["id"]
        )
        self.assertNotIn("visualAuthorityStatus", title_result)


if __name__ == "__main__":
    unittest.main()
