"""Real-time transaction audit logger.

Every write operation in db.py fires a background asyncio.Task that
persists a JSON snapshot here — completely decoupled from the main
transaction.  If this logger fails for any reason, the main flow is
NEVER affected.

Design principles:
  • Uses a SEPARATE pool connection — never the transaction connection.
  • log_safe() swallows ALL exceptions and never re-raises.
  • SHA-256 checksum lets you verify nothing was tampered with.
  • Audit events are logged locally only (no Telegram forwarding).
"""

import hashlib
import json
import logging
from typing import Any, Dict, Optional

import asyncpg

logger = logging.getLogger(__name__)


def _checksum(payload: Dict[str, Any]) -> str:
    serialised = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialised.encode()).hexdigest()


class AuditLogger:
    """Attach one instance to the Database object; call _audit() helper there."""

    def __init__(self, pool: asyncpg.Pool, **_kwargs: Any) -> None:  # type: ignore[type-arg]
        self._pool = pool

    # ─── Public API ───────────────────────────────────────────────────────────

    async def log_safe(
        self,
        event_type: str,
        payload: Dict[str, Any],
        reference_id: Optional[str] = None,
    ) -> None:
        """Write audit row to DB and log locally.  NEVER raises."""
        try:
            await self._write(event_type, payload, reference_id)
        except Exception as exc:
            logger.warning("audit_log._write failed (%s): %s", event_type, exc)

        logger.info(
            "AUDIT | %s | ref=%s | %s",
            event_type,
            reference_id,
            json.dumps(payload, default=str),
        )

    async def verify_integrity(self, since_hours: int = 24) -> Dict[str, Any]:
        """Compare stored checksums against freshly computed ones.

        Returns a dict with keys: checked, ok, tampered (list of bad IDs).
        Called hourly from the scheduler — results are logged, not raised.
        """
        try:
            async with self._pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT id, payload, checksum
                       FROM transaction_audit_log
                       WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour')""",
                    since_hours,
                )
            tampered = []
            for row in rows:
                stored_payload = (
                    json.loads(row["payload"])
                    if isinstance(row["payload"], str)
                    else dict(row["payload"])
                )
                expected = _checksum(stored_payload)
                if row["checksum"] != expected:
                    tampered.append(row["id"])
            return {
                "checked": len(rows),
                "ok": len(rows) - len(tampered),
                "tampered": tampered,
            }
        except Exception as exc:
            logger.error("integrity check failed: %s", exc)
            return {"checked": 0, "ok": 0, "tampered": [], "error": str(exc)}

    # ─── Internal ─────────────────────────────────────────────────────────────

    async def _write(
        self,
        event_type: str,
        payload: Dict[str, Any],
        reference_id: Optional[str],
    ) -> None:
        cs = _checksum(payload)
        payload_json = json.dumps(payload, default=str)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO transaction_audit_log
                       (event_type, reference_id, payload, checksum)
                   VALUES ($1, $2, $3::jsonb, $4)""",
                event_type,
                reference_id,
                payload_json,
                cs,
            )
