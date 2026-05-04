"""Barcode decoding and part-name extraction from label photos.

decode_barcode()       — synchronous; run in an executor (CPU-bound).
extract_part_info()    — async; name-only extraction via Claude Vision.
extract_from_label()   — async; full fallback: OEM code + name via Claude Vision.
"""

from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import Any, Literal, Optional

import config

logger = logging.getLogger(__name__)

# Module-level singleton — one HTTP connection pool for the lifetime of the process.
_anthropic_client: Optional[Any] = None


def _get_anthropic_client() -> Optional[Any]:
    global _anthropic_client
    if not config.ANTHROPIC_API_KEY:
        return None
    if _anthropic_client is None:
        try:
            import anthropic

            _anthropic_client = anthropic.AsyncAnthropic(
                api_key=config.ANTHROPIC_API_KEY
            )
        except ImportError:
            logger.warning(
                "`anthropic` package not installed — barcode AI extraction unavailable."
            )
    return _anthropic_client


def decode_barcode(image_bytes: bytes) -> Optional[str]:
    """Decode the first readable barcode using zxingcpp.

    Tries multiple image variants (original, grayscale, sharpened, upscaled)
    to improve detection on low-quality/compressed phone photos.
    Returns the raw text or None.
    """
    try:
        import zxingcpp
        from PIL import Image, ImageEnhance, ImageFilter

        img = Image.open(BytesIO(image_bytes))

        # Try 1: original
        result = _zxing_first(zxingcpp.read_barcodes(img))
        if result:
            return result

        # Try 2: grayscale
        gray = img.convert("L")
        result = _zxing_first(zxingcpp.read_barcodes(gray))
        if result:
            return result

        # Try 3: sharpen + contrast — helps with blurry/dark photos
        sharpened = ImageEnhance.Contrast(gray).enhance(2.0).filter(ImageFilter.SHARPEN)
        result = _zxing_first(zxingcpp.read_barcodes(sharpened))
        if result:
            return result

        # Try 4: scale up small images (barcodes on labels are often tiny)
        if max(img.size) < 1000:
            big = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
            result = _zxing_first(zxingcpp.read_barcodes(big))
            if result:
                return result

    except Exception as exc:
        logger.warning("Barcode decode failed: %s", exc)
    return None


def _zxing_first(results: list) -> Optional[str]:  # type: ignore[type-arg]
    for r in results:
        text = r.text.strip()
        if text:
            return text
    return None


def _detect_media_type(
    image_bytes: bytes,
) -> Literal["image/jpeg", "image/png", "image/gif", "image/webp"]:
    """Detect image MIME type from magic bytes."""
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


async def extract_part_info(image_bytes: bytes) -> tuple[str, str]:
    """Claude Vision (Haiku): extract and translate the part name from a label.

    Returns (name_ka, name_en). Both empty strings on failure.
    Used when the barcode was already decoded and only the name is needed.
    """
    client = _get_anthropic_client()
    if client is None:
        return "", ""
    try:
        b64 = base64.standard_b64encode(image_bytes).decode()
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": _detect_media_type(image_bytes),
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "This is an auto part label. "
                                "Find the part name or description written in English. "
                                "Reply ONLY in this exact format: english_name | georgian_translation\n"
                                "Example: Front Control Arm | წინა ბერკეტი\n"
                                "If no part name is visible, reply: | "
                            ),
                        },
                    ],
                }
            ],
        )
        usage = response.usage
        logger.info(
            "extract_part_info tokens: in=%d out=%d",
            usage.input_tokens,
            usage.output_tokens,
        )
        raw = getattr(response.content[0], "text", "").strip()
        parts = raw.split("|", 1)
        name_en = parts[0].strip()
        name_ka = parts[1].strip() if len(parts) > 1 else ""
        return name_ka, name_en
    except Exception as exc:
        logger.warning(
            "Claude Vision part-name extraction failed (%s): %s",
            type(exc).__name__,
            exc,
        )
        return "", ""


async def extract_from_label(image_bytes: bytes) -> tuple[str, str, str]:
    """Claude Vision fallback: extract OEM code + part name when zxingcpp fails.

    Returns (oem, name_ka, name_en). All empty strings on failure.
    Used when the barcode scan fails (e.g. due to Telegram JPEG compression).
    """
    client = _get_anthropic_client()
    if client is None:
        return "", "", ""
    try:
        b64 = base64.standard_b64encode(image_bytes).decode()
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": _detect_media_type(image_bytes),
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "This is an auto part label photo. Find:\n"
                                "1. The OEM/part number printed on the label "
                                "(digits/letters near the barcode, e.g. '45201-06290')\n"
                                "2. The part name in English\n"
                                "3. Georgian translation of the part name\n\n"
                                "Reply ONLY in this exact format:\n"
                                "oem_code | english_name | georgian_name\n"
                                "Examples:\n"
                                "  45201-06290 | Front Control Arm | წინა ბერკეტი\n"
                                "  8390132500 | Oil Filter | ზეთის ფილტრი\n"
                                "Leave a field empty if not visible:\n"
                                "  | Control Arm | ბერკეტი\n"
                                "If nothing is readable: | | "
                            ),
                        },
                    ],
                }
            ],
        )
        usage = response.usage
        logger.info(
            "extract_from_label tokens: in=%d out=%d",
            usage.input_tokens,
            usage.output_tokens,
        )
        raw = getattr(response.content[0], "text", "").strip()
        parts = raw.split("|", 2)
        oem = parts[0].strip() if len(parts) > 0 else ""
        name_en = parts[1].strip() if len(parts) > 1 else ""
        name_ka = parts[2].strip() if len(parts) > 2 else ""
        return oem, name_ka, name_en
    except Exception as exc:
        logger.warning(
            "Claude Vision full label extraction failed (%s): %s",
            type(exc).__name__,
            exc,
        )
        return "", "", ""
