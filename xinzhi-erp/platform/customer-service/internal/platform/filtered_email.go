package platform

import (
	"regexp"
	"strings"
)

type emailFilterRuleCategory string

const (
	emailFilterCategorySenderBlacklist emailFilterRuleCategory = "sender_blacklist"
	emailFilterCategoryMarketing       emailFilterRuleCategory = "marketing_template"
	emailFilterCategorySystem          emailFilterRuleCategory = "system_template"
)

type emailFilterDecision struct {
	Filtered bool
	Review   bool
	RuleID   string
	Category emailFilterRuleCategory
}

type emailFilterContext struct {
	SenderEmail string
	SenderName  string
	Subject     string
	CurrentBody string
	Content     string
}

type emailFilterRule struct {
	ID       string
	Category emailFilterRuleCategory
	Enabled  bool
	Match    func(emailFilterContext) bool
}

var shopifyStoreSenderPattern = regexp.MustCompile(`(?i)^store\+[0-9]+@([a-z0-9-]+\.)*shopifyemail\.com$`)

var (
	automatedMarketingSenderPattern    = regexp.MustCompile(`(?i)(^|[._+\-])(no-?reply|do-?not-?reply|donotreply|newsletter|marketing|promotions?|campaign|offers?|deals?|updates?|notifications?)([._+\-@]|$)`)
	automatedMarketingNamePattern      = regexp.MustCompile(`(?i)\b(newsletter|marketing|promotions?|campaign|offers?|deals?|weekly digest)\b`)
	explicitMarketingPattern           = regexp.MustCompile(`(?i)\b(unsubscribe|manage (?:your )?(?:email )?preferences|view (?:this email )?in (?:your )?browser|newsletter|marketing email|promotional|exclusive offer|limited[- ]time offer|coupon|discount code|shop now|buy now|black friday|cyber monday|weekly digest|special offer|save \d{1,3}%|sale ends)\b`)
	operationalEmailPattern            = regexp.MustCompile(`(?i)\b(payment|payout|refund|chargeback|dispute|fraud|account|security|verification|verify|password|login|invoice|billing|subscription (?:failed|renewed|expired)|app review|policy|compliance|shipment|shipping update|delivery|fulfillment|tracking|new order|order (?:canceled|cancelled|confirmed|updated)|inventory|stock alert|service incident|status update|system alert)\b`)
	customerServiceIntentPattern       = regexp.MustCompile(`(?i)\b(where is (?:my|the) order|(?:my|the) order (?:has not|hasn't|is not|isn't)|(?:i|we) (?:have not|haven't|did not|didn't|never) (?:receive|received|get|got)|not received|tracking (?:number|status|link|page|issue|problem)|package (?:is|was|has|hasn't|has not|didn't|did not)|parcel (?:is|was|has|hasn't|has not)|refund|return|exchange|cancel (?:my|the) order|wrong item|damaged|broken|missing item|delivery (?:status|date|issue|problem|delay)|shipping (?:status|issue|problem|delay)|are you taking orders|take orders)\b`)
	berrySubjectPattern                = regexp.MustCompile(`(?i)\b(?:re:\s*)?it'?s thursday offer\b`)
	orderAcquisitionProposalPattern    = regexp.MustCompile(`(?i)\b(?:results[- ]based|if i (?:help|bring)|help .{0,80} achieve|bring .{0,30} orders?)\b`)
	orderVolumeTargetPattern           = regexp.MustCompile(`(?i)\b\d{1,3}\s*(?:[-/–—]\s*\d{1,3})?\s+(?:verified\s+)?orders?\b`)
	commissionOfferPattern             = regexp.MustCompile(`(?i)\b(?:\d{1,2}(?:\.\d+)?\s*%\s+commission|commission .{0,24}(?:fair|work|acceptable))\b`)
	shortAcquisitionWindowPattern      = regexp.MustCompile(`(?i)\b(?:within (?:the )?next \d+\s+(?:hours?|days?|weeks?)|in \d+\s+(?:hours?|days?|weeks?))\b`)
	whatsAppContactPattern             = regexp.MustCompile(`(?i)\bwhats?app\b`)
	webshopOrderBenchmarkPattern       = regexp.MustCompile(`(?i)\bhas your (?:webshop|online store) reached \d{1,3}\s*(?:[-/–—]\s*\d{1,3})?\s*[-–—]?\s+orders?\s+in\s+the\s+(?:previous|last)\s+\d{1,3}\s+days?\b`)
	openIdeaExactPattern               = regexp.MustCompile(`(?i)^would you be open to hearing an idea\??$`)
	marketingIdentitySenderPattern     = regexp.MustCompile(`(?i)^[^@]*(?:agency|consult|expert|growth|marketing|professional)[0-9._+\-]*@`)
	customerMarketingPreferencePattern = regexp.MustCompile(`(?i)\b(?:please\s+)?(?:unsubscribe|remove)\s+me\b|\bstop\s+(?:sending|emailing)\s+(?:me\s+)?(?:these|marketing|promotional|product update)?\s*emails?\b|\bi\s+(?:do not|don't|no longer)\s+want\s+(?:these|marketing|promotional|product update)?\s*emails?\b`)
)

var berryStrongPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bberry\s+agency\b`),
	regexp.MustCompile(`(?i)\bindependent\s+commerce\s+analyst\b`),
	regexp.MustCompile(`(?i)\bberryagency\.lovable\.app(?:/services)?\b`),
}

var berryTopicGroups = [][]*regexp.Regexp{
	{
		regexp.MustCompile(`(?i)\babout to leave your (?:website|store|site)\b`),
		regexp.MustCompile(`(?i)\b(?:visited|reviewed|looked at|was browsing) your (?:website|store|site)\b`),
	},
	{
		regexp.MustCompile(`(?i)\bstore is getting the results it (?:truly )?deserves\b`),
		regexp.MustCompile(`(?i)\bproducts? (?:are|is) not the problem\b`),
		regexp.MustCompile(`(?i)\bharder for visitors to become customers\b`),
	},
	{
		regexp.MustCompile(`(?i)\bhappy to share what stood out to me\b`),
		regexp.MustCompile(`(?i)\bobservations? (?:i mentioned )?(?:are|is) still available\b`),
		regexp.MustCompile(`(?i)\b(?:send|share) (?:them|it|the report|my findings) (?:over|with you)\b`),
		regexp.MustCompile(`(?i)\breport\s+prepared\s+by\b`),
	},
	{
		regexp.MustCompile(`(?i)\blast email slipped through the cracks\b`),
		regexp.MustCompile(`(?i)\bhaven'?t had a chance to reply\b`),
		regexp.MustCompile(`(?i)\bjust wanted to check in\b`),
	},
}

var shopifyGrowthFollowUpPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bthis will be my last follow[- ]?up\b`),
	regexp.MustCompile(`(?i)\bgrowing your shopify store\b`),
	regexp.MustCompile(`(?i)\b(?:help with|assist with) in the future\b`),
	regexp.MustCompile(`(?i)\bfeel free to reach out anytime\b`),
	regexp.MustCompile(`(?i)\bwishing you continued success with your business\b`),
}

var incomingEmailFilterRules = []emailFilterRule{
	{
		ID:       "shopify-store-relay-v1",
		Category: emailFilterCategorySenderBlacklist,
		Enabled:  true,
		Match: func(input emailFilterContext) bool {
			return isDiscardedEmailSender(input.SenderEmail, input.SenderName)
		},
	},
	{
		ID:       "store-conversion-audit-outreach-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesStoreConversionAuditOutreach,
	},
	{
		ID:       "commission-order-acquisition-outreach-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesCommissionOrderAcquisitionOutreach,
	},
	{
		ID:       "shopify-growth-followup-outreach-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesShopifyGrowthFollowUpOutreach,
	},
	{
		ID:       "webshop-order-benchmark-outreach-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesWebshopOrderBenchmarkOutreach,
	},
	{
		ID:       "open-idea-role-sender-outreach-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesOpenIdeaRoleSenderOutreach,
	},
	{
		ID:       "automated-explicit-marketing-v1",
		Category: emailFilterCategoryMarketing,
		Enabled:  true,
		Match:    matchesAutomatedExplicitMarketing,
	},
}

func isDiscardedEmailSender(senderEmail string, senderName string) bool {
	return strings.TrimSpace(senderName) != "" && shopifyStoreSenderPattern.MatchString(normalizeEmail(senderEmail))
}

func shouldDiscardIncomingEmail(input incomingEmailMessage) bool {
	return isDiscardedEmailSender(input.SenderEmail, input.SenderName)
}

func evaluateIncomingEmailFilter(input incomingEmailMessage) emailFilterDecision {
	currentBody := stripQuotedEmailHistoryForSubject(input.Body, input.Subject)
	context := emailFilterContext{
		SenderEmail: normalizeEmail(input.SenderEmail),
		SenderName:  normalizeEmailFilterText(input.SenderName),
		Subject:     normalizeEmailFilterText(input.Subject),
		CurrentBody: normalizeEmailFilterText(currentBody),
	}
	context.Content = strings.TrimSpace(context.Subject + "\n" + context.CurrentBody)
	if input.ClassificationReason == relayedCustomerInquiryClassification ||
		customerServiceIntentPattern.MatchString(context.CurrentBody) ||
		customerMarketingPreferencePattern.MatchString(context.CurrentBody) {
		return emailFilterDecision{}
	}
	for _, rule := range incomingEmailFilterRules {
		if rule.Enabled && rule.Match != nil && rule.Match(context) {
			return emailFilterDecision{Filtered: true, RuleID: rule.ID, Category: rule.Category}
		}
	}
	if matchesPotentialMarketingReview(context) {
		return emailFilterDecision{
			Review:   true,
			RuleID:   "suspected-marketing-pending-review-v1",
			Category: emailFilterCategoryMarketing,
		}
	}
	return emailFilterDecision{}
}

func applyIncomingEmailFilterDecision(input *incomingEmailMessage) emailFilterDecision {
	if input == nil {
		return emailFilterDecision{}
	}
	decision := evaluateIncomingEmailFilter(*input)
	if decision.Filtered {
		input.Classification = "filtered"
		input.ClassificationReason = "email filtered locally by rule " + decision.RuleID + " (" + string(decision.Category) + ")"
	} else if decision.Review {
		input.Classification = ConversationKindSystem
		input.ClassificationReason = suspectedMarketingReviewClassification
	}
	return decision
}

func matchesPotentialMarketingReview(input emailFilterContext) bool {
	if operationalEmailPattern.MatchString(input.Content) ||
		customerServiceIntentPattern.MatchString(input.CurrentBody) ||
		customerMarketingPreferencePattern.MatchString(input.CurrentBody) {
		return false
	}
	if explicitMarketingPattern.MatchString(input.Content) {
		return true
	}
	partialAcquisitionSignals := 0
	for _, pattern := range []*regexp.Regexp{
		orderAcquisitionProposalPattern,
		orderVolumeTargetPattern,
		commissionOfferPattern,
		shortAcquisitionWindowPattern,
		whatsAppContactPattern,
	} {
		if pattern.MatchString(input.CurrentBody) {
			partialAcquisitionSignals++
		}
	}
	return partialAcquisitionSignals >= 2 ||
		countEmailFilterTopicGroups(input.CurrentBody, berryTopicGroups) >= 2 ||
		countEmailFilterPatternMatches(input.CurrentBody, shopifyGrowthFollowUpPatterns) >= 2 ||
		openIdeaExactPattern.MatchString(input.CurrentBody)
}

func matchesAutomatedExplicitMarketing(input emailFilterContext) bool {
	automatedSender := automatedMarketingSenderPattern.MatchString(input.SenderEmail) ||
		automatedMarketingNamePattern.MatchString(input.SenderName)
	if !automatedSender || operationalEmailPattern.MatchString(input.Content) {
		return false
	}
	return explicitMarketingPattern.MatchString(input.Content)
}

func matchesStoreConversionAuditOutreach(input emailFilterContext) bool {
	if customerServiceIntentPattern.MatchString(input.CurrentBody) {
		return false
	}
	strongSignals := countEmailFilterPatternMatches(input.Content, berryStrongPatterns)
	topicSignals := countEmailFilterTopicGroups(input.CurrentBody, berryTopicGroups)
	if strongSignals >= 1 && topicSignals >= 1 {
		return true
	}
	if topicSignals >= 3 {
		return true
	}
	return berrySubjectPattern.MatchString(input.Subject) && topicSignals >= 2
}

func matchesCommissionOrderAcquisitionOutreach(input emailFilterContext) bool {
	if customerServiceIntentPattern.MatchString(input.CurrentBody) {
		return false
	}
	return orderAcquisitionProposalPattern.MatchString(input.CurrentBody) &&
		orderVolumeTargetPattern.MatchString(input.CurrentBody) &&
		commissionOfferPattern.MatchString(input.CurrentBody) &&
		(shortAcquisitionWindowPattern.MatchString(input.CurrentBody) ||
			whatsAppContactPattern.MatchString(input.CurrentBody))
}

func matchesShopifyGrowthFollowUpOutreach(input emailFilterContext) bool {
	if customerServiceIntentPattern.MatchString(input.CurrentBody) {
		return false
	}
	return countEmailFilterPatternMatches(input.CurrentBody, shopifyGrowthFollowUpPatterns) >= 3
}

func matchesWebshopOrderBenchmarkOutreach(input emailFilterContext) bool {
	if customerServiceIntentPattern.MatchString(input.CurrentBody) {
		return false
	}
	return webshopOrderBenchmarkPattern.MatchString(input.CurrentBody)
}

func matchesOpenIdeaRoleSenderOutreach(input emailFilterContext) bool {
	if customerServiceIntentPattern.MatchString(input.CurrentBody) || strings.TrimSpace(input.Subject) != "" {
		return false
	}
	return openIdeaExactPattern.MatchString(input.CurrentBody) &&
		marketingIdentitySenderPattern.MatchString(input.SenderEmail)
}

func countEmailFilterPatternMatches(value string, patterns []*regexp.Regexp) int {
	count := 0
	for _, pattern := range patterns {
		if pattern.MatchString(value) {
			count++
		}
	}
	return count
}

func countEmailFilterTopicGroups(value string, groups [][]*regexp.Regexp) int {
	count := 0
	for _, group := range groups {
		if countEmailFilterPatternMatches(value, group) > 0 {
			count++
		}
	}
	return count
}

func normalizeEmailFilterText(value string) string {
	value = strings.NewReplacer(
		"\u00a0", " ",
		"\u2018", "'",
		"\u2019", "'",
		"\u201c", "\"",
		"\u201d", "\"",
	).Replace(value)
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}
