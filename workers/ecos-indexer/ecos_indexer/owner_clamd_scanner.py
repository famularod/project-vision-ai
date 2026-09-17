"""Private warm ClamAV service and exact sealed-source stream adapter.

The daemon loads immutable packaged signatures before any source claim. It has
only a mode-0600 Unix socket and receives the already sealed source in bounded
chunks. No TCP listener, path, source name, credential or scan output is used.
"""
from __future__ import annotations

from contextlib import contextmanager
import math
import os
from pathlib import Path
import signal
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
import weakref

from .original_visual_reader import parser_environment
from .owner_original_spool import MAX_CHUNK_BYTES, OwnerOriginalSpool
from .owner_service_limits import OWNER_SCAN_TIMEOUT_SECONDS

_DAEMON = "/usr/sbin/clamd"
_CONFIG = "/usr/local/share/ecos/ecos-clamd.conf"
_SOCKET = "/tmp/ecos-clamd.sock"
_MAX_RESPONSE = 4096
_STATES: weakref.WeakKeyDictionary["OwnerClamdScanner", tuple[int, int, int]] = weakref.WeakKeyDictionary()


class OwnerClamdScannerError(Exception):
    def __init__(self, code: str):
        self.code = code if code in {
            "invalid_request", "scanner_unavailable", "scan_not_clean", "scan_limit_exceeded", "scan_size_limit",
            "scan_file_size_limit", "scan_file_count_limit", "scan_recursion_limit", "scan_time_limit",
            "scan_deadline", "cancelled", "cleanup_failed",
        } else "scanner_unavailable"
        super().__init__("Private source scan was not confirmed clean")


def classify_scan_response(response: bytes) -> str:
    """Fixed operator codes only. All non-clean results still stop processing."""
    if response == b"stream: OK\0":
        return "clean"
    limits = {
        b"MaxScanSize": "scan_size_limit",
        b"MaxFileSize": "scan_file_size_limit",
        b"MaxFiles": "scan_file_count_limit",
        b"MaxRecursion": "scan_recursion_limit",
        b"MaxScanTime": "scan_time_limit",
    }
    for name, code in limits.items():
        if response == b"stream: Heuristics.Limits.Exceeded." + name + b" FOUND\0":
            return code
    if type(response) is bytes and response.startswith(b"stream: Heuristics.Limits.Exceeded.") and response.endswith(b" FOUND\0"):
        return "scan_limit_exceeded"
    if type(response) is bytes and response.endswith(b" FOUND\0"):
        return "scan_not_clean"
    return "scanner_unavailable"


def _check_cancel(cancel_event: threading.Event, deadline: float) -> float:
    if cancel_event.is_set():
        raise OwnerClamdScannerError("cancelled")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise OwnerClamdScannerError("scan_deadline")
    return remaining


def _socket_identity() -> tuple[int, int]:
    try:
        info = os.lstat(_SOCKET)
        if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError()
        return info.st_dev, info.st_ino
    except Exception:
        raise OwnerClamdScannerError("scanner_unavailable") from None


def _connect(scanner: "OwnerClamdScanner", timeout: float) -> socket.socket:
    client = None
    try:
        state = _STATES.get(scanner)
        if state is None or _socket_identity() != state[:2]:
            raise ValueError()
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(max(0.001, min(0.25, timeout)))
        client.connect(_SOCKET)
        if hasattr(socket, "SO_PEERCRED"):
            pid, uid, gid = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if pid != state[2] or uid != os.getuid() or gid != os.getgid():
                raise ValueError()
        return client
    except Exception:
        try:
            if client is not None:
                client.close()
        except Exception:
            pass
        raise OwnerClamdScannerError("scanner_unavailable") from None


def _send(client: socket.socket, raw: bytes, cancel_event: threading.Event, deadline: float) -> None:
    view = memoryview(raw)
    while view:
        client.settimeout(min(0.25, _check_cancel(cancel_event, deadline)))
        try:
            sent = client.send(view)
        except socket.timeout:
            continue
        except OSError:
            raise OwnerClamdScannerError("scanner_unavailable") from None
        if sent <= 0:
            raise OwnerClamdScannerError("scanner_unavailable")
        view = view[sent:]


def _receive(client: socket.socket, cancel_event: threading.Event, deadline: float) -> bytes:
    response = bytearray()
    while True:
        client.settimeout(min(0.25, _check_cancel(cancel_event, deadline)))
        try:
            block = client.recv(min(256, _MAX_RESPONSE + 1 - len(response)))
        except socket.timeout:
            continue
        except OSError:
            raise OwnerClamdScannerError("scanner_unavailable") from None
        if not block or len(response) + len(block) > _MAX_RESPONSE:
            raise OwnerClamdScannerError("scanner_unavailable")
        response.extend(block)
        if response.endswith(b"\0"):
            return bytes(response)


class OwnerClamdScanner:
    __slots__ = ("__weakref__",)

    def __new__(cls):
        raise OwnerClamdScannerError("invalid_request")

    def scan(self, original: OwnerOriginalSpool, *, cancel_event: threading.Event,
             timeout_seconds: float) -> None:
        try:
            if (type(original) is not OwnerOriginalSpool or original.closed
                    or type(cancel_event) is not threading.Event
                    or type(timeout_seconds) not in (int, float)
                    or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= OWNER_SCAN_TIMEOUT_SECONDS):
                raise ValueError()
            pins = original.pins
            length = pins["byte_length"]
            from .owner_original_limits import MAX_ORIGINAL_BYTES
            if type(length) is not int or not 5 <= length <= MAX_ORIGINAL_BYTES:
                raise ValueError()
        except Exception:
            raise OwnerClamdScannerError("invalid_request") from None
        deadline = time.monotonic() + timeout_seconds
        client = _connect(self, _check_cancel(cancel_event, deadline))
        try:
            _send(client, b"zINSTREAM\0", cancel_event, deadline)
            for offset in range(0, length, MAX_CHUNK_BYTES):
                block = original.read_at(offset, min(MAX_CHUNK_BYTES, length - offset))
                _send(client, struct.pack(">I", len(block)), cancel_event, deadline)
                _send(client, block, cancel_event, deadline)
            _send(client, b"\0\0\0\0", cancel_event, deadline)
            response = _receive(client, cancel_event, deadline)
        finally:
            client.close()
        _check_cancel(cancel_event, deadline)
        result = classify_scan_response(response)
        if result == "clean":
            return
        raise OwnerClamdScannerError(result)


def _ping(deadline: float, cancel_event: threading.Event) -> bool:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.settimeout(min(0.25, _check_cancel(cancel_event, deadline)))
        client.connect(_SOCKET)
        client.sendall(b"zPING\0")
        return client.recv(16) == b"PONG\0"
    except (OSError, socket.timeout):
        return False
    finally:
        client.close()


def _stop(process, scanner: "OwnerClamdScanner | None") -> bool:
    """Bounded daemon cleanup; return whether exact cleanup was unconfirmed."""
    failed = False
    if scanner is not None:
        _STATES.pop(scanner, None)
    if process is not None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                failed = True
    try:
        if Path(_SOCKET).exists():
            if not stat.S_ISSOCK(os.lstat(_SOCKET).st_mode):
                failed = True
            else:
                os.unlink(_SOCKET)
    except OSError:
        failed = True
    return failed


@contextmanager
def start_owner_clamd_scanner(*, cancel_event: threading.Event,
                              startup_timeout: float = 150):
    """Load packaged signatures before the owner execution claim begins."""
    try:
        if sys.platform != "linux" or type(cancel_event) is not threading.Event:
            raise ValueError()
        if (type(startup_timeout) not in (int, float) or not math.isfinite(startup_timeout)
                or not 1 <= startup_timeout <= 180 or Path(_SOCKET).exists()):
            raise ValueError()
        for value in (_DAEMON, _CONFIG):
            path = Path(value)
            if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o022:
                raise ValueError()
    except Exception:
        raise OwnerClamdScannerError("invalid_request") from None
    deadline = time.monotonic() + startup_timeout
    environment = parser_environment(_DAEMON)
    environment.update(HOME="/tmp", XDG_CACHE_HOME="/tmp")
    process = None
    scanner = None
    try:
        process = subprocess.Popen(
            [_DAEMON, "--foreground", "--config-file=" + _CONFIG],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, shell=False, start_new_session=True,
            close_fds=True, env=environment,
        )
        while True:
            _check_cancel(cancel_event, deadline)
            if process.poll() is not None:
                raise OwnerClamdScannerError("scanner_unavailable")
            if Path(_SOCKET).exists() and _ping(deadline, cancel_event):
                break
            time.sleep(min(0.05, _check_cancel(cancel_event, deadline)))
        scanner = object.__new__(OwnerClamdScanner)
        _STATES[scanner] = (*_socket_identity(), process.pid)
    except Exception as error:
        cleanup_failed = _stop(process, scanner)
        if cleanup_failed:
            raise OwnerClamdScannerError("cleanup_failed")
        if type(error) is OwnerClamdScannerError:
            raise
        raise OwnerClamdScannerError("scanner_unavailable") from None
    try:
        # Keep the caller's body outside the startup exception normalizer. A
        # page/identity failure must retain its own fixed code for diagnosis.
        yield scanner
    finally:
        cleanup_failed = _stop(process, scanner)
        if cleanup_failed and sys.exc_info()[0] is None:
            raise OwnerClamdScannerError("cleanup_failed")
