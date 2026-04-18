"""Unit tests for sanitize_oem — no DB or Telegram required."""

from bot.parsers.message_parser import sanitize_oem


class TestSanitizeOem:
    # ── Float-serialised integers (the target bug) ────────────────────────────

    def test_strips_dot_zero_from_numeric_string(self):
        assert sanitize_oem("2073035100.0") == "2073035100"

    def test_strips_dot_zero_from_float_value(self):
        assert sanitize_oem(2073035100.0) == "2073035100"

    def test_strips_dot_zero_short_code(self):
        assert sanitize_oem("8390132500.0") == "8390132500"

    def test_strips_dot_zero_negative_integer(self):
        assert sanitize_oem("-42.0") == "-42"

    # ── Non-float OEM codes left unchanged ───────────────────────────────────

    def test_plain_integer_string_unchanged(self):
        assert sanitize_oem("2073035100") == "2073035100"

    def test_alphanumeric_code_unchanged(self):
        assert sanitize_oem("ABC-123") == "ABC-123"

    def test_code_with_meaningful_decimal_unchanged(self):
        """'1.5' is not an integer float — do not strip."""
        assert sanitize_oem("1.5") == "1.5"

    def test_code_ending_dot_zero_but_not_integer_unchanged(self):
        """'12A.0' has non-digit chars before .0 — leave as-is."""
        assert sanitize_oem("12A.0") == "12A.0"

    # ── Whitespace handling ───────────────────────────────────────────────────

    def test_strips_whitespace(self):
        assert sanitize_oem("  2073035100.0  ") == "2073035100"

    def test_strips_whitespace_plain(self):
        assert sanitize_oem("  ABC123  ") == "ABC123"

    # ── Empty / null inputs ───────────────────────────────────────────────────

    def test_none_returns_none(self):
        assert sanitize_oem(None) is None

    def test_empty_string_returns_none(self):
        assert sanitize_oem("") is None

    def test_whitespace_only_returns_none(self):
        assert sanitize_oem("   ") is None

    def test_nan_string_returns_none(self):
        assert sanitize_oem("nan") is None

    def test_nan_mixed_case_returns_none(self):
        assert sanitize_oem("NaN") is None

    def test_none_string_returns_none(self):
        assert sanitize_oem("None") is None
