"""Hardening ported from the owner-source indexer (2026-09-19).

Both checks came from `wip/owner-source-service-2026-09-17`, where they had been
tightened outside version control. They are the only two of the twelve diverged
modules that the owner-source work depends on, so porting them first removes the
dependency question from the larger port. See
handoff/OWNER-INDEXER-RECONCILIATION-2026-09-19.md.
"""

import unittest

from ecos_indexer.models import HostedJob, required_exact_ascii_identity
from ecos_indexer.visual_coverage import pixel_bounds_match


def record(**overrides):
    value = {
        "job_id": "job-1",
        "organization_id": "org-1",
        "project_id": "proj-1",
        "document_id": "doc-1",
        "source_provider": "google_drive",
        "source_locator": {"fileId": "abc"},
        "source_sha256": "AB" * 32,
        "source_page_count": 12,
        "source_revision": "rev-2",
        "mode": "full",
        "claim_token": "token-1",
        "retry_count": 0,
    }
    value.update(overrides)
    return value


class ExactAsciiIdentityTests(unittest.TestCase):
    def test_accepts_a_plain_identifier(self):
        self.assertEqual(
            required_exact_ascii_identity({"k": "org-1"}, "k", 500), "org-1"
        )

    def test_rejects_a_missing_or_non_string_value(self):
        for bad in (None, 5, True, [], {}, b"org-1"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    required_exact_ascii_identity({"k": bad}, "k", 500)

    def test_rejects_an_empty_or_all_space_value(self):
        for bad in ("", " ", "   "):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    required_exact_ascii_identity({"k": bad}, "k", 500)

    def test_rejects_control_characters_and_non_ascii(self):
        # Newlines and tabs would be header injection; non-ASCII would not
        # round-trip a storage path byte for byte.
        for bad in ("org\n1", "org\t1", "org\r1", "org\x001", "org€1", "orgé"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    required_exact_ascii_identity({"k": bad}, "k", 500)

    def test_enforces_the_column_bound(self):
        self.assertEqual(
            len(required_exact_ascii_identity({"k": "a" * 500}, "k", 500)), 500
        )
        with self.assertRaises(ValueError):
            required_exact_ascii_identity({"k": "a" * 501}, "k", 500)

    def test_does_not_strip_surrounding_space(self):
        # A value needing a strip is not the exact identity it claims to be.
        self.assertEqual(
            required_exact_ascii_identity({"k": " org-1 "}, "k", 500), " org-1 "
        )


class HostedJobIdentityTests(unittest.TestCase):
    def test_a_valid_record_still_parses(self):
        job = HostedJob.from_record(record())
        self.assertEqual(job.organization_id, "org-1")
        self.assertEqual(job.document_id, "doc-1")

    def test_identity_fields_reject_newlines(self):
        for key in ("organization_id", "project_id", "document_id"):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    HostedJob.from_record(record(**{key: "bad\nvalue"}))

    def test_document_id_is_bounded_at_200(self):
        HostedJob.from_record(record(document_id="d" * 200))
        with self.assertRaises(ValueError):
            HostedJob.from_record(record(document_id="d" * 201))

    def test_organization_and_project_are_bounded_at_500(self):
        HostedJob.from_record(record(organization_id="o" * 500))
        with self.assertRaises(ValueError):
            HostedJob.from_record(record(organization_id="o" * 501))


class PixelBoundsTests(unittest.TestCase):
    expected = (10, 20, 40, 60)

    def bounds(self, **overrides):
        value = {"x": 10, "y": 20, "width": 30, "height": 40}
        value.update(overrides)
        return value

    def test_matching_integer_bounds_still_match(self):
        self.assertTrue(pixel_bounds_match(self.bounds(), self.expected))

    def test_booleans_are_rejected_even_though_bool_is_an_int(self):
        # isinstance(True, int) is True, so True == 1 would otherwise slip
        # through as a coordinate.
        self.assertFalse(pixel_bounds_match(self.bounds(x=True), self.expected))
        self.assertFalse(
            pixel_bounds_match({"x": True, "y": True, "width": True, "height": True},
                               (1, 1, 2, 2))
        )

    def test_non_integer_coordinates_are_rejected(self):
        for key in ("x", "y", "width", "height"):
            for bad in (10.0, "10", None, [10]):
                with self.subTest(key=key, bad=bad):
                    self.assertFalse(
                        pixel_bounds_match(self.bounds(**{key: bad}), self.expected)
                    )

    def test_a_missing_key_is_rejected(self):
        value = self.bounds()
        del value["height"]
        self.assertFalse(pixel_bounds_match(value, self.expected))

    def test_a_non_dict_is_rejected(self):
        for bad in (None, [], "x", 5):
            with self.subTest(bad=bad):
                self.assertFalse(pixel_bounds_match(bad, self.expected))


if __name__ == "__main__":
    unittest.main()
