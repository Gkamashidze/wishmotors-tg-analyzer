# Testing Fixes — Copy-Paste Ready

---

## Fix #1 — test_sales_handler.py scaffold

```python
# tests/test_sales_handler.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from aiogram.types import Message

from bot.handlers.sales import handle_sales_text


@pytest.fixture
def mock_message():
    msg = AsyncMock(spec=Message)
    msg.message_thread_id = 111  # SALES_TOPIC_ID
    msg.from_user = MagicMock(id=1, full_name="Test User")
    msg.reply = AsyncMock()
    msg.answer = AsyncMock()
    return msg


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.create_sale.return_value = {"id": 1, "total": 100.0}
    db.get_product_by_oem.return_value = {"id": 1, "name": "Test Part", "oem": "OEM123"}
    return db


@pytest.mark.asyncio
async def test_single_sale_success(mock_message, mock_db):
    mock_message.text = "OEM123 2 ც 50 ₾"
    await handle_sales_text(mock_message, db=mock_db)
    mock_db.create_sale.assert_called_once()
    mock_message.reply.assert_called_once()


@pytest.mark.asyncio
async def test_return_detected(mock_message, mock_db):
    mock_message.text = "OEM123 1 ც დაბრუნება"
    await handle_sales_text(mock_message, db=mock_db)
    mock_db.create_return.assert_called_once()


@pytest.mark.asyncio
async def test_unknown_oem_logs_parse_failure(mock_message, mock_db):
    mock_db.get_product_by_oem.return_value = None
    mock_message.text = "UNKNOWN999 1 ც 25 ₾"
    await handle_sales_text(mock_message, db=mock_db)
    mock_db.log_parse_failure.assert_called_once()
```

---

## Fix #2 — test_financial_ai.py scaffold

```python
# tests/test_financial_ai.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from bot.financial_ai.analyzer import generate_weekly_advice
from bot.financial_ai.data_access import FinancialSnapshot


@pytest.fixture
def empty_snapshot():
    return FinancialSnapshot(
        total_revenue=0.0,
        total_expenses=0.0,
        total_returns=0.0,
        net_profit=0.0,
        top_products=[],
        pending_orders_count=0,
    )


@pytest.fixture
def real_snapshot():
    return FinancialSnapshot(
        total_revenue=5000.0,
        total_expenses=1200.0,
        total_returns=150.0,
        net_profit=3650.0,
        top_products=[("OEM001", 10), ("OEM002", 8)],
        pending_orders_count=3,
    )


@pytest.mark.asyncio
async def test_returns_none_on_empty_snapshot(empty_snapshot):
    result = await generate_weekly_advice(empty_snapshot)
    assert result is None  # no signal → no AI call


@pytest.mark.asyncio
async def test_api_timeout_returns_none(real_snapshot):
    with patch("bot.financial_ai.analyzer.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = Exception("timeout")
        result = await generate_weekly_advice(real_snapshot)
    assert result is None  # graceful degradation


@pytest.mark.asyncio
async def test_cache_hit_skips_api_call(real_snapshot):
    with patch("bot.financial_ai.analyzer.AsyncAnthropic") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text="test advice")]
        )
        await generate_weekly_advice(real_snapshot)
        await generate_weekly_advice(real_snapshot)  # second call
    # API called only once due to cache
    assert mock_client.messages.create.call_count == 1
```

---

## Fix #3 — Dashboard vitest scaffold (dashboard/__tests__/api.test.ts)

```ts
// dashboard/__tests__/api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module
vi.mock("../lib/db", () => ({
  query: vi.fn(),
}))

import { query } from "../lib/db"

describe("GET /api/dashboard/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns summary data on success", async () => {
    const mockQuery = query as ReturnType<typeof vi.fn>
    mockQuery.mockResolvedValue({ rows: [{ total_revenue: 5000 }] })

    // Import and call the handler directly
    const { GET } = await import("../app/api/dashboard/summary/route")
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty("total_revenue")
  })

  it("returns 500 on db error without leaking details", async () => {
    const mockQuery = query as ReturnType<typeof vi.fn>
    mockQuery.mockRejectedValue(new Error("relation does not exist"))

    const { GET } = await import("../app/api/dashboard/summary/route")
    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe("internal error")  // must not leak DB error
    expect(data.error).not.toContain("relation")
  })
})
```

---

## Fix #4 — asyncio.create_task reference tracking (database/db.py)

```python
# database/db.py — add near the top of the Database class

_audit_tasks: set[asyncio.Task] = set()  # prevent GC before completion

def _audit(self, *args, **kwargs) -> None:
    if self.audit is None:
        return
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(self.audit.log_safe(*args, **kwargs))
        self._audit_tasks.add(task)
        task.add_done_callback(self._audit_tasks.discard)
    except RuntimeError:
        pass  # no running loop during startup
```
