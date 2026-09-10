package platform

import (
	"context"
	"testing"
	"time"
)

func TestPostgresShopifyOrderSyncQueueAndWebhookDedupe(t *testing.T) {
	ctx, store := openIsolatedPostgresTestStore(t)
	shop, err := store.CreateShop(ctx, Shop{DisplayName: prefixedID("Shopify Queue"), Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.DeleteShop(context.Background(), shop.ID) }()
	now := time.Now().UTC()
	webhookID := prefixedID("webhook")
	job, accepted, err := store.EnqueueShopifyWebhookJob(ctx, webhookID, "queue.myshopify.com", "orders/updated", now, ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "webhook", TargetOrderID: "123", AvailableAt: now,
	})
	if err != nil || !accepted || job.TargetOrderID != "123" {
		t.Fatalf("enqueue webhook job: job=%#v accepted=%v err=%v", job, accepted, err)
	}
	if _, accepted, err := store.EnqueueShopifyWebhookJob(ctx, webhookID, "queue.myshopify.com", "orders/updated", now, ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "duplicate", TargetOrderID: "123", AvailableAt: now,
	}); err != nil || accepted {
		t.Fatalf("duplicate webhook accepted=%v err=%v", accepted, err)
	}
	claimed, err := store.ClaimShopifyOrderSyncJob(ctx, now.Add(time.Second), false)
	if err != nil || claimed.ShopID != shop.ID || claimed.TargetOrderID != "123" {
		t.Fatalf("claim webhook job: %#v err=%v", claimed, err)
	}
	secondWebhookID := prefixedID("webhook")
	merged, accepted, err := store.EnqueueShopifyWebhookJob(ctx, secondWebhookID, "queue.myshopify.com", "orders/updated", now, ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "webhook", TargetOrderID: "456", AvailableAt: now,
	})
	if err != nil || !accepted || !merged.RerunRequested || merged.TargetOrderID != "" {
		t.Fatalf("merge running webhook: job=%#v accepted=%v err=%v", merged, accepted, err)
	}
	if err := store.FinishShopifyOrderSyncJob(ctx, shop.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
	rerun, err := store.ClaimShopifyOrderSyncJob(ctx, time.Now().UTC().Add(time.Second), false)
	if err != nil || rerun.ShopID != shop.ID || rerun.TargetOrderID != "" {
		t.Fatalf("claim merged rerun: %#v err=%v", rerun, err)
	}
	if err := store.FinishShopifyOrderSyncJob(ctx, shop.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
}
