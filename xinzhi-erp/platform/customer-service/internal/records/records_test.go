package records

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"shopify-support-platform/internal/appcore"
)

func TestExtractOrderNumber(t *testing.T) {
	conversation := appcore.Conversation{
		Preview:        "My order number is #1545",
		OrderCartLines: []string{"Created last order", "#1545"},
		OrderLinks:     []appcore.InfoLink{{Label: "Order #1545", URL: "https://admin.shopify.com/store/demo/orders/6539812"}},
	}
	if got := ExtractOrderNumber(conversation); got != "#1545" {
		t.Fatalf("expected #1545, got %q", got)
	}
	if got := ExtractOrderNumber(appcore.Conversation{Preview: "Product question"}); got != "/" {
		t.Fatalf("expected fallback slash, got %q", got)
	}
}

func TestValidateDraftFallsBackToKnownCategory(t *testing.T) {
	categories := defaultCategories()
	got := ValidateDraft(ClassificationDraft{Primary: "乱写", Secondary: "不存在", Tertiary: "随便"}, categories)
	if got.Primary != categories[0].Primary || got.Secondary != categories[0].Secondary || got.Tertiary != categories[0].Tertiary[0] {
		t.Fatalf("unexpected fallback: %#v", got)
	}
	if !got.NeedsReview {
		t.Fatalf("invalid AI category should be marked for review")
	}
}

func TestNormalizeCategoriesBuildsIndependentCombinations(t *testing.T) {
	normalized := NormalizeCategories([]CategoryOption{
		{Primary: "一级 A", Secondary: "二级 A", Tertiary: []string{"三级 A"}},
		{Primary: " 一级 B ", Secondary: "二级 B", Tertiary: []string{"三级 B", "三级 A"}},
	})
	if len(normalized) != 4 {
		t.Fatalf("expected four independent combinations, got %#v", normalized)
	}
	for _, category := range normalized {
		if len(category.Tertiary) != 2 || category.Tertiary[0] != "三级 A" || category.Tertiary[1] != "三级 B" {
			t.Fatalf("tertiary vocabulary was not shared: %#v", category)
		}
	}
}

func TestValidateDraftAcceptsIndependentCombination(t *testing.T) {
	categories := []CategoryOption{
		{Primary: "一级 A", Secondary: "二级 A", Tertiary: []string{"三级 A"}},
		{Primary: "一级 B", Secondary: "二级 B", Tertiary: []string{"三级 B"}},
	}
	draft := ClassificationDraft{Primary: "一级 A", Secondary: "二级 B", Tertiary: "三级 B"}
	got := ValidateDraft(draft, categories)
	if got.Primary != draft.Primary || got.Secondary != draft.Secondary || got.Tertiary != draft.Tertiary || got.NeedsReview {
		t.Fatalf("independent category combination was changed: %#v", got)
	}
}

func TestHeuristicClassifyNeverGuessesOrderLifecycle(t *testing.T) {
	delivered := HeuristicClassify(appcore.Conversation{Preview: "Tracking status: delivered"})
	if delivered.Primary != PrimaryPendingReview || delivered.Secondary != "物流查询" {
		t.Fatalf("delivered conversation classification = %#v", delivered)
	}

	inTransit := HeuristicClassify(appcore.Conversation{Preview: "The package has not been delivered yet"})
	if inTransit.Primary != PrimaryPendingReview || inTransit.Secondary != "物流查询" {
		t.Fatalf("undelivered conversation classification = %#v", inTransit)
	}
}

func TestValidateDraftPreservesPendingReviewOutsideCustomCategories(t *testing.T) {
	got := ValidateDraft(ClassificationDraft{
		Primary: PrimaryPendingReview, Secondary: "物流查询", Tertiary: "订单状态查询",
	}, defaultCategories())
	if got.Primary != PrimaryPendingReview {
		t.Fatalf("pending lifecycle was replaced by a configured category: %#v", got)
	}
}

func TestUpsertDedupesAndExportRange(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	conversation := appcore.Conversation{
		ID:              "c1",
		ConversationID:  "thread-1",
		Source:          "inbox",
		ShopKey:         "zhanfu_default_1",
		ShopName:        "Demo Shop",
		CustomerEmail:   "ada@example.com",
		Preview:         "Where is order #1545?",
		RecordPrimary:   "已发货",
		RecordSecondary: "物流查询",
		RecordTertiary:  "查询实时轨迹",
		RecordRemark:    "客户催物流",
	}
	when := time.Date(2026, 5, 29, 10, 30, 0, 0, time.Local)
	if _, err := store.Upsert(conversation, "sent", when); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}
	conversation.RecordRemark = "已回复轨迹"
	if _, err := store.Upsert(conversation, "handled", when.Add(time.Hour)); err != nil {
		t.Fatalf("second upsert failed: %v", err)
	}
	records, err := store.recordsInRange(time.Date(2026, 5, 29, 0, 0, 0, 0, time.Local), time.Date(2026, 5, 29, 0, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("range failed: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected deduped one record, got %#v", records)
	}
	if records[0].Remark != "已回复轨迹" || records[0].ReplyDate != "5月29日" || records[0].InboundChannel != "店铺" {
		t.Fatalf("unexpected record fields: %#v", records[0])
	}
}

func TestExportWritesStyledXLSX(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	conversation := appcore.Conversation{
		ID:              "c1",
		Source:          "gmail",
		ShopKey:         "shop",
		ShopName:        "Demo",
		CustomerEmail:   "ada@example.com",
		Preview:         "Order #1219 tracking",
		RecordPrimary:   "已发货",
		RecordSecondary: "物流查询",
		RecordTertiary:  "查询实时轨迹",
	}
	when := time.Date(2026, 5, 29, 12, 0, 0, 0, time.Local)
	if _, err := store.Upsert(conversation, "sent", when); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}
	path := filepath.Join(dir, "out.xlsx")
	result, err := store.Export("2026-05-29", "2026-05-29", path)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if result.RowCount != 1 {
		t.Fatalf("expected one row, got %#v", result)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing xlsx: %v", err)
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("invalid zip xlsx: %v", err)
	}
	defer reader.Close()
	var sheet string
	for _, file := range reader.File {
		if file.Name == "xl/worksheets/sheet1.xml" {
			rc, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := io.ReadAll(rc)
			_ = rc.Close()
			sheet = string(raw)
			break
		}
	}
	if !strings.Contains(sheet, "回复日期") || !strings.Contains(sheet, "autoFilter") || !strings.Contains(sheet, "查询实时轨迹") {
		t.Fatalf("sheet missing expected content: %s", sheet)
	}
}
