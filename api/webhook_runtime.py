"""
Webhook Security & Production Reliability Runtime:
1. Meta X-Hub-Signature-256 HMAC verification
2. Sliding-window rate limiter (IP / sender / tenant)
3. Async background webhook job queue with exponential backoff retries & dead-letter queue
"""

import os
import hmac
import hashlib
import asyncio
import time
import threading
import logging
from collections import deque
from typing import Awaitable, Callable, Deque, Dict, Optional, Tuple

from api import db

logger = logging.getLogger("webhook_runtime")


def verify_meta_signature(raw_body: bytes, signature_header: str, app_secret: str) -> Tuple[bool, str]:
    """
    Verify incoming Meta webhook POST body against `X-Hub-Signature-256: sha256=<hex>`.
    Uses constant-time comparison.
    """
    secret = str(app_secret or "").strip()
    if not secret:
        return True, "no_secret_configured"

    hdr = str(signature_header or "").strip()
    if not hdr or not hdr.startswith("sha256="):
        return False, "Missing or malformed X-Hub-Signature-256 header"

    provided_hex = hdr[7:].strip().lower()
    expected_hex = hmac.new(secret.encode("utf-8"), raw_body or b"", hashlib.sha256).hexdigest()
    if not hmac.compare_digest(provided_hex, expected_hex):
        return False, "Invalid X-Hub-Signature-256 signature"
    return True, "verified"


class SlidingWindowRateLimiter:
    """Thread-safe in-memory sliding-window rate limiter."""

    def __init__(self):
        self._lock = threading.Lock()
        self._buckets: Dict[str, Deque[float]] = {}

    def allow(self, key: str, max_calls: int, window_sec: float) -> Tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - float(window_sec)
        with self._lock:
            dq = self._buckets.setdefault(key, deque())
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= max_calls:
                retry_after = max(1, int(round(dq[0] + window_sec - now)))
                return False, retry_after
            dq.append(now)
            if len(self._buckets) > 5000:
                stale = [k for k, v in self._buckets.items() if not v or v[-1] <= cutoff]
                for k in stale[:1000]:
                    del self._buckets[k]
            return True, 0


class WebhookJobQueue:
    """Async FIFO job queue with exponential backoff retries and dead-letter persistence."""

    def __init__(self, max_attempts: int = 3, base_delay: float = 0.5):
        self.max_attempts = max(1, int(max_attempts))
        self.base_delay = float(base_delay)
        self._queue: Optional[asyncio.Queue] = None
        self._worker_task: Optional[asyncio.Task] = None
        self._handler: Optional[Callable[[dict], Awaitable[None]]] = None
        self._stats = {"enqueued": 0, "succeeded": 0, "retried": 0, "dead_lettered": 0}

    def set_handler(self, handler: Callable[[dict], Awaitable[None]]):
        self._handler = handler

    async def start(self):
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self):
        if self._queue is not None:
            await self._queue.put(None)
        if self._worker_task is not None:
            try:
                await asyncio.wait_for(self._worker_task, timeout=5.0)
            except Exception:
                self._worker_task.cancel()
            self._worker_task = None

    async def enqueue(self, job: dict) -> bool:
        await self.start()
        self._stats["enqueued"] += 1
        await self._queue.put(job)
        return True

    def get_stats(self) -> Dict[str, int]:
        pending = self._queue.qsize() if self._queue else 0
        return {"pending": pending, **self._stats}

    async def _worker_loop(self):
        while True:
            job = await self._queue.get()
            if job is None:
                self._queue.task_done()
                break
            try:
                await self._execute_with_retry(job)
            finally:
                self._queue.task_done()

    async def _execute_with_retry(self, job: dict):
        if not self._handler:
            return
        tid = str(job.get("tenant_id") or "default")
        event_id = str(job.get("event_id") or "")
        phone = str(job.get("phone_number") or "")
        last_err = ""

        for attempt in range(1, self.max_attempts + 1):
            try:
                await self._handler(job)
                self._stats["succeeded"] += 1
                return
            except Exception as e:
                last_err = str(e)
                logger.warning(f"[WebhookQueue] Job {event_id} attempt {attempt}/{self.max_attempts} failed: {e}")
                if attempt < self.max_attempts:
                    self._stats["retried"] += 1
                    delay = self.base_delay * (3 ** (attempt - 1))
                    await asyncio.sleep(delay)

        self._stats["dead_lettered"] += 1
        db.save_dead_letter_job(
            tenant_id=tid,
            event_id=event_id,
            phone_number=phone,
            payload=job,
            error_message=last_err or "Unknown worker error",
            attempts=self.max_attempts,
        )


rate_limiter = SlidingWindowRateLimiter()
webhook_queue = WebhookJobQueue(max_attempts=3, base_delay=0.5)
