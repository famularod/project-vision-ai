from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HostedJob:
    job_id: str
    organization_id: str
    project_id: str
    document_id: str
    source_provider: str
    source_locator: dict[str, Any]
    source_sha256: str
    source_page_count: int | None
    source_revision: str | None
    mode: str
    claim_token: str
    retry_count: int

    @classmethod
    def from_record(cls, value: dict[str, Any]) -> "HostedJob":
        return cls(
            job_id=required_text(value, "job_id"),
            organization_id=required_text(value, "organization_id"),
            project_id=required_text(value, "project_id"),
            document_id=required_text(value, "document_id"),
            source_provider=required_text(value, "source_provider"),
            source_locator=value.get("source_locator") if isinstance(value.get("source_locator"), dict) else {},
            source_sha256=required_text(value, "source_sha256").lower(),
            source_page_count=positive_int(value.get("source_page_count")),
            source_revision=optional_text(value.get("source_revision")),
            mode=required_text(value, "mode"),
            claim_token=required_text(value, "claim_token"),
            retry_count=max(0, int(value.get("retry_count") or 0)),
        )


def required_text(value: dict[str, Any], key: str) -> str:
    result = optional_text(value.get(key))
    if not result:
        raise ValueError(f"Missing required worker field: {key}")
    return result


def optional_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def positive_int(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None
