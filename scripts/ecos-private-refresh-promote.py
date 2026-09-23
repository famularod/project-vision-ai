"""Preview or promote one already verified private shadow page refresh.

No credentials, source text, or embeddings are saved or printed. Promotion is
explicit and uses the existing bounded embedding bridge and atomic page RPC.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import requests

PROJECT = "vitruvius-project-intelligence"
SUPABASE_HOST = "https://xdytqlpsqsseoeuxgzre.supabase.co"
EMBEDDING_ENDPOINT = SUPABASE_HOST + "/functions/v1/ecos-embedding-provider"

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers/ecos-indexer"))
from ecos_indexer.embeddings import OpenAIEmbeddingProvider  # noqa: E402


def secret(name: str) -> str:
    result = subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest", "--secret", name,
         "--project", PROJECT],
        check=False, capture_output=True, text=True, timeout=30,
    )
    if result.returncode or not result.stdout.strip():
        raise RuntimeError("required_private_secret_unavailable:" + name)
    return result.stdout.strip()


def rpc(url: str, service_key: str, name: str, payload: dict) -> dict:
    response = requests.post(
        url + "/rest/v1/rpc/" + name,
        headers={
            "Authorization": "Bearer " + service_key,
            "apikey": service_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=(10, 90),
        allow_redirects=False,
    )
    if response.status_code != 200:
        raise RuntimeError(name + "_http_" + str(response.status_code))
    value = response.json()
    if not isinstance(value, dict):
        raise RuntimeError(name + "_response_invalid")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh-id", required=True)
    parser.add_argument("--expected-page", required=True, type=int)
    parser.add_argument("--expected-sheet", required=True)
    parser.add_argument("--promote", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", args.refresh_id):
        raise RuntimeError("canonical_refresh_id_required")
    if args.expected_page < 1 or not re.fullmatch(r"[A-Z]-[0-9]+(?:\.[0-9]+)+", args.expected_sheet):
        raise RuntimeError("expected_page_and_sheet_required")
    url = secret("ecos-supabase-url")
    if url.rstrip("/") != SUPABASE_HOST:
        raise RuntimeError("unexpected_supabase_host")
    service_key = secret("ecos-supabase-service-role-key")
    preview = rpc(url, service_key, "ecos_switch_isolated_page_refresh", {
        "p_refresh_id": args.refresh_id,
        "p_embeddings": None,
    })
    chunks = preview.get("chunks")
    if (preview.get("published") is not False or
            preview.get("refreshId") != args.refresh_id or
            preview.get("pageNumber") != args.expected_page or
            preview.get("embeddingModel") != "text-embedding-3-small" or
            not isinstance(chunks, list) or not 1 <= len(chunks) <= 512 or
            any(not isinstance(chunk, dict) or
                chunk.get("page_number") != args.expected_page or
                chunk.get("sheet_number") != args.expected_sheet for chunk in chunks)):
        raise RuntimeError("private_preview_identity_mismatch")
    print(json.dumps({
        "refreshId": args.refresh_id,
        "pageNumber": args.expected_page,
        "sheetNumber": args.expected_sheet,
        "chunkCount": len(chunks),
        "published": False,
    }), flush=True)
    if not args.promote:
        return 0

    provider = OpenAIEmbeddingProvider()
    provider.api_key = service_key
    provider.worker_token = secret("ecos-service-worker-token")
    provider.endpoint = EMBEDDING_ENDPOINT
    provider.model = "text-embedding-3-small"
    provider.batch_size = 64
    rows = provider.build_rows(chunks)
    promoted = rpc(url, service_key, "ecos_switch_isolated_page_refresh", {
        "p_refresh_id": args.refresh_id,
        "p_embeddings": rows,
    })
    if (promoted.get("published") is not True or
            promoted.get("refreshId") != args.refresh_id or
            promoted.get("pageNumber") != args.expected_page or
            promoted.get("chunkCount") != len(rows)):
        raise RuntimeError("private_promotion_not_confirmed")
    print(json.dumps({
        "refreshId": args.refresh_id,
        "pageNumber": args.expected_page,
        "sheetNumber": args.expected_sheet,
        "chunkCount": len(rows),
        "published": True,
    }), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Unexpected library errors are reduced to a type, not a URL, body,
        # credential, chunk, or vector.
        error = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print(json.dumps({"error": error}), file=sys.stderr, flush=True)
        raise SystemExit(1)
