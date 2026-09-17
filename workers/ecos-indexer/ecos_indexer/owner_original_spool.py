"""Linux sealed-original transport with a bounded source-size contract.

The public factory uses the shared source admission contract and requires
the exact gateway's still-live claim. It performs no RPC, download, PDF parse,
scan, enrollment or publication. Supplied bytes are hashed, not assumed to have
come from Storage. Source page count is an expectation, not a measurement.

memfd storage consumes RAM/cgroup memory. Streaming removes full Python-buffer
copies; it is neither disk-backed nor a constant-total-memory guarantee. Reads
are bounded; no public path, fileno, mutable buffer or descriptor is exposed.
Private Python object identity is an API boundary, not an in-process sandbox.

Cancellation/deadlines are cooperative between iterator/kernel operations. An
arbitrary blocking next()/close() cannot be preempted here. No background task
is started; future transport integration must separately bound network waits.
"""
from __future__ import annotations

import errno
from contextlib import contextmanager
import fcntl
import hashlib
import math
import os
import stat
import sys
import threading
import time
from types import MappingProxyType
from typing import Any, Iterable
import weakref

from .owner_execution import MAX_ORIGINAL_BYTES, OwnerExecutionIdentity, OwnerExecutionResult
from .owner_execution_gateway import OwnerExecutionGateway

MAX_CHUNK_BYTES = 65536
MAX_CHUNKS = 65536
# Private mechanism ceiling; public admission is separately bounded below it.
_MECHANISM_MAX_BYTES = 256 * 1024 * 1024
_SEAL_NAMES = ("F_SEAL_WRITE", "F_SEAL_GROW", "F_SEAL_SHRINK", "F_SEAL_SEAL")


class OwnerOriginalSpoolError(Exception):
    def __init__(self, code: str):
        self.code = code if code in {
            "invalid_request", "unsupported_kernel", "source_not_current", "cancelled",
            "deadline_exceeded", "invalid_chunk", "stream_limit", "bytes_mismatch",
            "storage_failed", "seal_failed", "cleanup_failed", "closed", "invalid_spool",
        } else "storage_failed"
        self.partial_bytes_returned = False
        self.retrieval_authorized = False
        super().__init__("Original spool operation not confirmed")


def _require_kernel() -> None:
    if (sys.platform != "linux" or not all(hasattr(os, name) for name in
            ("memfd_create", "MFD_CLOEXEC", "MFD_ALLOW_SEALING", "pread"))
            or not all(hasattr(fcntl, name) for name in (*_SEAL_NAMES, "F_ADD_SEALS", "F_GET_SEALS"))):
        raise OwnerOriginalSpoolError("unsupported_kernel")


def _new_fd() -> int:
    _require_kernel()
    try:
        return os.memfd_create("ecos-original-spool", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    except OSError as error:
        if error.errno == errno.ENOSYS:
            raise OwnerOriginalSpoolError("unsupported_kernel") from None
        raise


def _seal(fd: int) -> None:
    mask = 0
    for name in _SEAL_NAMES:
        mask |= getattr(fcntl, name)
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, mask)
    _assert_seals(fd)


def _assert_seals(fd: int) -> None:
    mask = 0
    for name in _SEAL_NAMES:
        mask |= getattr(fcntl, name)
    if fcntl.fcntl(fd, fcntl.F_GET_SEALS) & mask != mask or os.get_inheritable(fd):
        raise OwnerOriginalSpoolError("seal_failed")


def _stream_to_sealed_fd(chunks: Iterable[bytes], expected_length: int, expected_sha256: str,
                         check, *, byte_limit: int = MAX_ORIGINAL_BYTES) -> int:
    """Private mechanism; returned descriptor is never itself an authority brand."""
    if (type(byte_limit) is not int or not 5 <= byte_limit <= _MECHANISM_MAX_BYTES
            or type(expected_length) is not int or not 5 <= expected_length <= byte_limit
            or type(expected_sha256) is not str or len(expected_sha256) != 64
            or any(c not in "0123456789abcdef" for c in expected_sha256)):
        raise OwnerOriginalSpoolError("invalid_request")
    fd = None
    try:
        check()
        fd = _new_fd()
        digest = hashlib.sha256()
        count = 0
        iterator = iter(chunks)
        for number in range(MAX_CHUNKS + 1):
            check()
            try:
                chunk = next(iterator)
            except StopIteration:
                break
            check()
            if number == MAX_CHUNKS:
                raise OwnerOriginalSpoolError("stream_limit")
            # Exact immutable bytes: mutable arrays/views/subclasses are rejected,
            # rather than trusting a caller not to mutate while a write blocks.
            if type(chunk) is not bytes or not 1 <= len(chunk) <= MAX_CHUNK_BYTES:
                raise OwnerOriginalSpoolError("invalid_chunk")
            if len(chunk) > expected_length - count:
                raise OwnerOriginalSpoolError("bytes_mismatch")
            view = memoryview(chunk)
            offset = 0
            while offset < len(view):
                check()
                written = os.write(fd, view[offset:])
                check()
                if type(written) is not int or not 1 <= written <= len(view) - offset:
                    raise OwnerOriginalSpoolError("storage_failed")
                offset += written
            digest.update(chunk)
            count += len(chunk)
        check()
        if count != expected_length or digest.hexdigest() != expected_sha256:
            raise OwnerOriginalSpoolError("bytes_mismatch")
        if os.fstat(fd).st_size != count:
            raise OwnerOriginalSpoolError("storage_failed")
        try:
            _seal(fd)
        except Exception:
            raise OwnerOriginalSpoolError("seal_failed") from None
        check()
        # Hash the now-sealed file itself, not only the input chunks. This also
        # detects write-path corruption without constructing a whole-file copy.
        verified = hashlib.sha256()
        offset = 0
        while offset < count:
            check()
            part = os.pread(fd, min(MAX_CHUNK_BYTES, count - offset), offset)
            check()
            if type(part) is not bytes or not 1 <= len(part) <= min(MAX_CHUNK_BYTES, count - offset):
                raise OwnerOriginalSpoolError("storage_failed")
            verified.update(part)
            offset += len(part)
        if verified.hexdigest() != expected_sha256:
            raise OwnerOriginalSpoolError("bytes_mismatch")
        check()
        result, fd = fd, None
        return result
    except OwnerOriginalSpoolError:
        raise
    except Exception:
        raise OwnerOriginalSpoolError("storage_failed") from None
    finally:
        if fd is not None:
            # Never retry close: after an error, the numeric FD may be reused.
            try:
                os.close(fd)
            except OSError:
                raise OwnerOriginalSpoolError("cleanup_failed") from None


class _State:
    def __init__(self, fd: int, pins: MappingProxyType):
        self.fd: int | None = fd
        self.pins = pins
        info = os.fstat(fd)
        self.file_identity = (info.st_dev, info.st_ino, info.st_size)
        self.lock = threading.Lock()

    def close(self) -> None:
        with self.lock:
            fd, self.fd = self.fd, None
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    raise OwnerOriginalSpoolError("cleanup_failed") from None


_STATES: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _state(value: Any) -> _State:
    if type(value) is not OwnerOriginalSpool or value not in _STATES:
        raise OwnerOriginalSpoolError("invalid_spool")
    return _STATES[value]


def _open_readonly(fd: int) -> int:
    # Only an already-validated private descriptor determines this kernel path.
    # A separate open description also prevents child seeks altering our offset.
    return os.open(f"/proc/self/fd/{fd}", os.O_RDONLY | os.O_CLOEXEC)


@contextmanager
def _borrow_readonly_descriptor(value: Any):
    """Internal runner hook only; not a public arbitrary-path/FD constructor.

    The runner holds this lease until its child group has exited and been reaped.
    Closing the parent spool meanwhile invalidates the eventual result, but a
    borrowed descriptor is not itself an authorization or process sandbox.
    """
    _require_kernel()
    state = _state(value)
    borrowed = None
    def check_file(fd: int):
        _assert_seals(fd)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode)
                or (info.st_dev, info.st_ino, info.st_size) != state.file_identity):
            raise OwnerOriginalSpoolError("invalid_spool")
    try:
        with state.lock:
            if state.fd is None:
                raise OwnerOriginalSpoolError("closed")
            check_file(state.fd)
            borrowed = _open_readonly(state.fd)
            check_file(borrowed)
            if fcntl.fcntl(borrowed, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY:
                raise OwnerOriginalSpoolError("invalid_spool")
        yield borrowed
        with state.lock:
            if state.fd is None:
                raise OwnerOriginalSpoolError("closed")
            check_file(state.fd)
            check_file(borrowed)
    except OwnerOriginalSpoolError:
        raise
    except Exception:
        raise OwnerOriginalSpoolError("storage_failed") from None
    finally:
        if borrowed is not None:
            try:
                os.close(borrowed)
            except OSError:
                raise OwnerOriginalSpoolError("cleanup_failed") from None


def _finalize(state: _State) -> None:
    try:
        state.close()
    except OwnerOriginalSpoolError:
        pass  # Explicit close reports cleanup failure; GC cannot report a receipt.


class OwnerOriginalSpool:
    __slots__ = ("__weakref__",)

    def __new__(cls):
        raise OwnerOriginalSpoolError("invalid_spool")

    @property
    def pins(self) -> MappingProxyType:
        return _state(self).pins

    @property
    def closed(self) -> bool:
        return _state(self).fd is None

    def read_at(self, offset: int, length: int) -> bytes:
        """Bounded local bytes only; not a fresh source/claim authorization check."""
        state = _state(self)
        if (type(offset) is not int or not 0 <= offset <= state.pins["byte_length"]
                or type(length) is not int or not 1 <= length <= MAX_CHUNK_BYTES):
            raise OwnerOriginalSpoolError("invalid_request")
        with state.lock:
            if state.fd is None:
                raise OwnerOriginalSpoolError("closed")
            try:
                _assert_seals(state.fd)
                info = os.fstat(state.fd)
                if (not stat.S_ISREG(info.st_mode)
                        or (info.st_dev, info.st_ino, info.st_size) != state.file_identity):
                    raise OwnerOriginalSpoolError("invalid_spool")
                data = os.pread(state.fd, length, offset)
                if len(data) != min(length, info.st_size - offset):
                    raise OwnerOriginalSpoolError("storage_failed")
                return data
            except OwnerOriginalSpoolError:
                raise
            except Exception:
                raise OwnerOriginalSpoolError("storage_failed") from None

    def close(self) -> None:
        _state(self).close()

    def __enter__(self):
        if self.closed:
            raise OwnerOriginalSpoolError("closed")
        return self

    def __exit__(self, *_):
        self.close()


def spool_owner_original(gateway: OwnerExecutionGateway, claim: OwnerExecutionResult,
                         chunks: Iterable[bytes], *, cancel_event: threading.Event | None = None,
                         timeout_seconds: float = 30) -> OwnerOriginalSpool:
    """Consume/close the supplied iterator; verify bytes against a genuine claim.

    Claim membership/lifetime is checked locally, not re-read from SQL. A future
    consumer must perform action-time source/authority rechecks. Existing source
    profile is bounded by MAX_ORIGINAL_BYTES. This supplies no page-count/scan proof.
    """
    try:
        if (type(gateway) is not OwnerExecutionGateway or type(claim) is not OwnerExecutionResult
                or (cancel_event is not None and type(cancel_event) is not threading.Event)
                or type(timeout_seconds) not in (float, int) or not math.isfinite(timeout_seconds)
                or not 0 < timeout_seconds <= 30):
            raise ValueError()
        original_identity = gateway.require_download_identity(claim)
        identity = OwnerExecutionIdentity.from_service_request(dict(original_identity.request),
            expected_byte_length=original_identity.expected_byte_length)
    except Exception:
        raise OwnerOriginalSpoolError("invalid_request") from None
    deadline = time.monotonic() + timeout_seconds
    def check():
        if cancel_event is not None and cancel_event.is_set():
            raise OwnerOriginalSpoolError("cancelled")
        if time.monotonic() >= deadline:
            raise OwnerOriginalSpoolError("deadline_exceeded")
        try:
            current = gateway.require_download_identity(claim)
            if (current is not original_identity or dict(current.request) != dict(identity.request)
                    or current.expected_byte_length != identity.expected_byte_length):
                raise ValueError()
        except Exception:
            raise OwnerOriginalSpoolError("source_not_current") from None
    check()
    _require_kernel()  # Mac fails before invoking/consuming the caller's iterator.
    fd = None
    iterator = None
    try:
        iterator = iter(chunks)
        fd = _stream_to_sealed_fd(iterator, identity.expected_byte_length, identity.request["source_sha256"], check)
        close = getattr(iterator, "close", None)
        iterator = None  # At most one close attempt, including close failure.
        if close is not None:
            try:
                close()
            except Exception:
                raise OwnerOriginalSpoolError("cleanup_failed") from None
        check()
        pins = MappingProxyType({"request": identity.request, "claim_id": claim.payload["claim"]["claim_id"],
            "binding_version": claim.payload["binding_version"], "byte_length": identity.expected_byte_length,
            "source_sha256": identity.request["source_sha256"], "bucket": "project-documents",
            "object_key": identity.object_key, "verification": "exact_supplied_bytes_hash_and_linux_seals_only",
            "authority_currentness": "supplied_gateway_claim_checked_locally_only",
            "page_count_verification": "not_performed", "scan": "not_performed",
            "retrieval_authorized": False, "semantic_verified": False})
        state = _State(fd, pins)
        check()
        result = object.__new__(OwnerOriginalSpool)
        _STATES[result] = state
        weakref.finalize(result, _finalize, state)
        fd = None
        return result
    except OwnerOriginalSpoolError:
        raise
    except Exception:
        raise OwnerOriginalSpoolError("storage_failed") from None
    finally:
        try:
            if iterator is not None:
                close = getattr(iterator, "close", None)
                if close is not None:
                    close()
        except Exception:
            raise OwnerOriginalSpoolError("cleanup_failed") from None
        finally:
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    raise OwnerOriginalSpoolError("cleanup_failed") from None
