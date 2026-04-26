"""Tests for barcode decoder and barcode cache helpers."""
from __future__ import annotations

import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Minimal env so config.py loads without errors
os.environ.setdefault("BOT_TOKEN", "test")
os.environ.setdefault("GROUP_ID", "1")
os.environ.setdefault("SALES_TOPIC_ID", "2")
os.environ.setdefault("ORDERS_TOPIC_ID", "3")
os.environ.setdefault("EXPENSES_TOPIC_ID", "4")
os.environ.setdefault("STOCK_TOPIC_ID", "5")
os.environ.setdefault("NISIAS_TOPIC_ID", "6")
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/test")
os.environ.setdefault("ADMIN_IDS", "12345")
os.environ.setdefault("TIMEZONE", "Asia/Tbilisi")

from bot.handlers.barcode import _bc_cache, _bc_get, _bc_set, bc_consume  # noqa: E402


# ─── Cache helpers ────────────────────────────────────────────────────────────

def setup_function():
    _bc_cache.clear()


def test_bc_set_and_get():
    _bc_set(1, oem="ABC123", name_ka="სარკე", name_en="Mirror", status="ready")
    entry = _bc_get(1)
    assert entry is not None
    assert entry["oem"] == "ABC123"
    assert entry["status"] == "ready"


def test_bc_get_expired():
    _bc_cache[2] = {"oem": "X", "status": "ready", "expires": time.monotonic() - 1}
    assert _bc_get(2) is None
    assert 2 not in _bc_cache


def test_bc_consume_ready():
    _bc_set(3, oem="OEM001", name_ka="სარკე", name_en="Mirror", status="ready")
    entry = bc_consume(3)
    assert entry is not None
    assert entry["oem"] == "OEM001"
    assert _bc_get(3) is None  # consumed


def test_bc_consume_not_ready():
    _bc_set(4, oem="OEM002", name_ka="", name_en="", status="confirming")
    assert bc_consume(4) is None
    assert _bc_get(4) is not None  # not removed


def test_bc_consume_missing():
    assert bc_consume(999) is None


# ─── decode_barcode ───────────────────────────────────────────────────────────

def _make_barcode_modules(results=None, side_effect=None):
    """Return (mock_zx, mock_pil) for patching sys.modules inside decode_barcode."""
    mock_zx = MagicMock()
    if side_effect:
        mock_zx.read_barcodes.side_effect = side_effect
    else:
        mock_zx.read_barcodes.return_value = results or []

    mock_pil = MagicMock()
    mock_pil_image = MagicMock()
    mock_pil.Image = mock_pil_image
    return mock_zx, mock_pil, mock_pil_image


def test_decode_barcode_success():
    mock_result = MagicMock()
    mock_result.text = " 8390132500 "
    mock_zx, mock_pil, mock_pil_image = _make_barcode_modules(results=[mock_result])

    with patch.dict("sys.modules", {"zxingcpp": mock_zx, "PIL": mock_pil, "PIL.Image": mock_pil_image}):
        from bot.barcode.decoder import decode_barcode

        result = decode_barcode(b"fake_image_bytes")

    assert result == "8390132500"


def test_decode_barcode_no_results():
    mock_zx, mock_pil, mock_pil_image = _make_barcode_modules(results=[])

    with patch.dict("sys.modules", {"zxingcpp": mock_zx, "PIL": mock_pil, "PIL.Image": mock_pil_image}):
        from bot.barcode.decoder import decode_barcode

        result = decode_barcode(b"fake_image_bytes")

    assert result is None


def test_decode_barcode_exception_returns_none():
    mock_zx, mock_pil, mock_pil_image = _make_barcode_modules(side_effect=RuntimeError("zxing error"))

    with patch.dict("sys.modules", {"zxingcpp": mock_zx, "PIL": mock_pil, "PIL.Image": mock_pil_image}):
        from bot.barcode.decoder import decode_barcode

        result = decode_barcode(b"bad_bytes")

    assert result is None


# ─── extract_part_info ────────────────────────────────────────────────────────

def _make_anthropic_module(response_text=None, side_effect=None):
    """Return a mock anthropic module for patching sys.modules."""
    mock_client = MagicMock()
    if side_effect:
        mock_client.messages.create = AsyncMock(side_effect=side_effect)
    else:
        mock_resp = MagicMock()
        mock_resp.content = [MagicMock(text=response_text or "| ")]
        mock_client.messages.create = AsyncMock(return_value=mock_resp)

    mock_ant = MagicMock()
    mock_ant.AsyncAnthropic.return_value = mock_client
    return mock_ant


@pytest.mark.asyncio
async def test_extract_part_info_success():
    mock_ant = _make_anthropic_module("Front Control Arm | წინა ბერკეტი")

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_part_info

        name_ka, name_en = await extract_part_info(b"fake_jpeg")

    assert name_ka == "წინა ბერკეტი"
    assert name_en == "Front Control Arm"


@pytest.mark.asyncio
async def test_extract_part_info_no_api_key():
    with patch("bot.barcode.decoder.config") as mock_cfg:
        mock_cfg.ANTHROPIC_API_KEY = None
        from bot.barcode.decoder import extract_part_info

        name_ka, name_en = await extract_part_info(b"fake_jpeg")

    assert name_ka == ""
    assert name_en == ""


@pytest.mark.asyncio
async def test_extract_part_info_api_error():
    mock_ant = _make_anthropic_module(side_effect=Exception("API error"))

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_part_info

        name_ka, name_en = await extract_part_info(b"fake_jpeg")

    assert name_ka == ""
    assert name_en == ""


@pytest.mark.asyncio
async def test_extract_part_info_empty_response():
    mock_ant = _make_anthropic_module("| ")

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_part_info

        name_ka, name_en = await extract_part_info(b"fake_jpeg")

    assert name_ka == ""
    assert name_en == ""
