package platform

import (
	"strings"
	"testing"
)

func TestStoreConversionAuditOutreachRule(t *testing.T) {
	tests := []struct {
		name   string
		input  incomingEmailMessage
		filter bool
	}{
		{
			name: "first cold outreach with changed sender and subject",
			input: incomingEmailMessage{
				SenderName:  "Website Review Team",
				SenderEmail: "another-address@example.com",
				Subject:     "A thought about your store",
				Body: "Hi,\n\nI was about to leave your website when one thought kept coming back to me.\n" +
					"I wonder if your store is getting the results it truly deserves. The products are not the problem; " +
					"a few details are making it harder for visitors to become customers.\n" +
					"If you are interested, I would be happy to share what stood out to me.",
			},
			filter: true,
		},
		{
			name: "follow up with campaign signature",
			input: incomingEmailMessage{
				SenderName:  "Berry Rogers",
				SenderEmail: "new-mailbox@gmail.com",
				Subject:     "Re: It's Thursday Offer",
				Body: "Hi,\n\nI just wanted to check in in case my last email slipped through the cracks. " +
					"The observations I mentioned are still available. If you'd like me to send them over, just reply.\n\n" +
					"Report Prepared by,\nBerry Agency\nIndependent Commerce Analyst\nWeb. https://berryagency.lovable.app/services",
			},
			filter: true,
		},
		{
			name: "known signature and one campaign topic",
			input: incomingEmailMessage{
				SenderName:  "Different Person",
				SenderEmail: "rotated-address@gmail.com",
				Subject:     "Store note",
				Body:        "The observations I mentioned are still available.\n\nIndependent Commerce Analyst\nBerry Agency",
			},
			filter: true,
		},
		{
			name: "subject alone is not enough",
			input: incomingEmailMessage{
				SenderName:  "Customer",
				SenderEmail: "buyer@example.com",
				Subject:     "It's Thursday Offer",
				Body:        "Can you explain this product offer?",
			},
			filter: false,
		},
		{
			name: "single generic campaign phrase is not enough",
			input: incomingEmailMessage{
				SenderName:  "Visitor",
				SenderEmail: "visitor@example.com",
				Subject:     "Website feedback",
				Body:        "I was browsing your website and wanted to share feedback.",
			},
			filter: false,
		},
		{
			name: "customer order request wins over quoted campaign",
			input: incomingEmailMessage{
				SenderName:  "Customer",
				SenderEmail: "buyer@example.com",
				Subject:     "Re: It's Thursday Offer",
				Body: "I have not received my order. Please send the tracking status.\n\n" +
					"On Thu, Jul 23, 2026 at 8:18 AM Berry Rogers <berryprofessionalexpert@gmail.com> wrote:\n" +
					"I was about to leave your website. The products are not the problem. " +
					"It is harder for visitors to become customers. I would be happy to share what stood out to me.\n" +
					"Berry Agency\nIndependent Commerce Analyst",
			},
			filter: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decision := evaluateIncomingEmailFilter(test.input)
			if decision.Filtered != test.filter {
				t.Fatalf("Filtered = %v, want %v: %#v", decision.Filtered, test.filter, decision)
			}
			if test.filter && (decision.RuleID != "store-conversion-audit-outreach-v1" || decision.Category != emailFilterCategoryMarketing) {
				t.Fatalf("unexpected rule decision: %#v", decision)
			}
		})
	}
}

func TestConfirmedGrowthOutreachTemplates(t *testing.T) {
	tests := []struct {
		name   string
		input  incomingEmailMessage
		ruleID string
	}{
		{
			name: "results based commission for verified orders",
			input: incomingEmailMessage{
				SenderName:  "Dukztech",
				SenderEmail: "rotated-sales-address@gmail.com",
				Subject:     "Is this Huamanteodora",
				Body:        "Would you consider a results-based 5% commission if I help your store achieve 20-40 verified orders within the next two weeks? Please share your WhatsApp number.",
			},
			ruleID: "commission-order-acquisition-outreach-v1",
		},
		{
			name: "short window commission variant",
			input: incomingEmailMessage{
				SenderName:  "Selim professional",
				SenderEmail: "another-rotated-address@gmail.com",
				Subject:     "Store name",
				Body:        "Hello, I'm Selim. If I bring 15-20 orders in 36 hours, does 3% commission feel fair? Kindly share your Whatsapp contact.",
			},
			ruleID: "commission-order-acquisition-outreach-v1",
		},
		{
			name: "shopify growth final follow up",
			input: incomingEmailMessage{
				SenderName:  "Agency Friday",
				SenderEmail: "new-agency-address@gmail.com",
				Subject:     "Re:",
				Body:        "Hi! This will be my last follow-up. If growing your Shopify store is something you'd like help with in the future, feel free to reach out anytime. Wishing you continued success with your business!",
			},
			ruleID: "shopify-growth-followup-outreach-v1",
		},
		{
			name: "webshop order benchmark",
			input: incomingEmailMessage{
				SenderName:  "Hussain Consultancy",
				SenderEmail: "new-consultant@gmail.com",
				Subject:     "What's your peak?",
				Body:        "Has your webshop reached 20/36- orders in the previous 28 days?",
			},
			ruleID: "webshop-order-benchmark-outreach-v1",
		},
		{
			name: "no subject open idea from role mailbox",
			input: incomingEmailMessage{
				SenderName:  "OLA NIYI",
				SenderEmail: "niyiexpert33@gmail.com",
				Subject:     "",
				Body:        "Would you be open to hearing an idea?",
			},
			ruleID: "open-idea-role-sender-outreach-v1",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decision := evaluateIncomingEmailFilter(test.input)
			if !decision.Filtered || decision.RuleID != test.ruleID || decision.Category != emailFilterCategoryMarketing {
				t.Fatalf("unexpected rule decision: %#v", decision)
			}
		})
	}
}

func TestPotentialMarketingRoutesToPendingReviewWithoutCatchingCustomerRequests(t *testing.T) {
	tests := []struct {
		name       string
		input      incomingEmailMessage
		wantReview bool
	}{
		{
			name:       "plain sender with explicit promotion",
			input:      incomingEmailMessage{SenderName: "Sam", SenderEmail: "sam@example.com", Subject: "A store offer", Body: "Save 15% on our services. Unsubscribe here."},
			wantReview: true,
		},
		{
			name:       "partial acquisition proposal",
			input:      incomingEmailMessage{SenderName: "Consultant", SenderEmail: "person@example.com", Subject: "Store growth", Body: "I can bring 20 orders. Can we continue on WhatsApp?"},
			wantReview: true,
		},
		{
			name:       "customer asks to unsubscribe",
			input:      incomingEmailMessage{SenderName: "Buyer", SenderEmail: "buyer@example.com", Subject: "Please unsubscribe me", Body: "I no longer want product update emails."},
			wantReview: false,
		},
		{
			name:       "customer order request overrides marketing words",
			input:      incomingEmailMessage{SenderName: "Buyer", SenderEmail: "buyer@example.com", Subject: "Order problem", Body: "My order has not arrived. I clicked your special offer but need tracking help."},
			wantReview: false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decision := evaluateIncomingEmailFilter(test.input)
			if decision.Review != test.wantReview || decision.Filtered {
				t.Fatalf("unexpected pending-review decision: %#v", decision)
			}
			item := test.input
			applyIncomingEmailFilterDecision(&item)
			if test.wantReview && (item.Classification != ConversationKindSystem || item.ClassificationReason != suspectedMarketingReviewClassification) {
				t.Fatalf("suspected marketing was not routed to pending review: %#v", item)
			}
		})
	}
}

func TestGrowthOutreachRulesAvoidCustomerMessages(t *testing.T) {
	tests := []struct {
		name  string
		input incomingEmailMessage
	}{
		{
			name: "customer asks about commission terms",
			input: incomingEmailMessage{
				SenderName:  "Customer",
				SenderEmail: "buyer@example.com",
				Subject:     "Affiliate order",
				Body:        "My order has not arrived. I also need to ask whether the 5% commission is included.",
			},
		},
		{
			name: "ordinary shopify store assistance",
			input: incomingEmailMessage{
				SenderName:  "Merchant",
				SenderEmail: "merchant@example.com",
				Subject:     "Shopify question",
				Body:        "Can you help with my Shopify store in the future?",
			},
		},
		{
			name: "customer mentions prior order count",
			input: incomingEmailMessage{
				SenderName:  "Customer",
				SenderEmail: "buyer@example.com",
				Subject:     "Order history",
				Body:        "I placed 20 orders in the previous 28 days and need a refund for the latest one.",
			},
		},
		{
			name: "open idea from ordinary customer",
			input: incomingEmailMessage{
				SenderName:  "Customer",
				SenderEmail: "buyer@example.com",
				Subject:     "",
				Body:        "Would you be open to hearing an idea?",
			},
		},
		{
			name: "open idea with a real subject",
			input: incomingEmailMessage{
				SenderName:  "Store Expert",
				SenderEmail: "storeexpert99@gmail.com",
				Subject:     "Product suggestion",
				Body:        "Would you be open to hearing an idea?",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if decision := evaluateIncomingEmailFilter(test.input); decision.Filtered {
				t.Fatalf("customer message was filtered: %#v", decision)
			}
		})
	}
}

func TestIncomingEmailFilterRegistryIsValid(t *testing.T) {
	seen := map[string]bool{}
	hasBlacklist := false
	hasMarketing := false
	for _, rule := range incomingEmailFilterRules {
		if strings.TrimSpace(rule.ID) == "" || rule.Match == nil {
			t.Fatalf("invalid email filter rule: %#v", rule)
		}
		if seen[rule.ID] {
			t.Fatalf("duplicate email filter rule ID %q", rule.ID)
		}
		seen[rule.ID] = true
		switch rule.Category {
		case emailFilterCategorySenderBlacklist:
			hasBlacklist = true
		case emailFilterCategoryMarketing:
			hasMarketing = true
		case emailFilterCategorySystem:
		default:
			t.Fatalf("unsupported email filter category %q", rule.Category)
		}
	}
	if !hasBlacklist || !hasMarketing {
		t.Fatalf("required rule categories are missing: blacklist=%v marketing=%v", hasBlacklist, hasMarketing)
	}
}

func TestConfirmedTemplateUsesSameRuleForProvidersAndFolders(t *testing.T) {
	body := "I was about to leave your website. The products are not the problem. " +
		"It is harder for visitors to become customers. I would be happy to share what stood out to me."
	gmailBody := platformGmailBody{Data: ""}
	gmailMessages := []platformGmailMessage{
		{
			ID:       "gmail-inbox",
			ThreadID: "thread-inbox",
			LabelIDs: []string{"INBOX"},
			Payload: platformGmailPayload{
				Headers: []platformGmailHeader{
					{Name: "From", Value: "Rotated Sender <rotated-one@gmail.com>"},
					{Name: "Subject", Value: "A note about your store"},
				},
				Body: gmailBody,
			},
			Snippet: body,
		},
		{
			ID:       "gmail-spam",
			ThreadID: "thread-spam",
			LabelIDs: []string{"SPAM"},
			Payload: platformGmailPayload{
				Headers: []platformGmailHeader{
					{Name: "From", Value: "Another Sender <rotated-two@gmail.com>"},
					{Name: "Subject", Value: "A different subject"},
				},
				Body: gmailBody,
			},
			Snippet: body,
		},
	}
	for _, message := range gmailMessages {
		item := gmailIncomingEmail(message)
		item.SenderName = item.CustomerName
		item.SenderEmail = item.CustomerEmail
		decision := applyIncomingEmailFilterDecision(&item)
		if decision.RuleID != "store-conversion-audit-outreach-v1" || item.Classification != "filtered" {
			t.Fatalf("Gmail labels %v did not use the confirmed rule: %#v %#v", message.LabelIDs, decision, item)
		}
	}

	for _, origin := range []string{"inbox", "junk"} {
		message := platformOutlookMessage{
			ID:           "outlook-" + origin,
			Subject:      "A different subject",
			BodyPreview:  body,
			FolderOrigin: origin,
		}
		message.From.EmailAddress.Name = "Rotated Sender"
		message.From.EmailAddress.Address = "rotated-" + origin + "@outlook.com"
		item := outlookIncomingEmail(message)
		item.SenderName = item.CustomerName
		item.SenderEmail = item.CustomerEmail
		decision := applyIncomingEmailFilterDecision(&item)
		if decision.RuleID != "store-conversion-audit-outreach-v1" || item.Classification != "filtered" {
			t.Fatalf("Outlook origin %q did not use the confirmed rule: %#v %#v", origin, decision, item)
		}
	}
}

func TestMergeEmailFilterRuleCounts(t *testing.T) {
	got := mergeEmailFilterRuleCounts(
		`{"shopify-store-relay-v1":2}`,
		map[string]int{"shopify-store-relay-v1": 1, "store-conversion-audit-outreach-v1": 3},
	)
	for _, want := range []string{
		`"shopify-store-relay-v1":3`,
		`"store-conversion-audit-outreach-v1":3`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("mergeEmailFilterRuleCounts() = %s, missing %s", got, want)
		}
	}
}
