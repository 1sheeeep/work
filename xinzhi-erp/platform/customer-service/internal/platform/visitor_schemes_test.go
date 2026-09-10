package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVisitorSchemeListsEmptyCollectionsAsArrays(t *testing.T) {
	store := NewMemoryStore()
	schemes, err := store.ListVisitorSchemes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(schemes) != 1 {
		t.Fatalf("expected one default scheme, got %d", len(schemes))
	}
	if schemes[0].ShopIDs == nil {
		t.Fatal("expected shopIds to be an empty array, got nil")
	}
	if schemes[0].InstantAnswers == nil {
		t.Fatal("expected instantAnswers to be an array, got nil")
	}
}

func TestVisitorSchemeApplySnapshotsAndRestoresDefault(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{ID: "shop_scheme_1", DisplayName: "Scheme Shop", Platform: "shopify", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.CreateShopSource(ctx, ShopSource{
		ID:     "source_scheme_1",
		ShopID: shop.ID,
		Type:   SourceTypeShopifyChat,
		Status: SourceStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}

	defaultScheme, err := store.GetVisitorScheme(ctx, defaultVisitorSchemeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(defaultScheme.ShopIDs) != 1 || defaultScheme.ShopIDs[0] != shop.ID {
		t.Fatalf("expected new chat shop on default scheme, got %#v", defaultScheme.ShopIDs)
	}

	custom, err := store.CreateVisitorScheme(ctx, VisitorScheme{
		Name:                  "Order help",
		Language:              visitorLanguageEnglish,
		InstantAnswersEnabled: true,
		InstantAnswers: []InstantAnswerConfig{{
			ID: "order_help", Title: "Order help", Answer: "Version one", Mode: instantAnswerModeText, Enabled: true,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	custom, err = store.ApplyVisitorScheme(ctx, custom.ID, []string{shop.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(custom.ShopIDs) != 1 || custom.ShopIDs[0] != shop.ID {
		t.Fatalf("expected custom assignment, got %#v", custom.ShopIDs)
	}
	assertVisitorSourceMetadata(t, store, shop.ID, custom.ID, "Version one")
	custom.InstantAnswers[0].Answer = "Version two"
	if _, err := store.UpdateVisitorScheme(ctx, custom.ID, custom); err != nil {
		t.Fatal(err)
	}
	assertVisitorSourceMetadata(t, store, shop.ID, custom.ID, "Version one")

	if _, err := store.ApplyVisitorScheme(ctx, custom.ID, []string{shop.ID}); err != nil {
		t.Fatal(err)
	}
	assertVisitorSourceMetadata(t, store, shop.ID, custom.ID, "Version two")

	if _, err := store.ApplyVisitorScheme(ctx, custom.ID, nil); err != nil {
		t.Fatal(err)
	}
	assertVisitorSourceMetadata(t, store, shop.ID, defaultVisitorSchemeID, DEFAULT_ORDER_ANSWER_FOR_TEST)
}

const DEFAULT_ORDER_ANSWER_FOR_TEST = "Enter your order number and email address to see the latest order and tracking status."

func assertVisitorSourceMetadata(t *testing.T, store Store, shopID, schemeID, answer string) {
	t.Helper()
	sources, err := store.ListShopSources(context.Background(), shopID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 {
		t.Fatalf("expected one source, got %d", len(sources))
	}
	if sources[0].Metadata["visitorSchemeId"] != schemeID {
		t.Fatalf("expected scheme %q, got %#v", schemeID, sources[0].Metadata)
	}
	if answer != "" && !containsText(sources[0].Metadata["instantAnswersJson"], answer) {
		t.Fatalf("expected answer %q in snapshot %q", answer, sources[0].Metadata["instantAnswersJson"])
	}
}

func containsText(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}

func TestVisitorSchemeDeleteRestoresAssignedShops(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, _ := store.CreateShop(ctx, Shop{ID: "shop_scheme_delete", DisplayName: "Delete Shop", Status: "active"})
	_, _ = store.CreateShopSource(ctx, ShopSource{ID: "source_scheme_delete", ShopID: shop.ID, Type: SourceTypeShopifyChat, Status: SourceStatusActive})
	custom, err := store.CreateVisitorScheme(ctx, VisitorScheme{
		Name: "Temporary", Language: visitorLanguageAuto, InstantAnswersEnabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyVisitorScheme(ctx, custom.ID, []string{shop.ID}); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteVisitorScheme(ctx, custom.ID); err != nil {
		t.Fatal(err)
	}
	assertVisitorSourceMetadata(t, store, shop.ID, defaultVisitorSchemeID, "")
	if err := store.DeleteVisitorScheme(ctx, defaultVisitorSchemeID); err == nil {
		t.Fatal("expected default scheme deletion to be rejected")
	}
}

func TestVisitorSchemeHTTPCreateAndApply(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	token := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", token, Shop{DisplayName: "HTTP Scheme Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", token, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)

	var created VisitorScheme
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/visitor-schemes", token, VisitorScheme{
		Name: "HTTP scheme", Language: visitorLanguageAuto, InstantAnswersEnabled: true,
		InstantAnswers: []InstantAnswerConfig{{ID: "hello", Title: "Hello", Answer: "Hello there", Mode: instantAnswerModeText, Enabled: true}},
	}, http.StatusCreated, &created)
	if created.ID == "" || created.IsDefault {
		t.Fatalf("unexpected created scheme: %#v", created)
	}
	var applied VisitorScheme
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/visitor-schemes/"+created.ID+"/apply", token, visitorSchemeApplyRequest{ShopIDs: []string{shop.ID}}, http.StatusOK, &applied)
	if len(applied.ShopIDs) != 1 || applied.ShopIDs[0] != shop.ID {
		t.Fatalf("unexpected applied shops: %#v", applied.ShopIDs)
	}

	var sources []ShopSource
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shops/"+shop.ID+"/sources", token, nil, http.StatusOK, &sources)
	if len(sources) != 1 || sources[0].Metadata["visitorSchemeId"] != created.ID {
		t.Fatalf("scheme snapshot not exposed by source API: %#v", sources)
	}
}
