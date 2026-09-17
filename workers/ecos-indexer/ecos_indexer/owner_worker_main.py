"""Default-off, one-shot owner worker. Never enters the legacy queue.

Dispatch is a trusted service input, not customer JSON or an authorization proof.
Every action rechecks the actual source/binding through protected owner RPCs.
No retry, enrollment, source mutation, model call, transcript or PNG stdout.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sys
import threading
import time

from .owner_execution import OwnerExecutionIdentity, decode_json, exact_object, integer, uuid
from .owner_execution_gateway import OwnerExecutionGateway, SUPABASE_URL
from .owner_original_download import OwnerOriginalDownloader
from .owner_clamd_scanner import start_owner_clamd_scanner
from .owner_page_checkpoint_gateway import OwnerPageCheckpointGateway
from .owner_page_raster_gateway import OwnerPageRasterGateway
from .owner_page_processing import process_owner_pages, OwnerPageProcessingError
from .owner_service_limits import OWNER_PROCESSING_TIMEOUT_SECONDS
from .original_visual_reader import installed_engine, run_bounded

SCHEMA = "ecos-owner-worker-dispatch/2.1"
KEYS = frozenset("schema_version publication_mode request expected_byte_length claim_id page_attempts raster_attempts dpi psm".split())
DISPATCH_BYTES = 16384
FIXED_PATH = "/usr/local/bin:/usr/bin:/bin"


class OwnerDispatchError(Exception):
    pass


def validate_dispatch(raw: bytes) -> dict:
    """Strict copied JSON before any scan, claim or network operation."""
    try:
        value = exact_object(decode_json(raw, DISPATCH_BYTES), KEYS)
        if value["schema_version"] != SCHEMA or value["publication_mode"] != "shadow":raise ValueError()
        identity = OwnerExecutionIdentity.from_service_request(value["request"], expected_byte_length=value["expected_byte_length"])
        uuid(value["claim_id"]); integer(value["dpi"],72,400)
        if type(value["psm"]) is not int or value["psm"] not in (3,6,11):raise ValueError()
        attempts = value["page_attempts"]
        if type(attempts) is not list or not 1 <= len(attempts) <= 8:raise ValueError()
        pages=[]; ids=[]
        for raw_attempt in attempts:
            a=exact_object(raw_attempt,frozenset(("page_number","attempt_id","expected_previous_attempt_id")))
            integer(a["page_number"],1,identity.request["source_page_count"]);uuid(a["attempt_id"])
            if a["expected_previous_attempt_id"] is not None:
                uuid(a["expected_previous_attempt_id"])
                if a["attempt_id"]==a["expected_previous_attempt_id"]:raise ValueError()
            pages.append(a["page_number"]);ids.append(a["attempt_id"])
        if pages!=sorted(set(pages)) or len(set(ids))!=len(ids):raise ValueError()
        rasters=value["raster_attempts"]
        if rasters is not None:
            if type(rasters) is not list or len(rasters)!=len(pages):raise ValueError()
            uploads=[]
            for number,raw_attempt in zip(pages,rasters):
                a=exact_object(raw_attempt,frozenset(("page_number","upload_attempt_id","expected_previous_upload_attempt_id","mode")))
                integer(a["page_number"],number,number);uuid(a["upload_attempt_id"])
                if a["upload_attempt_id"][14]!="4" or type(a["mode"]) is not str or a["mode"] not in ("upload","reconcile"):raise ValueError()
                previous=a["expected_previous_upload_attempt_id"]
                if previous is not None:
                    uuid(previous)
                    if previous[14]!="4" or previous==a["upload_attempt_id"]:raise ValueError()
                uploads.append(a["upload_attempt_id"])
            if len(set(uploads))!=len(uploads):raise ValueError()
        return value
    except Exception:
        raise OwnerDispatchError("invalid_dispatch") from None


def verify_owner_runtime(cancel_event: threading.Event) -> None:
    """Bounded startup integrity check, before the source claim.

    Image build/independent Linux tests must establish engine/library compatibility.
    Executable/definition hashes alone do not certify an isolated or safe parser.
    """
    deadline=time.monotonic()+15
    def check():
        if cancel_event.is_set() or time.monotonic()>=deadline:raise OwnerDispatchError("runtime_preflight_unavailable")
    try:
        check()
        lock=Path("/usr/local/share/ecos/clamav-databases.sha256")
        if lock.is_symlink() or not lock.is_file() or lock.stat().st_mode & 0o222:raise ValueError()
        with lock.open("rb") as f:raw=f.read(1025)
        if len(raw)>1024:raise ValueError()
        expected={}
        for line in raw.decode("ascii").splitlines():
            match=re.fullmatch(r"([a-f0-9]{64})  (main\.cvd|daily\.cvd|bytecode\.cvd)",line)
            if not match or match[2] in expected:raise ValueError()
            expected[match[2]]=match[1]
        if set(expected)!={"main.cvd","daily.cvd","bytecode.cvd"}:raise ValueError()
        for name,digest in expected.items():
            path=Path("/var/lib/clamav")/name
            if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o222 or path.stat().st_size>512*1024*1024:raise ValueError()
            h=hashlib.sha256()
            with path.open("rb") as f:
                while block:=f.read(1024*1024):check();h.update(block)
            if h.hexdigest()!=digest:raise ValueError()
        for command,option in (("/usr/bin/pdftoppm","-v"),("/usr/bin/tesseract","--version"),("/usr/bin/clamscan","--version")):
            check();installed_engine(command,command)
            run_bounded([command,option],min(3,max(.001,deadline-time.monotonic())),16384,cancel_event=cancel_event)
        check()
    except Exception:
        raise OwnerDispatchError("runtime_preflight_unavailable") from None


def execute_dispatch(raw: bytes, *, service_role_key: str, cancel_event: threading.Event) -> dict:
    """Caller owns environment enablement; this pure seam never creates IDs."""
    d=validate_dispatch(raw)
    if (type(service_role_key) is not str or not 1<=len(service_role_key)<=16384
            or any(not "!"<=c<="~" for c in service_role_key) or type(cancel_event) is not threading.Event):
        raise OwnerDispatchError("invalid_runtime_configuration")
    if cancel_event.is_set():raise OwnerDispatchError("cancelled")
    verify_owner_runtime(cancel_event)
    identity=OwnerExecutionIdentity.from_service_request(d["request"],expected_byte_length=d["expected_byte_length"])
    base={"schema_version":"ecos-owner-worker-result/2.1","publication_mode":"shadow",
          "execution_id":identity.request["execution_id"],"binding_id":identity.request["request_id"],"claim_id":d["claim_id"],
          "retrieval_authorized":False,"semantic_verified":False,"image_available":False}
    try:
        # ClamAV's immutable signature database is loaded before the source
        # source claim. The claimed interval contains only the exact local
        # stream scan and page work, never scanner cold start.
        with start_owner_clamd_scanner(cancel_event=cancel_event) as scanner_service:
            gateway=OwnerExecutionGateway(identity,service_role_key=service_role_key)
            cleanup=OwnerExecutionGateway(identity,service_role_key=service_role_key,timeout_seconds=5)
            checkpoints=OwnerPageCheckpointGateway(identity,service_role_key=service_role_key)
            downloader=OwnerOriginalDownloader(service_role_key=service_role_key)
            optional={}
            if d["raster_attempts"] is not None:
                optional={"raster_gateway":OwnerPageRasterGateway(gateway,checkpoints,service_role_key=service_role_key),
                          "raster_attempts":d["raster_attempts"],"independent_images":True}
            result=process_owner_pages(gateway=gateway,cleanup_gateway=cleanup,downloader=downloader,checkpoints=checkpoints,
                claim_id=d["claim_id"],page_attempts=d["page_attempts"],dpi=d["dpi"],psm=d["psm"],cancel_event=cancel_event,
                sealed_original=True,total_timeout=OWNER_PROCESSING_TIMEOUT_SECONDS,cleanup_timeout=5,
                scanner_service=scanner_service,**optional).value
        # Do not thaw/copy raw pages or bytes just to format an operator receipt.
        return {**base,"status":"selected_pages_processed","coverage":"selected_pages_only",
                "source_scan":"clean_at_processing","selected_pages":list(result["selected_pages"]),
                "confirmed_attempt_ids":[p["head"]["attempt_id"] for p in result["checkpoints"]],
                "confirmed_upload_attempt_ids":[p["upload_attempt_id"] for p in result.get("raster_receipts",()) if p["state"]=="copy_verified_at_readback"],
                "uncertain_attempt_id":None,"uncertain_upload_attempt_id":None,"cleanup":"claim_released",
                "limitations":["raw_observations_only","whole_document_not_claimed","currentness_at_sequential_readbacks_only"]}
    except OwnerPageProcessingError as error:
        return {**base,"status":"not_confirmed","reason":error.code,
                "diagnostic_stage":error.diagnostic_stage,"diagnostic_reason":error.diagnostic_reason,
                "confirmed_attempt_ids":list(error.confirmed_attempt_ids),"confirmed_upload_attempt_ids":list(error.confirmed_upload_attempt_ids),
                "uncertain_attempt_id":error.uncertain_attempt_id,"uncertain_upload_attempt_id":error.uncertain_upload_attempt_id,
                "cleanup":error.cleanup,"successful_evidence_prefix":False,"external_network_termination_proven":False}


def main() -> int:
    stop=threading.Event()
    previous={s:signal.signal(s,lambda *_:stop.set()) for s in (signal.SIGTERM,signal.SIGINT)}
    try:
        if len(sys.argv)!=1:raise OwnerDispatchError("invalid_runtime_configuration")
        if os.environ.get("ECOS_OWNER_PREVIEW_WORKER_ENABLED")!="true":
            print('{"schema_version":"ecos-owner-worker-result/2.1","status":"disabled","retrieval_authorized":false}')
            return 0
        # Config is deliberately separate from the legacy worker. Never accept
        # caller URLs, provider keys, queue overrides or an organization resolver.
        if os.environ.get("SUPABASE_URL",SUPABASE_URL)!=SUPABASE_URL:raise OwnerDispatchError("invalid_runtime_configuration")
        raw=os.environ.pop("ECOS_OWNER_WORKER_DISPATCH_JSON",None)
        if type(raw) is not str or len(raw)>DISPATCH_BYTES:raise OwnerDispatchError("invalid_dispatch")
        encoded=raw.encode("utf-8",errors="strict")
        validate_dispatch(encoded)
        secret=os.environ.pop("SUPABASE_SERVICE_ROLE_KEY",None)
        os.environ["PATH"]=FIXED_PATH
        result=execute_dispatch(encoded,service_role_key=secret,cancel_event=stop)
        if stop.is_set():
            # Keep exact known/uncertain IDs returned by bounded cleanup so an
            # operator can reconcile them; a late signal never publishes success.
            result={**result,"status":"not_confirmed","reason":"cancelled",
                    "successful_evidence_prefix":False,"external_network_termination_proven":False}
        wire=json.dumps(result,separators=(",",":"),ensure_ascii=True)
        if len(wire.encode())>16384:raise OwnerDispatchError("invalid_runtime_result")
        print(wire,flush=True)
        return 0 if result["status"]=="selected_pages_processed" else 1
    except Exception:
        # Never include exception text, request JSON, source names, paths or keys.
        print('{"schema_version":"ecos-owner-worker-result/2.1","status":"not_confirmed","reason":"runtime_or_dispatch_rejected","retrieval_authorized":false}',flush=True)
        return 1
    finally:
        stop.set()
        for signum,handler in previous.items():signal.signal(signum,handler)


if __name__=="__main__":raise SystemExit(main())
