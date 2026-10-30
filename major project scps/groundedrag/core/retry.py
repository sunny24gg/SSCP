"""Small retry helper for transient LLM API errors.

Google's own client already retries a few times internally, but a 503 under
sustained load can still surface. Wrapping calls here adds a couple of
app-level attempts with backoff so a single busy moment doesn't crash the
Streamlit app or an evaluation run.
"""

import time
import random


def with_retry(fn, *args, attempts: int = 3, base_delay: float = 2.0, **kwargs):
    """Call fn(*args, **kwargs), retrying on transient server errors.

    Only retries errors that look transient (503/UNAVAILABLE, 429/rate limit,
    timeouts) — anything else (bad API key, invalid request) fails immediately
    since retrying it would never help.
    """
    transient_markers = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED",
                          "timeout", "DEADLINE_EXCEEDED")

    last_exc = None
    for attempt in range(1, attempts + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, re-raised below
            last_exc = exc
            transient = any(m in str(exc) for m in transient_markers)
            if not transient or attempt == attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
            time.sleep(delay)

    raise last_exc  # pragma: no cover - unreachable, satisfies type checkers
