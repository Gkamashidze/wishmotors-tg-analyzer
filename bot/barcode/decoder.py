"""Barcode decoding and part-name extraction from label photos.

decode_barcode()    — synchronous; run in an executor (CPU-bound).
extract_part_info() — async; calls Claude Vision to OCR + translate the label.
"""
from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import Optional

import config

logger = logging.getLogger(__name__)


def decode_barcode(image_bytes: bytes) -> Optional[str]:
    """Decode the first readable barcode in the image. Returns the raw text or None."""
    try:
        import zxingcpp
        from PIL import Image

        img = Image.open(BytesIO(image_bytes))
        results = zxingcpp.read_barcodes(img)
        for r in results:
            text = r.text.strip()
            if text:
                return text
    except Exception as exc:
        logger.warning("Barcode decode failed: %s", exc)
    return None


async def extract_part_info(image_bytes: bytes) -> tuple[str, str]:
    """Use Claude Vision (Haiku) to extract and translate the part name from a label.

    Returns (name_ka, name_en). Both are empty strings on failure or missing key.
    """
    if not config.ANTHROPIC_API_KEY:
        return "", ""
    try:
        import anthropic

        b64 = base64.standard_b64encode(image_bytes).decode()
        client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
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
                                "media_type": "image/jpeg",
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
        raw = getattr(response.content[0], "text", "").strip()
        parts = raw.split("|", 1)
        name_en = parts[0].strip()
        name_ka = parts[1].strip() if len(parts) > 1 else ""
        return name_ka, name_en
    except Exception as exc:
        logger.warning("Claude Vision part-name extraction failed: %s", exc)
        return "", ""
