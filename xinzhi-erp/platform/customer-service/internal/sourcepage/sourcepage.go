package sourcepage

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
	"shopify-support-platform/internal/winexec"
)

type reusableTargetAction string

const (
	reusableTargetActivate reusableTargetAction = "activate"
	reusableTargetNavigate reusableTargetAction = "navigate"
)

func BringToFront(openResult appcore.OpenResult, conversation appcore.Conversation) error {
	if openResult.WebDriverURL == "" {
		return fmt.Errorf("缺少 DevTools 地址")
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err != nil {
		return err
	}
	targets, err := cdp.ListTargets(openResult.WebDriverURL, 8*time.Second)
	if err != nil {
		return err
	}
	var best cdp.Target
	bestScore := 0
	for _, target := range targets {
		score := scoreTarget(target, conversation, openResult.ShopName)
		if score > bestScore {
			bestScore = score
			best = target
		}
	}
	if best.ID == "" || bestScore < 35 {
		return fmt.Errorf("没有找到足够匹配的来源页面，已停止前置，避免拉错窗口")
	}
	return activateTargetAndRaiseBrowser(openResult, best, false)
}

func OpenSource(openResult appcore.OpenResult, conversation appcore.Conversation) error {
	if conversation.SourceURL == "" {
		return fmt.Errorf("该会话没有来源页面 URL")
	}
	if openResult.WebDriverURL == "" {
		return fmt.Errorf("缺少 DevTools 地址")
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err != nil {
		return err
	}
	return openOrReuseTarget(openResult, conversation.SourceURL)
}

func OpenConversationLink(openResult appcore.OpenResult, conversation appcore.Conversation, rawURL string) error {
	if openResult.WebDriverURL == "" {
		return fmt.Errorf("\u7f3a\u5c11 DevTools \u5730\u5740")
	}
	if err := ValidateOpenResultForConversation(openResult, conversation); err != nil {
		return err
	}
	targetURL, err := validateConversationLink(conversation, rawURL)
	if err != nil {
		return err
	}
	return openOrReuseTarget(openResult, targetURL)
}

func OpenURL(openResult appcore.OpenResult, rawURL string) error {
	if openResult.WebDriverURL == "" {
		return fmt.Errorf("missing DevTools URL")
	}
	targetURL, err := validateHTTPURL(rawURL)
	if err != nil {
		return err
	}
	return openOrReuseTarget(openResult, targetURL)
}

func OpenURLBestEffortFocus(openResult appcore.OpenResult, rawURL string) error {
	if openResult.WebDriverURL == "" {
		return fmt.Errorf("missing DevTools URL")
	}
	targetURL, err := validateHTTPURL(rawURL)
	if err != nil {
		return err
	}
	return openOrReuseTargetWithFocus(openResult, targetURL, true)
}

func openOrReuseTarget(openResult appcore.OpenResult, targetURL string) error {
	return openOrReuseTargetWithFocus(openResult, targetURL, false)
}

func openOrReuseTargetWithFocus(openResult appcore.OpenResult, targetURL string, bestEffortFocus bool) error {
	targets, err := cdp.ListTargets(openResult.WebDriverURL, 8*time.Second)
	if err != nil {
		return err
	}
	if target, action, ok := selectReusableTarget(targets, targetURL); ok {
		if action == reusableTargetNavigate {
			if err := navigateTarget(target, targetURL); err != nil {
				return err
			}
			target = refreshTarget(openResult.WebDriverURL, target.ID, target)
		}
		return activateTargetAndRaiseBrowser(openResult, target, bestEffortFocus)
	}
	target, err := cdp.CreateTarget(openResult.WebDriverURL, targetURL, 8*time.Second)
	if err != nil {
		return err
	}
	target = refreshTarget(openResult.WebDriverURL, target.ID, target)
	return activateTargetAndRaiseBrowser(openResult, target, bestEffortFocus)
}

func navigateTarget(target cdp.Target, targetURL string) error {
	if target.WebSocketURL == "" {
		return cdp.ErrNoTarget
	}
	session, err := cdp.NewClient(target.WebSocketURL, 8*time.Second)
	if err != nil {
		return err
	}
	defer session.Close()
	return session.Navigate(targetURL, 1200*time.Millisecond)
}

func activateTargetAndRaiseBrowser(openResult appcore.OpenResult, target cdp.Target, bestEffortFocus bool) error {
	if err := cdp.ActivateTarget(openResult.WebDriverURL, target.ID, 8*time.Second); err != nil {
		return err
	}
	err := winexec.BringBrowserToFront(winexec.BrowserOpenResult{
		ShopName:        openResult.ShopName,
		WebDriverURL:    openResult.WebDriverURL,
		DebuggerAddress: openResult.DebuggerAddress,
		OpenResponse:    openResult.OpenResponse,
		WebDriverRaw:    openResult.WebDriverRaw,
	}, target.Title)
	if err != nil && bestEffortFocus {
		return nil
	}
	return err
}

func refreshTarget(baseURL string, targetID string, fallback cdp.Target) cdp.Target {
	targets, err := cdp.ListTargets(baseURL, 3*time.Second)
	if err != nil {
		return fallback
	}
	for _, target := range targets {
		if target.ID == targetID {
			return target
		}
	}
	return fallback
}

func selectReusableTarget(targets []cdp.Target, targetURL string) (cdp.Target, reusableTargetAction, bool) {
	for _, target := range targets {
		if sameNormalizedURL(target.URL, targetURL) {
			return target, reusableTargetActivate, true
		}
	}

	targetInfo, ok := parseReusableURL(targetURL)
	if !ok || targetInfo.storeSlug == "" {
		return cdp.Target{}, "", false
	}
	if targetInfo.kind == reusableURLInbox {
		for _, target := range targets {
			if info, ok := parseReusableURL(target.URL); ok && info.kind == reusableURLInbox && strings.EqualFold(info.storeSlug, targetInfo.storeSlug) {
				return target, reusableTargetNavigate, true
			}
		}
		for _, target := range targets {
			if info, ok := parseReusableURL(target.URL); ok && info.kind == reusableURLAdminInbox && strings.EqualFold(info.storeSlug, targetInfo.storeSlug) {
				return target, reusableTargetNavigate, true
			}
		}
	}
	if targetInfo.kind == reusableURLAdminAllowed {
		for _, target := range targets {
			if info, ok := parseReusableURL(target.URL); ok && info.kind == reusableURLAdminAllowed && strings.EqualFold(info.storeSlug, targetInfo.storeSlug) {
				return target, reusableTargetNavigate, true
			}
		}
	}
	return cdp.Target{}, "", false
}

func ValidateOpenResultForConversation(openResult appcore.OpenResult, conversation appcore.Conversation) error {
	if conversation.MallID != "" && openResult.MallID == "" {
		return fmt.Errorf("当前浏览器环境缺少会话环境标识，已阻止打开")
	}
	if conversation.MallID != "" && !strings.EqualFold(conversation.MallID, openResult.MallID) {
		return fmt.Errorf("链接所属会话环境与当前浏览器环境不一致，已阻止打开")
	}
	if conversation.ShopName != "" && openResult.ShopName == "" {
		return fmt.Errorf("当前浏览器环境缺少店铺标识，已阻止打开")
	}
	if conversation.ShopName != "" && !strings.EqualFold(conversation.ShopName, openResult.ShopName) {
		return fmt.Errorf("链接所属店铺与当前浏览器店铺不一致，已阻止打开")
	}
	if conversation.ShopKey != "" {
		parts := strings.Split(conversation.ShopKey, "_")
		if len(parts) >= 3 {
			adapterName := parts[0]
			adapterInstance := parts[1]
			mallID := strings.Join(parts[2:], "_")
			if openResult.AdapterName == "" {
				return fmt.Errorf("当前浏览器环境缺少浏览器类型标识，已阻止打开")
			}
			if !strings.EqualFold(openResult.AdapterName, adapterName) {
				return fmt.Errorf("链接所属浏览器类型与当前浏览器类型不一致，已阻止打开")
			}
			if openResult.AdapterInstance == "" {
				return fmt.Errorf("当前浏览器环境缺少浏览器实例标识，已阻止打开")
			}
			if !strings.EqualFold(openResult.AdapterInstance, adapterInstance) {
				return fmt.Errorf("链接所属浏览器实例与当前浏览器实例不一致，已阻止打开")
			}
			if mallID != "" && openResult.MallID == "" {
				return fmt.Errorf("当前浏览器环境缺少会话环境标识，已阻止打开")
			}
			if mallID != "" && !strings.EqualFold(openResult.MallID, mallID) {
				return fmt.Errorf("链接所属会话环境与当前浏览器环境不一致，已阻止打开")
			}
		}
	}
	return nil
}

func isEmailSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "outlook", "gmail", "fastmo", "cuiqiu", "email":
		return true
	default:
		return false
	}
}

func validateHTTPURL(rawURL string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", fmt.Errorf("link is empty")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid link")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported link scheme")
	}
	return parsed.String(), nil
}

func validateConversationLink(conversation appcore.Conversation, rawURL string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", fmt.Errorf("\u94fe\u63a5\u4e3a\u7a7a\uff0c\u5df2\u963b\u6b62\u6253\u5f00")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("\u53ea\u80fd\u6253\u5f00\u5df2\u8bc6\u522b\u7684 Shopify \u5b8c\u6574\u94fe\u63a5")
	}
	host := strings.ToLower(parsed.Host)
	isProductPage := strings.Contains(strings.ToLower(parsed.Path), "/products/")
	isStorefrontOrderPage := strings.Contains(strings.ToLower(parsed.Path), "/orders/") || strings.Contains(strings.ToLower(parsed.Path), "/checkouts/")
	if host != "admin.shopify.com" && host != "inbox.shopify.com" && !isProductPage && !isStorefrontOrderPage {
		return "", fmt.Errorf("\u975e Shopify \u7ba1\u7406\u6216 Inbox \u94fe\u63a5\uff0c\u5df2\u963b\u6b62\u6253\u5f00")
	}
	if host == "admin.shopify.com" && !regexp.MustCompile(`^/store/[^/]+/(orders|checkouts|customers|products)(/|$)`).MatchString(parsed.Path) {
		return "", fmt.Errorf("\u4ec5\u5141\u8bb8\u6253\u5f00\u8ba2\u5355\u3001\u8d2d\u7269\u8f66\u3001\u5ba2\u6237\u6216\u4ea7\u54c1\u9875")
	}
	sourceSlug := extractStoreSlug(conversation.SourceURL)
	linkSlug := extractStoreSlug(rawURL)
	if sourceSlug != "" && linkSlug != "" && !strings.EqualFold(sourceSlug, linkSlug) {
		return "", fmt.Errorf("\u94fe\u63a5\u6240\u5c5e\u5e97\u94fa\u4e0e\u5f53\u524d\u4f1a\u8bdd\u4e0d\u4e00\u81f4\uff0c\u5df2\u963b\u6b62")
	}
	return parsed.String(), nil
}

type reusableURLKind int

const (
	reusableURLOther reusableURLKind = iota
	reusableURLInbox
	reusableURLAdminInbox
	reusableURLAdminAllowed
)

type reusableURLInfo struct {
	kind      reusableURLKind
	storeSlug string
}

func parseReusableURL(rawURL string) (reusableURLInfo, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return reusableURLInfo{}, false
	}
	host := strings.ToLower(parsed.Host)
	path := strings.TrimRight(parsed.EscapedPath(), "/")
	if host == "inbox.shopify.com" {
		if slug := storeSlugFromPath(path); slug != "" {
			return reusableURLInfo{kind: reusableURLInbox, storeSlug: slug}, true
		}
	}
	if host == "admin.shopify.com" {
		slug := storeSlugFromPath(path)
		if slug == "" {
			return reusableURLInfo{}, false
		}
		if regexp.MustCompile(`^/store/[^/]+/apps/shopify-inbox(/|$)`).MatchString(path) {
			return reusableURLInfo{kind: reusableURLAdminInbox, storeSlug: slug}, true
		}
		if regexp.MustCompile(`^/store/[^/]+/(orders|checkouts|customers|products)(/|$)`).MatchString(path) {
			return reusableURLInfo{kind: reusableURLAdminAllowed, storeSlug: slug}, true
		}
		return reusableURLInfo{kind: reusableURLOther, storeSlug: slug}, true
	}
	return reusableURLInfo{}, false
}

func sameNormalizedURL(left string, right string) bool {
	leftParsed, leftErr := url.Parse(strings.TrimSpace(left))
	rightParsed, rightErr := url.Parse(strings.TrimSpace(right))
	if leftErr == nil && rightErr == nil && leftParsed.Host != "" && rightParsed.Host != "" {
		leftParsed.Path = strings.TrimRight(leftParsed.Path, "/")
		rightParsed.Path = strings.TrimRight(rightParsed.Path, "/")
		return strings.EqualFold(leftParsed.String(), rightParsed.String())
	}
	return strings.EqualFold(strings.TrimRight(strings.TrimSpace(left), "/"), strings.TrimRight(strings.TrimSpace(right), "/"))
}

func scoreTarget(target cdp.Target, conversation appcore.Conversation, shopName string) int {
	haystack := strings.ToLower(target.URL + " " + target.Title)
	score := 0
	if conversation.SourceURL != "" && strings.EqualFold(strings.TrimRight(target.URL, "/"), strings.TrimRight(conversation.SourceURL, "/")) {
		score += 80
	}
	if conversation.ConversationID != "" && strings.Contains(haystack, strings.ToLower(conversation.ConversationID)) {
		score += 60
	}
	for _, value := range []string{conversation.CustomerEmail, conversation.CustomerName, conversation.CustomerFullName, shopName} {
		value = strings.ToLower(strings.TrimSpace(value))
		if len(value) >= 4 && strings.Contains(haystack, value) {
			score += 25
		}
	}
	if conversation.Source == "inbox" && strings.Contains(haystack, "inbox.shopify.com") {
		score += 20
	}
	if conversation.Source == "outlook" && strings.Contains(haystack, "outlook") {
		score += 20
	}
	if conversation.Source == "gmail" && strings.Contains(haystack, "mail.google") {
		score += 20
	}
	if conversation.Source == "fastmo" && strings.Contains(haystack, "fastmo") {
		score += 20
	}
	if conversation.Source == "cuiqiu" && (strings.Contains(haystack, "mail-client.cuiqiu.com") || strings.Contains(haystack, "cuiqiu") || strings.Contains(haystack, "fastmo")) {
		score += 20
	}
	return score
}

func extractStoreSlug(rawURL string) string {
	match := regexp.MustCompile(`/store/([^/?#]+)`).FindStringSubmatch(rawURL)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func storeSlugFromPath(path string) string {
	match := regexp.MustCompile(`^/store/([^/?#]+)(?:/|$)`).FindStringSubmatch(path)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}
