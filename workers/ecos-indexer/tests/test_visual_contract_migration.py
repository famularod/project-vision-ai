from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_MIGRATION = REPOSITORY_ROOT / "supabase" / "migrations" / (
    "20260809014604_ecos_hosted_visual_exception_contract_v2.sql"
)
RESET_MIGRATION = REPOSITORY_ROOT / "supabase" / "migrations" / (
    "20260808102000_ecos_hosted_evidence_v13_reset.sql"
)
EDGE_FUNCTION = REPOSITORY_ROOT / "supabase" / "functions" / (
    "ecos-analyze-drawing-page/index.ts"
)


class VisualContractMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = CONTRACT_MIGRATION.read_text(encoding="utf-8")
        cls.reset = RESET_MIGRATION.read_text(encoding="utf-8")
        cls.edge = EDGE_FUNCTION.read_text(encoding="utf-8")

    def test_initial_resolution_is_an_atomic_insert_or_update(self) -> None:
        resolve_body = self.contract.split(
            "create or replace function public.ecos_resolve_hosted_visual_exception_v2", 1,
        )[1].split("$$;", 1)[0]
        self.assertIn("insert into public.ecos_hosted_visual_exceptions", resolve_body)
        self.assertIn("on conflict (job_id, page_number, region_key) do update", resolve_body)
        self.assertIn("get diagnostics affected_rows = row_count", resolve_body)
        self.assertIn("return affected_rows = 1", resolve_body)

    def test_contract_is_versioned_fingerprinted_assured_and_service_only(self) -> None:
        for required in (
            "evidence_version text",
            "exception_fingerprint text",
            "ecos-drawing-page-analysis/2.0",
            "corroboratedCandidateIndexes",
            "assuranceProvider",
            "providerBounds",
            "coalesce(auth.jwt()->>'role', '') <> 'service_role'",
            "force row level security",
            "grant execute on function public.ecos_resolve_hosted_visual_exception_v2",
        ):
            self.assertIn(required, self.contract)

    def test_database_requires_provider_proof_inside_the_exception_crop(self) -> None:
        for required in (
            "fact_x < exception_x - 0.001",
            "fact_y < exception_y - 0.001",
            "fact_x + fact_width > exception_x + exception_width + 0.001",
            "fact_y + fact_height > exception_y + exception_height + 0.001",
        ):
            self.assertIn(required, self.contract)
        self.assertNotIn("fact_x + fact_width < exception_x", self.contract)
        for required in (
            "intersection_width := greatest(",
            "intersection_height := greatest(",
            "intersection_area := intersection_width * intersection_height",
            "smaller_area := least(",
            "intersection_area < smaller_area * 0.5",
            "does not materially overlap the exact exception bounds",
        ):
            self.assertIn(required, self.contract)

    def test_unversioned_mutation_and_reservation_paths_are_revoked(self) -> None:
        for function_name in (
            "ecos_upsert_hosted_visual_exception(",
            "ecos_resolve_hosted_visual_exception(",
            "ecos_reserve_hosted_visual_region(",
            "ecos_reserve_hosted_visual_region_versioned(",
        ):
            revoke = self.contract.split(f"revoke all on function public.{function_name}", 1)[1]
            self.assertIn("service_role", revoke.split(";", 1)[0])

    def test_exact_reservation_rejects_expired_worker_lease(self) -> None:
        reserve_body = self.contract.split(
            "create or replace function public.ecos_reserve_hosted_visual_region_v2", 1,
        )[1].split("$$;", 1)[0]
        self.assertIn("job.lease_expires_at >= now()", reserve_body)
        self.assertIn("normalized_fingerprint", reserve_body)
        self.assertIn("return affected_rows = 1", reserve_body)
        self.assertIn(
            "grant execute on function public.ecos_reserve_hosted_visual_region_v2",
            self.contract,
        )

    def test_reset_rejects_every_unexpired_worker_lease(self) -> None:
        self.assertIn("selected_job.lease_expires_at >= now()", self.reset)
        self.assertNotIn("now() - interval '5 minutes'", self.reset)

    def test_materializer_and_ready_guard_require_durable_chunks(self) -> None:
        self.assertIn("Accepted shadow page produced no durable search chunks", self.contract)
        self.assertIn("An accepted shadow page has no durable search chunks", self.contract)
        self.assertIn("page.assurance_result->>'accepted' = 'true'", self.contract)
        self.assertIn("not exists (", self.contract)
        self.assertIn("from public.ecos_hosted_shadow_chunks chunk", self.contract)

    def test_edge_provider_receives_bounded_candidate_contract(self) -> None:
        self.assertIn("type NormalizedVisualException", self.edge)
        self.assertIn("diagnosticCandidates", self.edge)
        self.assertIn("visualException,", self.edge)
        self.assertIn("bounded OCR-exception verification", self.edge)
        self.assertIn("generic fact from the crop", self.edge)


if __name__ == "__main__":
    unittest.main()
