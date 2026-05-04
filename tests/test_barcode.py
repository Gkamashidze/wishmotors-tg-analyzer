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

import bot.barcode.decoder as _decoder_mod  # noqa: E402
from bot.handlers.barcode import _bc_cache, _bc_get, _bc_set, bc_consume  # noqa: E402


# ─── Cache helpers ────────────────────────────────────────────────────────────


def setup_function():
    _bc_cache.clear()
    # Reset Anthropic singleton so each test starts with a fresh mock client.
    _decoder_mod._anthropic_client = None


@pytest.mark.asyncio
async def test_bc_set_and_get():
    await _bc_set(1, oem="ABC123", name_ka="სარკე", name_en="Mirror", status="ready")
    entry = await _bc_get(1)
    assert entry is not None
    assert entry["oem"] == "ABC123"
    assert entry["status"] == "ready"


@pytest.mark.asyncio
async def test_bc_get_expired():
    _bc_cache[2] = {"oem": "X", "status": "ready", "expires": time.monotonic() - 1}
    assert await _bc_get(2) is None
    assert 2 not in _bc_cache


@pytest.mark.asyncio
async def test_bc_consume_ready():
    await _bc_set(3, oem="OEM001", name_ka="სარკე", name_en="Mirror", status="ready")
    entry = await bc_consume(3)
    assert entry is not None
    assert entry["oem"] == "OEM001"
    assert await _bc_get(3) is None  # consumed


@pytest.mark.asyncio
async def test_bc_consume_not_ready():
    await _bc_set(4, oem="OEM002", name_ka="", name_en="", status="confirming")
    assert await bc_consume(4) is None
    assert await _bc_get(4) is not None  # not removed


@pytest.mark.asyncio
async def test_bc_consume_missing():
    assert await bc_consume(999) is None


# ─── decode_barcode ───────────────────────────────────────────────────────────


def _make_sys_modules_patch(zxing_results=None, zxing_side_effect=None):
    """Build sys.modules patches for zxingcpp and PIL needed by decode_barcode."""
    # PIL mock: supports Image.open(), .convert(), .filter(), .resize(), ImageEnhance, ImageFilter
    mock_img = MagicMock()
    mock_img.size = (500, 500)
    mock_img.width = 500
    mock_img.height = 500
    mock_img.convert.return_value = mock_img
    mock_img.filter.return_value = mock_img
    mock_img.resize.return_value = mock_img

    mock_enhance_instance = MagicMock()
    mock_enhance_instance.enhance.return_value = mock_img

    mock_image_cls = MagicMock()
    mock_image_cls.open.return_value = mock_img
    mock_image_cls.Resampling = MagicMock()

    mock_imageenhance = MagicMock()
    mock_imageenhance.Contrast.return_value = mock_enhance_instance

    mock_imagefilter = MagicMock()

    mock_pil = MagicMock()
    mock_pil.Image = mock_image_cls
    mock_pil.ImageEnhance = mock_imageenhance
    mock_pil.ImageFilter = mock_imagefilter

    # zxingcpp mock
    mock_zx = MagicMock()
    if zxing_side_effect:
        mock_zx.read_barcodes.side_effect = zxing_side_effect
    else:
        mock_zx.read_barcodes.return_value = zxing_results or []

    return {
        "zxingcpp": mock_zx,
        "PIL": mock_pil,
        "PIL.Image": mock_image_cls,
        "PIL.ImageEnhance": mock_imageenhance,
        "PIL.ImageFilter": mock_imagefilter,
    }


def test_decode_barcode_success():
    mock_result = MagicMock()
    mock_result.text = " 8390132500 "
    patches = _make_sys_modules_patch(zxing_results=[mock_result])

    with patch.dict("sys.modules", patches):
        from bot.barcode.decoder import decode_barcode

        result = decode_barcode(b"fake_image_bytes")

    assert result == "8390132500"


def test_decode_barcode_no_results():
    patches = _make_sys_modules_patch(zxing_results=[])

    with patch.dict("sys.modules", patches):
        from bot.barcode.decoder import decode_barcode

        result = decode_barcode(b"fake_image_bytes")

    assert result is None


def test_decode_barcode_exception_returns_none():
    patches = _make_sys_modules_patch(zxing_side_effect=RuntimeError("zxing error"))

    with patch.dict("sys.modules", patches):
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


# ─── _detect_media_type ───────────────────────────────────────────────────────


def test_detect_media_type_jpeg():
    from bot.barcode.decoder import _detect_media_type

    assert _detect_media_type(b"\xff\xd8\xff" + b"\x00" * 10) == "image/jpeg"


def test_detect_media_type_png():
    from bot.barcode.decoder import _detect_media_type

    assert _detect_media_type(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10) == "image/png"


def test_detect_media_type_webp():
    from bot.barcode.decoder import _detect_media_type

    assert _detect_media_type(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00") == "image/webp"


# ─── extract_from_label ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_extract_from_label_success():
    mock_ant = _make_anthropic_module("45201-06290 | Front Control Arm | წინა ბერკეტი")

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_from_label

        oem, name_ka, name_en = await extract_from_label(b"fake_jpeg")

    assert oem == "45201-06290"
    assert name_en == "Front Control Arm"
    assert name_ka == "წინა ბერკეტი"


@pytest.mark.asyncio
async def test_extract_from_label_oem_only():
    mock_ant = _make_anthropic_module("8390132500 | | ")

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_from_label

        oem, name_ka, name_en = await extract_from_label(b"fake_jpeg")

    assert oem == "8390132500"
    assert name_ka == ""
    assert name_en == ""


@pytest.mark.asyncio
async def test_extract_from_label_nothing_found():
    mock_ant = _make_anthropic_module("| | ")

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_from_label

        oem, name_ka, name_en = await extract_from_label(b"fake_jpeg")

    assert oem == ""
    assert name_ka == ""
    assert name_en == ""


@pytest.mark.asyncio
async def test_extract_from_label_no_api_key():
    with patch("bot.barcode.decoder.config") as mock_cfg:
        mock_cfg.ANTHROPIC_API_KEY = None
        from bot.barcode.decoder import extract_from_label

        oem, name_ka, name_en = await extract_from_label(b"fake_jpeg")

    assert oem == ""
    assert name_ka == ""
    assert name_en == ""


@pytest.mark.asyncio
async def test_extract_from_label_api_error():
    mock_ant = _make_anthropic_module(side_effect=Exception("API timeout"))

    with (
        patch("bot.barcode.decoder.config") as mock_cfg,
        patch.dict("sys.modules", {"anthropic": mock_ant}),
    ):
        mock_cfg.ANTHROPIC_API_KEY = "test-key"
        from bot.barcode.decoder import extract_from_label

        oem, name_ka, name_en = await extract_from_label(b"fake_jpeg")

    assert oem == ""
    assert name_ka == ""
    assert name_en == ""
