package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shopify-support-platform/internal/appcore"
)

func TestProbeSettingsFailsWhenAPIRejectsKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad key", http.StatusUnauthorized)
	}))
	defer server.Close()

	status := ProbeSettings(map[string]any{
		"enabled":  false,
		"base_url": server.URL,
		"model":    "deepseek-test",
		"api_key":  "wrong-key",
	})

	if status.Connected {
		t.Fatalf("expected disconnected status for rejected API key")
	}
	if status.Message != "AI 接入失败" {
		t.Fatalf("expected connection failure message, got %q", status.Message)
	}
	if status.Error == "" {
		t.Fatalf("expected failure detail")
	}
}

func TestProbeSettingsConnectedDoesNotDependOnEnabledSwitch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": "AI 连接正常。"}},
			},
		})
	}))
	defer server.Close()

	status := ProbeSettings(map[string]any{
		"enabled":  false,
		"base_url": server.URL,
		"model":    "deepseek-test",
		"api_key":  "valid-key",
	})

	if !status.Connected {
		t.Fatalf("expected connected status, got message=%q error=%q", status.Message, status.Error)
	}
	if status.Message != "AI 已接入" {
		t.Fatalf("expected connected message, got %q", status.Message)
	}
}

func TestTranslationContextIncludesStoreAndCustomerMessages(t *testing.T) {
	text := translationContext(appcore.Conversation{Messages: []appcore.MessageItem{
		{Role: "customer", Time: "11:26 AM", Text: "I order 2 guava trees how can I track them"},
		{Role: "store", Time: "10:57 PM", Text: "Hello Clarabell, please provide your order number."},
	}})
	if !strings.Contains(text, "Customer [11:26 AM]") || !strings.Contains(text, "Store [10:57 PM]") {
		t.Fatalf("expected both sides in translation context, got %q", text)
	}
}

func TestTranslationContextUsesCanonicalProviderOrder(t *testing.T) {
	text := translationContext(appcore.Conversation{Source: "inbox", Messages: []appcore.MessageItem{
		{Role: "store", Time: "8:30 PM", Text: "Latest store reply."},
		{Role: "customer", Time: "6:40 PM", Text: "26"},
		{Role: "customer", Time: "6:33 PM", Text: "Track my order"},
	}})
	first := strings.Index(text, "Store [8:30 PM]")
	last := strings.Index(text, "Customer [6:33 PM]")
	if first < 0 || last < 0 || first > last {
		t.Fatalf("expected translation context to preserve provider canonical order, got %q", text)
	}
}

func TestTranslationContextKeepsCanonicalInboxOrderWithSameMinute(t *testing.T) {
	text := translationContext(appcore.Conversation{Source: "inbox", Messages: []appcore.MessageItem{
		{Role: "customer", Time: "8:51 AM", Text: "Track my order"},
		{Role: "store", Time: "8:51 AM", Text: "Please provide order details."},
		{Role: "customer", Time: "8:51 AM", Text: "My order number is 1212."},
		{Role: "store", Time: "8:51 AM", Text: "Order link."},
	}})
	first := strings.Index(text, "Track my order")
	last := strings.Index(text, "Order link.")
	if first < 0 || last < 0 || first > last {
		t.Fatalf("expected same-minute inbox context to preserve canonical visual order, got %q", text)
	}
}

func TestReplyPromptRequiresCustomerIncomingLanguage(t *testing.T) {
	prompt := buildReplyPrompt(appcore.Conversation{
		Preview: "Hola, quiero saber cuando llega mi pedido.",
		Messages: []appcore.MessageItem{
			{Role: "customer", Text: "Hola, quiero saber cuando llega mi pedido."},
		},
	}, nil, "", nil)

	if !strings.Contains(prompt, "客户进线所使用的语言") || !strings.Contains(prompt, "不要默认翻译成英文") {
		t.Fatalf("expected reply prompt to require customer incoming language, got %q", prompt)
	}
	if !strings.Contains(prompt, "严禁在非中文客户回复里混入中文") || !strings.Contains(prompt, "知识库和分类备注只作参考") {
		t.Fatalf("expected reply prompt to forbid Chinese leakage, got %q", prompt)
	}
}

func TestReplyPromptIncludesForbiddenTerms(t *testing.T) {
	prompt := buildReplyPrompt(appcore.Conversation{
		Preview: "Please refund me now.",
		Messages: []appcore.MessageItem{
			{Role: "customer", Text: "Please refund me now."},
		},
	}, nil, "", []string{"refund immediately", "马上退款"})

	if !strings.Contains(prompt, "AI forbidden words/phrases") || !strings.Contains(prompt, "refund immediately") || !strings.Contains(prompt, "马上退款") {
		t.Fatalf("expected forbidden terms in prompt, got %q", prompt)
	}
}

func TestGenerateReplyRepairsChineseLeakForNonChineseCustomer(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		content := "Hello,\n\nThank you for your message.\n\n客服团队"
		if calls > 1 {
			content = "Hello,\n\nThank you for your message.\n\nCustomer Support Team"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": content}},
			},
		})
	}))
	defer server.Close()

	client := Client{settings: map[string]any{
		"enabled":  true,
		"base_url": server.URL,
		"model":    "deepseek-test",
		"api_key":  "valid-key",
	}}
	updated, err := client.GenerateReply(appcore.Conversation{
		CustomerName: "Lisa",
		Preview:      "Refund me my money",
		Messages: []appcore.MessageItem{
			{Role: "customer", Text: "Refund me my money"},
		},
	})
	if err != nil {
		t.Fatalf("generate reply: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected repair retry, got %d calls", calls)
	}
	if strings.Contains(updated.AIReply, "客服团队") || !strings.Contains(updated.AIReply, "Customer Support Team") {
		t.Fatalf("expected repaired English reply, got %q", updated.AIReply)
	}
}

func TestGenerateReplyRepairsForbiddenTerms(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		content := "We will refund immediately."
		if calls > 1 {
			content = "We will review your request according to our return policy."
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": content}},
			},
		})
	}))
	defer server.Close()

	client := Client{settings: map[string]any{
		"enabled":         true,
		"base_url":        server.URL,
		"model":           "deepseek-test",
		"api_key":         "valid-key",
		"forbidden_terms": []string{"refund immediately"},
	}}
	updated, err := client.GenerateReply(appcore.Conversation{
		CustomerName: "Lisa",
		Preview:      "Refund me my money",
		Messages: []appcore.MessageItem{
			{Role: "customer", Text: "Refund me my money"},
		},
	})
	if err != nil {
		t.Fatalf("generate reply: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected forbidden-term repair retry, got %d calls", calls)
	}
	if strings.Contains(strings.ToLower(updated.AIReply), "refund immediately") || updated.AICaution {
		t.Fatalf("expected repaired reply without caution, got reply=%q caution=%v", updated.AIReply, updated.AICaution)
	}
}

func TestGenerateReplyFlagsCautionWhenForbiddenTermsRemain(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": "We will refund immediately."}},
			},
		})
	}))
	defer server.Close()

	client := Client{settings: map[string]any{
		"enabled":         true,
		"base_url":        server.URL,
		"model":           "deepseek-test",
		"api_key":         "valid-key",
		"forbidden_terms": "refund immediately\n马上退款",
	}}
	updated, err := client.GenerateReply(appcore.Conversation{
		CustomerName: "Lisa",
		Preview:      "Refund me my money",
		Messages: []appcore.MessageItem{
			{Role: "customer", Text: "Refund me my money"},
		},
	})
	if err != nil {
		t.Fatalf("generate reply: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected one forbidden-term repair retry, got %d calls", calls)
	}
	if !updated.AICaution {
		t.Fatalf("expected caution when forbidden term remains, got reply=%q", updated.AIReply)
	}
}

func TestReplyBoxTranslationPromptTargetsCustomerLanguage(t *testing.T) {
	var captured string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		for _, message := range payload.Messages {
			if message.Role == "user" {
				captured = message.Content
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": "Hola, revisaremos el envio por usted."}},
			},
		})
	}))
	defer server.Close()

	client := Client{settings: map[string]any{
		"enabled":  true,
		"base_url": server.URL,
		"model":    "deepseek-test",
		"api_key":  "valid-key",
	}}
	_, err := client.TranslateReplyBoxText("先生你好，你购买的bag 将于30日到达UK。", appcore.Conversation{
		Preview:  "Hola, donde esta mi pedido?",
		Messages: []appcore.MessageItem{{Role: "customer", Text: "Hola, donde esta mi pedido?"}},
	}, "customer")

	if err != nil {
		t.Fatalf("translate reply box: %v", err)
	}
	if !strings.Contains(captured, "客户进线所使用的语言") || !strings.Contains(captured, "忠实自然翻译") || !strings.Contains(captured, "不要加入会话上下文里有但回复框当前文本没有的信息") {
		t.Fatalf("expected reply-box translation prompt to target customer language without expansion, got %q", captured)
	}
}

func TestReplyBoxTranslationPromptTargetsChinese(t *testing.T) {
	prompt := buildReplyBoxTranslationPrompt("Hello, the bag will arrive in the UK on the 30th.", appcore.Conversation{}, "zh")

	if !strings.Contains(prompt, "目标语言：中文") || !strings.Contains(prompt, "输出纯翻译结果") || !strings.Contains(prompt, "不允许把短回复扩写成一大段") {
		t.Fatalf("expected reply-box translation prompt to target Chinese faithfully, got %q", prompt)
	}
}
