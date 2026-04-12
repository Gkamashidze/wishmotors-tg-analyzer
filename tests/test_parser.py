"""
Unit tests for bot/parsers/message_parser.py
No external dependencies — runs without a database or Telegram connection.
"""

from bot.parsers.message_parser import (
    PAYMENT_CASH,
    PAYMENT_CREDIT,
    PAYMENT_TRANSFER,
    parse_batch_sales,
    parse_dual_sale_message,
    parse_expense_message,
    parse_order_message,
    parse_sale_message,
)


# ─── parse_sale_message — basic patterns ─────────────────────────────────────

class TestParseSaleMessage:
    def test_pattern_a_cash_explicit(self):
        result = parse_sale_message("მარჭვენა რეფლექტორი 1ც 30₾ ხელზე")
        assert result is not None
        assert result.raw_product == "მარჭვენა რეფლექტორი"
        assert result.quantity == 1
        assert result.price == 30.0
        assert result.payment_method == PAYMENT_CASH
        assert result.is_return is False

    def test_pattern_a_transfer_gadaricxva(self):
        result = parse_sale_message("8390132500 2ც 45₾ გადარიცხვა")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 2
        assert result.price == 45.0
        assert result.payment_method == PAYMENT_TRANSFER

    def test_pattern_a_transfer_daritxa(self):
        """დარიცხა keyword → transfer."""
        result = parse_sale_message("სარკე 1ც 30₾ დარიცხა")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER

    def test_pattern_a_no_payment_defaults_to_credit(self):
        """No payment keyword → ნისია (credit), NOT cash."""
        result = parse_sale_message("სარკე 3ც 20₾")
        assert result is not None
        assert result.payment_method == PAYMENT_CREDIT

    def test_pattern_a_lari_symbol_variant(self):
        """Accepts ლ as well as ₾."""
        result = parse_sale_message("ფარი 1ც 100ლ")
        assert result is not None
        assert result.price == 100.0

    def test_pattern_b_explicit_code_prefix(self):
        result = parse_sale_message("კოდი: 8390132500, 1ც, 35₾")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 1
        assert result.price == 35.0
        assert result.payment_method == PAYMENT_CREDIT  # no payment = credit

    def test_pattern_b_with_payment_transfer(self):
        result = parse_sale_message("კოდი: ABC123, 2ც, 80₾, გადარიცხვა")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER

    def test_return_flag_detected(self):
        result = parse_sale_message("დაბრუნება მარჭვენა რეფლექტორი 1ც 30₾")
        assert result is not None
        assert result.is_return is True

    def test_return_word_exchange(self):
        result = parse_sale_message("გაცვლა სარკე 2ც 50₾")
        assert result is not None
        assert result.is_return is True

    def test_unrecognised_returns_none(self):
        assert parse_sale_message("გამარჯობა") is None
        assert parse_sale_message("") is None
        assert parse_sale_message("123") is None

    def test_multiword_product_name(self):
        result = parse_sale_message("წინა მარჯვენა ფარი 1ც 150₾ ხელზე")
        assert result is not None
        assert result.raw_product == "წინა მარჯვენა ფარი"

    def test_decimal_price(self):
        result = parse_sale_message("ნათურა 1ც 12.50₾")
        assert result is not None
        assert result.price == 12.50

    def test_quantity_greater_than_one(self):
        result = parse_sale_message("ბოლტი 10ც 5₾")
        assert result is not None
        assert result.quantity == 10

    def test_whitespace_stripped(self):
        result = parse_sale_message("  სარკე 1ც 30₾  ")
        assert result is not None
        assert result.raw_product == "სარკე"


# ─── parse_sale_message — payment methods ────────────────────────────────────

class TestPaymentMethods:
    def test_baraTi_maps_to_transfer(self):
        """ბარათი should be transfer, not unknown."""
        result = parse_sale_message("ნათურა 1ც 10₾ ბარათი")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER

    def test_karti_maps_to_transfer(self):
        result = parse_sale_message("სარკე 1ც 30₾ კარტი")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER

    def test_naRdi_maps_to_cash(self):
        result = parse_sale_message("სარკე 1ც 30₾ ნაღდი")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH

    def test_empty_payment_is_credit(self):
        result = parse_sale_message("სარკე 1ც 30₾")
        assert result is not None
        assert result.payment_method == PAYMENT_CREDIT


# ─── parse_sale_message — seller type ────────────────────────────────────────

class TestSellerType:
    def test_no_keyword_is_individual(self):
        result = parse_sale_message("სარკე 1ც 30₾ ხელზე")
        assert result is not None
        assert result.seller_type == "individual"

    def test_shpsdan_keyword_is_llc(self):
        result = parse_sale_message("სარკე 1ც 30₾ ხელზე შპსდან")
        assert result is not None
        assert result.seller_type == "llc"
        assert result.payment_method == PAYMENT_CASH

    def test_shps_dash_dan_keyword_is_llc(self):
        result = parse_sale_message("სარკე 1ც 30₾ შპს-დან")
        assert result is not None
        assert result.seller_type == "llc"

    def test_llc_without_payment_is_credit(self):
        result = parse_sale_message("სარკე 1ც 30₾ შპსდან")
        assert result is not None
        assert result.seller_type == "llc"
        assert result.payment_method == PAYMENT_CREDIT

    def test_llc_with_transfer(self):
        result = parse_sale_message("სარკე 1ც 30₾ დარიცხა შპსდან")
        assert result is not None
        assert result.seller_type == "llc"
        assert result.payment_method == PAYMENT_TRANSFER


# ─── parse_sale_message — customer name ──────────────────────────────────────

class TestCustomerName:
    def test_no_customer(self):
        result = parse_sale_message("სარკე 1ც 30₾ ხელზე")
        assert result is not None
        assert result.customer_name == ""

    def test_customer_after_payment(self):
        result = parse_sale_message("სარკე 1ც 30₾ ხელზე გიო")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH
        assert result.customer_name == "გიო"

    def test_customer_credit_no_keyword(self):
        """Unknown word after price → credit + customer name."""
        result = parse_sale_message("სარკე 1ც 30₾ გიო")
        assert result is not None
        assert result.payment_method == PAYMENT_CREDIT
        assert result.customer_name == "გიო"

    def test_customer_with_llc(self):
        result = parse_sale_message("სარკე 1ც 30₾ ხელზე შპსდან გიო")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH
        assert result.seller_type == "llc"
        assert result.customer_name == "გიო"

    def test_customer_llc_credit(self):
        result = parse_sale_message("სარკე 1ც 30₾ შპსდან გიო")
        assert result is not None
        assert result.payment_method == PAYMENT_CREDIT
        assert result.seller_type == "llc"
        assert result.customer_name == "გიო"


# ─── parse_sale_message — format variations ──────────────────────────────────

class TestFormatVariations:
    def test_slash_separator_between_qty_and_price(self):
        result = parse_sale_message("სარკე 1ც/30₾")
        assert result is not None
        assert result.quantity == 1
        assert result.price == 30.0

    def test_comma_price(self):
        result = parse_sale_message("სარკე 1ც 12,50₾")
        assert result is not None
        assert result.price == 12.50

    def test_emoji_prefix_stripped(self):
        result = parse_sale_message("🔧 სარკე 1ც 30₾ ხელზე")
        assert result is not None
        assert result.raw_product == "სარკე"
        assert result.price == 30.0

    def test_emoji_suffix_stripped(self):
        result = parse_sale_message("სარკე 1ც 30₾ ✅")
        assert result is not None


# ─── parse_sale_message — price-only shorthand (Pattern C) ───────────────────

class TestPriceOnlyPattern:
    """Real-world format: '30ლ ხელზე' — price + payment, no product/qty."""

    def test_price_cash(self):
        result = parse_sale_message("30ლ ხელზე")
        assert result is not None
        assert result.price == 30.0
        assert result.quantity == 1
        assert result.payment_method == PAYMENT_CASH
        assert result.raw_product == ""

    def test_price_transfer(self):
        result = parse_sale_message("40ლ ხელზე")
        assert result is not None
        assert result.price == 40.0
        assert result.payment_method == PAYMENT_CASH

    def test_price_daritxa(self):
        result = parse_sale_message("90 ლ დარიცხა")
        assert result is not None
        assert result.price == 90.0
        assert result.payment_method == PAYMENT_TRANSFER

    def test_price_with_lari_symbol(self):
        result = parse_sale_message("150ლ ხელზე")
        assert result is not None
        assert result.price == 150.0

    def test_price_no_payment_is_credit(self):
        result = parse_sale_message("200ლ")
        assert result is not None
        assert result.price == 200.0
        assert result.payment_method == PAYMENT_CREDIT

    def test_price_decimal(self):
        result = parse_sale_message("12,50ლ ხელზე")
        assert result is not None
        assert result.price == 12.50


# ─── parse_expense_message ────────────────────────────────────────────────────

class TestParseExpenseMessage:
    def test_amount_first(self):
        result = parse_expense_message("50₾ ბენზინი")
        assert result is not None
        assert result.amount == 50.0
        assert result.description == "ბენზინი"

    def test_description_first(self):
        result = parse_expense_message("ბენზინი 50₾")
        assert result is not None
        assert result.amount == 50.0
        assert result.description == "ბენზინი"

    def test_lari_variant(self):
        result = parse_expense_message("100ლ ავტომობილი")
        assert result is not None
        assert result.amount == 100.0

    def test_decimal_amount(self):
        result = parse_expense_message("12.50₾ ყავა")
        assert result is not None
        assert result.amount == 12.50

    def test_comma_decimal(self):
        result = parse_expense_message("12,50₾ ყავა")
        assert result is not None
        assert result.amount == 12.50

    def test_multiword_description(self):
        result = parse_expense_message("მანქანის სერვისი 200₾")
        assert result is not None
        assert result.description == "მანქანის სერვისი"
        assert result.amount == 200.0

    def test_unrecognised_returns_none(self):
        assert parse_expense_message("გამარჯობა") is None
        assert parse_expense_message("") is None

    def test_whitespace_stripped(self):
        result = parse_expense_message("  50₾ ბენზინი  ")
        assert result is not None
        assert result.amount == 50.0

    def test_negative_shorthand_no_symbol(self):
        """'-11 დელივო' — real format used in expenses topic."""
        result = parse_expense_message("-11 დელივო")
        assert result is not None
        assert result.amount == 11.0
        assert result.description == "დელივო"

    def test_negative_shorthand_with_lari(self):
        result = parse_expense_message("-20ლ საბაჟო")
        assert result is not None
        assert result.amount == 20.0
        assert result.description == "საბაჟო"

    def test_negative_multiword_description(self):
        result = parse_expense_message("-11 დელივო გაგზავნის")
        assert result is not None
        assert result.amount == 11.0
        assert result.description == "დელივო გაგზავნის"

    def test_negative_decimal(self):
        result = parse_expense_message("-13.2 დელივო")
        assert result is not None
        assert result.amount == 13.2


# ─── parse_order_message ─────────────────────────────────────────────────────

class TestParseOrderMessage:
    def test_oem_code_order(self):
        result = parse_order_message("8390132500 5ც")
        assert result is not None
        assert result.raw_product == "8390132500"
        assert result.quantity == 5

    def test_product_name_order(self):
        result = parse_order_message("მარჭვენა სარკე 2ც")
        assert result is not None
        assert result.raw_product == "მარჭვენა სარკე"
        assert result.quantity == 2

    def test_single_word_product(self):
        result = parse_order_message("ნათურა 3ც")
        assert result is not None
        assert result.raw_product == "ნათურა"
        assert result.quantity == 3

    def test_unrecognised_returns_none(self):
        assert parse_order_message("") is None
        assert parse_order_message("12") is None     # bare number, no ც
        assert parse_order_message("ab") is None     # too short

    def test_whitespace_stripped(self):
        result = parse_order_message("  სარკე 1ც  ")
        assert result is not None
        assert result.raw_product == "სარკე"

    def test_qty_only_shorthand(self):
        """'20ც' alone — real format used as reply in orders topic."""
        result = parse_order_message("20ც")
        assert result is not None
        assert result.quantity == 20
        assert result.raw_product == ""

    def test_qty_only_various(self):
        assert parse_order_message("10ც") is not None
        assert parse_order_message("50ც") is not None


# ─── parse_sale_message — new real-world formats ─────────────────────────────

class TestRealWorldFormats:
    def test_product_price_credit_no_qty(self):
        """'სარკე 30₾' — product + price, no qty, no payment → credit, qty=1."""
        result = parse_sale_message("სარკე 30₾")
        assert result is not None
        assert result.raw_product == "სარკე"
        assert result.price == 30.0
        assert result.quantity == 1
        assert result.payment_method == PAYMENT_CREDIT

    def test_product_llc_in_product_field(self):
        """'უპორნები შპსდან 350ლ' — LLC keyword before price, no qty → llc, credit."""
        result = parse_sale_message("უპორნები შპსდან 350ლ")
        assert result is not None
        assert result.raw_product == "უპორნები"
        assert result.price == 350.0
        assert result.quantity == 1
        assert result.seller_type == "llc"
        assert result.payment_method == PAYMENT_CREDIT

    def test_product_no_currency_symbol(self):
        """'ხუნდები 50' — no ₾/ლ symbol → qty=1, credit."""
        result = parse_sale_message("ხუნდები 50")
        assert result is not None
        assert result.raw_product == "ხუნდები"
        assert result.price == 50.0
        assert result.quantity == 1
        assert result.payment_method == PAYMENT_CREDIT

    def test_split_payment_cash_plus_remaining(self):
        """'ხელზე 300 დარჩა 100ლ' → total=400₾, cash payment."""
        result = parse_sale_message("ხელზე 300 დარჩა 100ლ")
        assert result is not None
        assert result.price == 400.0
        assert result.payment_method == PAYMENT_CASH

    def test_split_payment_without_currency_on_remaining(self):
        """'ხელზე 200 დარჩა 50' — no ₾ on either amount."""
        result = parse_sale_message("ხელზე 200 დარჩა 50")
        assert result is not None
        assert result.price == 250.0
        assert result.payment_method == PAYMENT_CASH

    def test_phone_number_ignored(self):
        """'+995 ...' phone numbers must return None silently."""
        assert parse_sale_message("+995 592 15 90 52") is None
        assert parse_sale_message("+995-599-123456") is None

    def test_local_phone_number_ignored(self):
        """Georgian local mobile (9 digits, starts with 5) → None."""
        assert parse_sale_message("592159052") is None
        assert parse_sale_message("555123456") is None

    def test_llc_before_qty_in_pattern_a(self):
        """'სარკე შპსდან 2ც 80₾' — LLC keyword before quantity."""
        result = parse_sale_message("სარკე შპსდან 2ც 80₾")
        assert result is not None
        assert result.raw_product == "სარკე"
        assert result.seller_type == "llc"
        assert result.quantity == 2
        assert result.price == 80.0


# ─── ჯამში (total price) support ─────────────────────────────────────────────

class TestJumshiTotalPrice:
    def test_jumshi_divides_by_qty(self):
        """'136001 2ც ჯამში 360ლ' → unit price = 180."""
        result = parse_sale_message("136001 2ც ჯამში 360ლ")
        assert result is not None
        assert result.quantity == 2
        assert result.price == 180.0

    def test_jumshi_single_unit_stays_same(self):
        """'221002 1ც ჯამში 100ლ' → unit price = 100 (1/1)."""
        result = parse_sale_message("221002 1ც ჯამში 100ლ")
        assert result is not None
        assert result.quantity == 1
        assert result.price == 100.0

    def test_jumshi_credit_payment(self):
        """No payment keyword → credit (ნისია)."""
        result = parse_sale_message("09003 2ც ჯამში 280ლ")
        assert result is not None
        assert result.payment_method == PAYMENT_CREDIT

    def test_without_jumshi_unchanged(self):
        """Regular format still works — no regression."""
        result = parse_sale_message("136001 2ც 180ლ")
        assert result is not None
        assert result.price == 180.0


# ─── parse_batch_sales ────────────────────────────────────────────────────────

class TestParseBatchSales:
    # Each item in the returned list is: None (failed) | [ParsedSale, ...] (1 or 2 sales)

    def test_header_extracted_as_customer(self):
        """First line without price → customer name; rest are sales."""
        text = "იმედა:\nპადვესნოი 1ც 150ლ\n136001 2ც ჯამში 360ლ"
        name, items = parse_batch_sales(text)
        assert name == "იმედა"
        assert len(items) == 2
        assert all(i is not None for i in items)

    def test_customer_propagated_to_all_items(self):
        """Customer name from header applied to every line."""
        text = "გიო:\nსარკე 1ც 50ლ\nნათურა 2ც 30ლ"
        name, items = parse_batch_sales(text)
        assert name == "გიო"
        for item in items:
            assert item is not None
            assert item[0].customer_name == "გიო"

    def test_no_header_when_first_line_is_sale(self):
        """First line looks like a sale → no customer extracted."""
        text = "სარკე 1ც 50ლ\nნათურა 2ც 30ლ"
        name, items = parse_batch_sales(text)
        assert name is None
        assert len(items) == 2

    def test_unparseable_line_returns_none_entry(self):
        """Line that can't be parsed → None in the result list."""
        text = "გიო:\nსარკე 1ც 50ლ\nეს ვერ ამოიცნობება !!!"
        _, items = parse_batch_sales(text)
        assert items[0] is not None
        assert items[1] is None

    def test_jumshi_in_batch(self):
        """'ჯამში' format works correctly inside a batch."""
        text = "იმედა:\n136001 2ც ჯამში 360ლ\n209000 1ც 35ლ"
        name, items = parse_batch_sales(text)
        assert name == "იმედა"
        assert items[0] is not None
        assert items[0][0].price == 180.0   # 360 / 2
        assert items[1] is not None
        assert items[1][0].price == 35.0

    def test_empty_message_returns_empty(self):
        """Empty text → empty results."""
        _, items = parse_batch_sales("   \n  \n")
        assert items == []

    def test_header_without_colon(self):
        """Customer name without trailing colon also works."""
        text = "ლაშა\nსარკე 1ც 50ლ"
        name, items = parse_batch_sales(text)
        assert name == "ლაშა"
        assert len(items) == 1

    def test_dual_line_in_batch_produces_two_sales(self):
        """Dual format line in batch → two entries in results for that one line."""
        text = "იმედა:\n008b03 და 108000 1-1ც ჯამში 210\n209000 1ც 35ლ"
        name, items = parse_batch_sales(text)
        assert name == "იმედა"
        assert len(items) == 2          # 2 input lines → 2 items
        assert items[0] is not None
        assert len(items[0]) == 2       # dual → two ParsedSale objects
        assert items[1] is not None
        assert len(items[1]) == 1       # single sale

    def test_dual_customer_propagated(self):
        """Customer name from header is set on both halves of a dual sale."""
        text = "გიო:\n008b03 და 108000 1-1ც ჯამში 210"
        _, items = parse_batch_sales(text)
        assert items[0] is not None
        for sale in items[0]:
            assert sale.customer_name == "გიო"

    def test_phone_line_silently_skipped(self):
        """A standalone phone number line in a batch is ignored, not a failure."""
        text = "გიო:\nსარკე 1ც 50ლ\n592159052"
        _, items = parse_batch_sales(text)
        assert len(items) == 1          # only the sale; phone line dropped
        assert items[0] is not None

    def test_phone_and_name_as_header(self):
        """'592159052 ლაშა' as first line → treated as customer name header."""
        text = "592159052 ლაშა\nსარკე 1ც 50ლ"
        name, items = parse_batch_sales(text)
        assert name == "592159052 ლაშა"
        assert len(items) == 1


# ─── Payment-keyword-first format (Pattern G) ────────────────────────────────

class TestPaymentKeywordFirst:
    def test_momca_lari_symbol(self):
        """'მომცა 300₾' → cash payment, price 300, empty product."""
        result = parse_sale_message("მომცა 300₾")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH
        assert result.price == 300.0
        assert result.raw_product == ""

    def test_momca_lari_letter(self):
        """'მომცა 300ლ' → cash payment."""
        result = parse_sale_message("მომცა 300ლ")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH
        assert result.price == 300.0

    def test_momca_no_currency(self):
        """'მომცა 300' (no symbol) → cash payment."""
        result = parse_sale_message("მომცა 300")
        assert result is not None
        assert result.payment_method == PAYMENT_CASH
        assert result.price == 300.0

    def test_daritxa_transfer(self):
        """'დარიცხა 500₾' → transfer payment."""
        result = parse_sale_message("დარიცხა 500₾")
        assert result is not None
        assert result.payment_method == PAYMENT_TRANSFER
        assert result.price == 500.0

    def test_momca_in_batch(self):
        """'მომცა 300₾' inside a batch is parsed as cash, not a failed line."""
        text = "გიო:\nსარკე 1ც 50ლ\nმომცა 300₾"
        _, items = parse_batch_sales(text)
        assert len(items) == 2
        assert items[1] is not None
        assert items[1][0].payment_method == PAYMENT_CASH
        assert items[1][0].price == 300.0


# ─── parse_dual_sale_message ──────────────────────────────────────────────────

class TestParseDualSale:
    def test_basic_1_1_jumshi(self):
        """'008b03 და 108000 1-1ც ჯამში 210' → two sales, 105₾ each."""
        result = parse_dual_sale_message("008b03 და 108000 1-1ც ჯამში 210")
        assert result is not None
        assert len(result) == 2
        assert result[0].raw_product == "008b03"
        assert result[1].raw_product == "108000"
        assert result[0].quantity == 1
        assert result[1].quantity == 1
        assert result[0].price == 105.0
        assert result[1].price == 105.0

    def test_2_2_jumshi_lari(self):
        """'09003 და 09013 2-2ც ჯამში 280ლ' → unit price 70 each."""
        result = parse_dual_sale_message("09003 და 09013 2-2ც ჯამში 280ლ")
        assert result is not None
        assert result[0].quantity == 2
        assert result[1].quantity == 2
        assert result[0].price == 70.0
        assert result[1].price == 70.0

    def test_credit_payment_default(self):
        """No payment keyword → credit (ნისია)."""
        result = parse_dual_sale_message("a01 და b02 1-1ც ჯამში 200ლ")
        assert result is not None
        assert result[0].payment_method == PAYMENT_CREDIT
        assert result[1].payment_method == PAYMENT_CREDIT

    def test_no_currency_symbol(self):
        """Price without ₾/ლ still parsed (common in practice)."""
        result = parse_dual_sale_message("05010 და 008ba0 1-1ც ჯამში 210")
        assert result is not None
        assert result[0].price == 105.0

    def test_non_matching_returns_none(self):
        """Single-product line → None."""
        assert parse_dual_sale_message("სარკე 1ც 50ლ") is None

    def test_asymmetric_qty(self):
        """'1-2ც' — different quantities per product."""
        result = parse_dual_sale_message("a01 და b02 1-2ც ჯამში 300ლ")
        assert result is not None
        assert result[0].quantity == 1
        assert result[1].quantity == 2
        assert result[0].price == 150.0   # 300/2 / 1
        assert result[1].price == 75.0    # 300/2 / 2
