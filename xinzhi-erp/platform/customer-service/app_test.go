package main

import (
	"errors"
	"strings"
	"testing"
	"time"

	"shopify-support-platform/internal/appcore"
)

func TestEmailScanCutoffDefaultsToSevenDays(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	got := emailScanCutoffFromState(appcore.EmailScanState{}, now)
	want := "2026-06-15T10:00:00Z"
	if got != want {
		t.Fatalf("cutoff = %q, want %q", got, want)
	}
}

func TestEmailScanCutoffIgnoresSuccessfulScanTimestamp(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	got := emailScanCutoffFromState(appcore.EmailScanState{LastSuccessfulEmailScanAt: "2026-06-22T09:40:00Z"}, now)
	want := "2026-06-15T10:00:00Z"
	if got != want {
		t.Fatalf("cutoff = %q, want %q", got, want)
	}
}

func TestEmailScanCutoffKeepsSevenDayFloor(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	got := emailScanCutoffFromState(appcore.EmailScanState{LastSuccessfulEmailScanAt: "2026-06-01T09:40:00Z"}, now)
	want := "2026-06-15T10:00:00Z"
	if got != want {
		t.Fatalf("cutoff = %q, want %q", got, want)
	}
}

func TestOpenShopStatusUsesAnnotatedStatusOnly(t *testing.T) {
	shop := appcore.Shop{
		Status: "closed",
		Raw: map[string]any{
			"opened":  true,
			"running": true,
			"status":  "open",
		},
	}
	if isOpenShopStatus(shop) {
		t.Fatal("raw provider open fields must not override annotated local closed status")
	}
}

func TestOpenShopStatusAcceptsAnnotatedOpenStatus(t *testing.T) {
	if !isOpenShopStatus(appcore.Shop{Status: "open"}) {
		t.Fatal("annotated open status should be accepted")
	}
	if !isOpenShopStatus(appcore.Shop{Status: "running"}) {
		t.Fatal("annotated running status should be accepted")
	}
}

func TestShouldRecoverCDPConnectionRetriesTransientFailureOnce(t *testing.T) {
	err := errors.New("cdp_handshake_timeout: connectOverCDP did not finish within 8000ms")
	if !shouldRecoverCDPConnection(err, false) {
		t.Fatal("first CDP connection failure should trigger recovery")
	}
	if shouldRecoverCDPConnection(err, true) {
		t.Fatal("already recovered CDP connection should not retry indefinitely")
	}
}

func TestFriendlyReadErrorReportsCDPTimeoutAsIncompleteRead(t *testing.T) {
	err := cdpReadIncompleteError(errors.New("cdp_handshake_timeout: connectOverCDP did not finish within 8000ms"))
	got := friendlyReadError(err)
	if got != "浏览器连接超时，未完成读取" {
		t.Fatalf("unexpected friendly error: %q", got)
	}
}

func TestShouldRecoverCDPConnectionRejectsNonCDPFailure(t *testing.T) {
	err := errors.New("calibration failed: no structured unread rows found")
	if shouldRecoverCDPConnection(err, false) {
		t.Fatal("non-CDP parser failure should not trigger browser recovery")
	}
}

func TestRecommendableProductCardBlocksServiceLinks(t *testing.T) {
	blocked := []appcore.ProductCard{
		{Title: "Shipping Insurance", URL: "https://example.com/products/shipping-insurance"},
		{Title: "Support Animal Rescue", URL: "https://example.com/products/support-animal-rescue"},
		{Title: "Gift Card", URL: "https://example.com/products/gift-card"},
		{Title: "Package Protection", URL: "https://example.com/products/package-protection"},
	}
	for _, card := range blocked {
		if isRecommendableProductCard(card) {
			t.Fatalf("expected service link to be blocked: %+v", card)
		}
	}
}

func TestRecommendableProductCardAllowsPhysicalProducts(t *testing.T) {
	allowed := []appcore.ProductCard{
		{Title: "Guava Tree", URL: "https://example.com/products/guava-tree"},
		{Title: "Raised Garden Bed", URL: "https://example.com/products/raised-garden-bed"},
		{Title: "Solar Garden Light", URL: "https://example.com/products/solar-garden-light"},
	}
	for _, card := range allowed {
		if !isRecommendableProductCard(card) {
			t.Fatalf("expected product link to be allowed: %+v", card)
		}
	}
}

func TestCollectProductCardsFiltersServiceLinks(t *testing.T) {
	got := collectProductCards([]appcore.ProductCard{
		{Title: "Shipping Insurance", URL: "https://example.com/products/shipping-insurance"},
		{Title: "Guava Tree", URL: "https://example.com/products/guava-tree"},
	}, []appcore.Conversation{
		{ProductCards: []appcore.ProductCard{
			{Title: "Support Animal Rescue", URL: "https://example.com/products/support-animal-rescue"},
			{Title: "Solar Garden Light", URL: "https://example.com/products/solar-garden-light"},
		}},
	})
	if len(got) != 2 {
		t.Fatalf("expected 2 physical products, got %d: %+v", len(got), got)
	}
	for _, card := range got {
		if strings.Contains(card.URL, "shipping-insurance") || strings.Contains(card.URL, "support-animal-rescue") {
			t.Fatalf("service product was not filtered: %+v", got)
		}
	}
}

func TestMergeManualAndAutoProductCardsFiltersServiceLinks(t *testing.T) {
	got := mergeManualAndAutoProductCards([]appcore.ProductCard{
		{Title: "Shipping Insurance", URL: "https://example.com/products/shipping-insurance", Manual: true},
		{Title: "Guava Tree", URL: "https://example.com/products/guava-tree", Manual: true},
	}, []appcore.ProductCard{
		{Title: "Package Protection", URL: "https://example.com/products/package-protection"},
		{Title: "Raised Garden Bed", URL: "https://example.com/products/raised-garden-bed"},
	})
	if len(got) != 2 {
		t.Fatalf("expected 2 physical products, got %d: %+v", len(got), got)
	}
	for _, card := range got {
		if strings.Contains(card.URL, "shipping-insurance") || strings.Contains(card.URL, "package-protection") {
			t.Fatalf("service product was not filtered: %+v", got)
		}
	}
}

func TestMatchProductInterestCardMatchesEntryPageTitle(t *testing.T) {
	card, ok := matchProductInterestCard("🔥Limited-Time 50% OFF & Free Shipping🔥 ♟ Special Edition Chessboard & Pieces-8JX3 – Kemye", []appcore.ProductCard{
		{Title: "Tropical Guava Growing Kit for Pots & Gardens", URL: "https://example.com/products/tropical-guava-growing-kit"},
		{Title: "Limited-Time 50% OFF & Free Shipping Special Edition Chessboard & Pieces-8JX3", URL: "https://example.com/products/special-edition-chessboard-pieces-8jx3"},
	})
	if !ok {
		t.Fatal("expected entry page title to match a product card")
	}
	if !strings.Contains(card.URL, "special-edition-chessboard-pieces-8jx3") {
		t.Fatalf("matched wrong card: %+v", card)
	}
}

func TestResolveProductInterestCardsKeepsConversationProductFirst(t *testing.T) {
	conversations := resolveProductInterestCards([]appcore.Conversation{{
		ProductInterestTitles: []string{"Tropical Guava Growing Kit for Pots & Gardens – Amarnis"},
		ProductCards: []appcore.ProductCard{
			{Title: "Existing visible product", URL: "https://example.com/products/existing-visible-product"},
		},
	}}, []appcore.ProductCard{
		{Title: "Tropical Guava Growing Kit for Pots & Gardens", URL: "https://example.com/products/tropical-guava-growing-kit"},
		{Title: "Solar Garden Light", URL: "https://example.com/products/solar-garden-light"},
	})
	if len(conversations) != 1 || len(conversations[0].ProductCards) < 2 {
		t.Fatalf("expected matched product plus existing product, got %+v", conversations)
	}
	if !strings.Contains(conversations[0].ProductCards[0].URL, "tropical-guava-growing-kit") {
		t.Fatalf("entry product should be first, got %+v", conversations[0].ProductCards)
	}
}

func TestWithProductCardsPreservesConversationProductBeforeShopCards(t *testing.T) {
	got := (&App{}).withProductCards([]appcore.Conversation{{
		ProductCards: []appcore.ProductCard{
			{Title: "Entry Product", URL: "https://example.com/products/entry-product"},
		},
	}}, []appcore.ProductCard{
		{Title: "Shop Product", URL: "https://example.com/products/shop-product"},
	})
	if len(got) != 1 || len(got[0].ProductCards) != 2 {
		t.Fatalf("expected conversation and shop products, got %+v", got)
	}
	if !strings.Contains(got[0].ProductCards[0].URL, "entry-product") {
		t.Fatalf("conversation product should stay first, got %+v", got[0].ProductCards)
	}
}

func TestProductCardsFromHandlesKeepsCollectionOnlyProducts(t *testing.T) {
	handles := []string{
		"shipping-insurance",
		"💪-nine-times-steamed-sun-dried-mulberry-black-sesame-pills-8sa8",
		"🏆tongkat-ali-goji-berry-herbal-gummies-for-men-8jx3",
		"1",
		"dried-loquats-8cr5",
	}
	got := productCardsFromHandles(handles, "dilyhbu.com", map[string]appcore.ProductCard{
		"shipping-insurance": {Title: "Shipping Insurance", URL: "https://dilyhbu.com/products/shipping-insurance"},
		"💪-nine-times-steamed-sun-dried-mulberry-black-sesame-pills-8sa8": {
			Title: "Nine-times Steamed Mulberry Pills",
			URL:   "https://dilyhbu.com/products/%F0%9F%92%AA-nine-times-steamed-sun-dried-mulberry-black-sesame-pills-8sa8",
		},
		"1": {Title: "Universal Anti-Vibration Feet Pads", URL: "https://dilyhbu.com/products/1"},
	}, 5)
	if len(got) != 4 {
		t.Fatalf("expected 4 recommendable collection products, got %d: %+v", len(got), got)
	}
	for _, card := range got {
		if strings.Contains(card.URL, "shipping-insurance") {
			t.Fatalf("service product was not filtered: %+v", got)
		}
	}
	if !strings.Contains(got[1].URL, "tongkat-ali-goji-berry") || !strings.Contains(got[3].URL, "dried-loquats-8cr5") {
		t.Fatalf("collection-only products were not preserved in order: %+v", got)
	}
}

func TestMergeManualAndAutoProductCardsDoesNotShrinkOnPartialAutoFetch(t *testing.T) {
	existing := []appcore.ProductCard{
		{Title: "Auto Product 1", URL: "https://example.com/products/auto-product-1"},
		{Title: "Auto Product 2", URL: "https://example.com/products/auto-product-2"},
		{Title: "Auto Product 3", URL: "https://example.com/products/auto-product-3"},
		{Title: "Auto Product 4", URL: "https://example.com/products/auto-product-4"},
		{Title: "Auto Product 5", URL: "https://example.com/products/auto-product-5"},
	}
	partial := []appcore.ProductCard{
		{Title: "Auto Product 1", URL: "https://example.com/products/auto-product-1"},
		{Title: "Auto Product 2", URL: "https://example.com/products/auto-product-2"},
	}
	got := mergeManualAndAutoProductCards(existing, partial)
	if len(got) != 5 {
		t.Fatalf("partial automatic fetch should not shrink existing recommendations, got %d: %+v", len(got), got)
	}
	if !strings.Contains(got[0].URL, "auto-product-1") || !strings.Contains(got[4].URL, "auto-product-5") {
		t.Fatalf("expected partial results first and existing cache to fill the rest, got %+v", got)
	}
}
