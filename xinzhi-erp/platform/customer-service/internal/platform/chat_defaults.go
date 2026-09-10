package platform

const defaultVisitorSchemeID = "visitor_scheme_default"
const defaultVisitorSchemeName = "默认方案"

const defaultShopifyChatInstantAnswersJSON = `[{"id":"track_order","title":"Track my order","answer":"Enter your order number and email address to see the latest order and tracking status.","mode":"order_tracking","enabled":true,"sort":0}]`

const shopifyChatInstantAnswersVersion = "1"
const shopifyChatCustomerLoginRequiredKey = "customerLoginRequired"

func shopifyChatCustomerLoginRequired(metadata map[string]string) bool {
	return metadata == nil || metadata[shopifyChatCustomerLoginRequiredKey] != "false"
}

func withShopifyChatDefaults(source ShopSource) ShopSource {
	if source.Type != SourceTypeShopifyChat {
		return source
	}
	metadata := make(map[string]string, len(source.Metadata)+3)
	for key, value := range source.Metadata {
		metadata[key] = value
	}
	if _, exists := metadata["visitorLanguage"]; !exists {
		metadata["visitorLanguage"] = "auto"
	}
	if _, exists := metadata[shopifyChatCustomerLoginRequiredKey]; !exists {
		metadata[shopifyChatCustomerLoginRequiredKey] = "true"
	}
	if metadata["visitorSchemeId"] == "" && metadata["visitorSchemeName"] == "" {
		metadata["visitorSchemeId"] = defaultVisitorSchemeID
		metadata["visitorSchemeName"] = defaultVisitorSchemeName
	}
	if metadata["instantAnswersVersion"] == "" {
		metadata["instantAnswersEnabled"] = "true"
		metadata["instantAnswersVersion"] = shopifyChatInstantAnswersVersion
	} else if _, exists := metadata["instantAnswersEnabled"]; !exists {
		metadata["instantAnswersEnabled"] = "true"
	}
	if metadata["instantAnswersJson"] == "" {
		metadata["instantAnswersJson"] = defaultShopifyChatInstantAnswersJSON
	}
	source.Metadata = metadata
	return source
}
