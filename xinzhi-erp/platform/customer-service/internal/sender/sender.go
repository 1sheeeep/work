package sender

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
)

type logger interface {
	Append(event string, details any)
}

type SendOptions struct {
	ActivateTarget     bool
	ManualEmailAccount string
}

func Send(openResult appcore.OpenResult, conversation appcore.Conversation, replyText string, log logger) (appcore.SendResult, error) {
	return SendWithOptions(openResult, conversation, replyText, SendOptions{ActivateTarget: true}, log)
}

func SendWithOptions(openResult appcore.OpenResult, conversation appcore.Conversation, replyText string, options SendOptions, log logger) (appcore.SendResult, error) {
	text := strings.TrimSpace(replyText)
	if text == "" {
		return fail(conversation.Source, "empty_reply", "回复内容为空")
	}
	if openResult.WebDriverURL == "" {
		return fail(conversation.Source, "missing_devtools", "缺少 DevTools 地址")
	}
	manualEmailAccount := strings.ToLower(strings.TrimSpace(options.ManualEmailAccount))
	if isEmailSource(conversation.Source) && manualEmailAccount != "" {
		conversation.EmailAccount = manualEmailAccount
	}
	target, err := findOrOpenTarget(openResult, conversation, manualEmailAccount)
	if err != nil {
		return fail(conversation.Source, "target_not_found", err.Error())
	}
	if options.ActivateTarget {
		_ = cdp.ActivateTarget(openResult.WebDriverURL, target.ID, 8*time.Second)
	}
	session, err := cdp.NewClient(target.WebSocketURL, 15*time.Second)
	if err != nil {
		return appcore.SendResult{}, err
	}
	defer session.Close()
	if conversation.SourceURL != "" && conversation.Source == "inbox" {
		_ = session.Navigate(conversation.SourceURL, 4*time.Second)
		if err := waitForInboxDetailPage(session, conversation, 12*time.Second); err != nil {
			return fail(conversation.Source, "page_validation_failed", err.Error())
		}
	}
	if isEmailSource(conversation.Source) {
		if strings.TrimSpace(conversation.SourceURL) == "" {
			return fail(conversation.Source, "page_validation_failed", "邮箱会话缺少精确邮件链接，已阻止发送")
		}
		if err := session.Navigate(conversation.SourceURL, 1500*time.Millisecond); err != nil {
			return fail(conversation.Source, "page_validation_failed", err.Error())
		}
		if err := waitForEmailDetailPage(session, conversation, 12*time.Second); err != nil {
			return fail(conversation.Source, "page_validation_failed", err.Error())
		}
	}
	if err := validatePage(session, conversation); err != nil {
		return fail(conversation.Source, "page_validation_failed", err.Error())
	}
	verificationWarning := ""
	if conversation.Source == "inbox" {
		if err := fillAndSendInbox(session, text); err != nil {
			return fail(conversation.Source, "send_failed", err.Error())
		}
		if err := verifyInboxReplySent(session, text); err != nil {
			return fail(conversation.Source, "send_not_verified", err.Error())
		}
	} else {
		if err := fillAndSend(session, text); err != nil {
			return fail(conversation.Source, "send_failed", err.Error())
		}
	}
	if isEmailSource(conversation.Source) {
		if err := verifyEmailReplySent(session, text); err != nil {
			if !isSoftEmailSendVerificationFailure(err.Error()) {
				return fail(conversation.Source, "send_not_verified", err.Error())
			}
			verificationWarning = err.Error()
			if log != nil {
				log.Append("reply.send.verify.warning", map[string]any{"source": conversation.Source, "customer": conversation.CustomerName, "warning": verificationWarning})
			}
		}
	}
	message := "已发送，并通过页面校验"
	code := ""
	if verificationWarning != "" {
		message = "已发送，但当前邮件线程暂未回显发送内容"
		code = "send_verify_warning"
	}
	result := appcore.SendResult{OK: true, Source: conversation.Source, Message: message, SentAt: time.Now().Format(time.RFC3339), Error: code}
	if log != nil {
		log.Append("reply.send.ok", map[string]any{"source": conversation.Source, "customer": conversation.CustomerName, "reply_preview": preview(text), "activated": options.ActivateTarget, "verify_warning": verificationWarning})
	}
	return result, nil
}

func fail(source string, code string, message string) (appcore.SendResult, error) {
	message = strings.TrimSpace(message)
	if message == "" || message == "<nil>" {
		message = "发送失败：页面未返回具体错误"
	}
	return appcore.SendResult{OK: false, Source: source, Error: code, Message: message}, errors.New(message)
}

func findOrOpenTarget(openResult appcore.OpenResult, conversation appcore.Conversation, manualEmailAccount string) (cdp.Target, error) {
	targets, err := cdp.ListTargets(openResult.WebDriverURL, 8*time.Second)
	if err != nil {
		return cdp.Target{}, err
	}
	if isEmailSource(conversation.Source) {
		if target, ok := selectEmailSendTarget(targets, conversation, manualEmailAccount); ok {
			return target, nil
		}
		if strings.TrimSpace(manualEmailAccount) != "" {
			return cdp.Target{}, fmt.Errorf("未找到已配置客服邮箱 %s 的邮箱页面，已阻止发送", manualEmailAccount)
		}
		sourceURL := strings.TrimSpace(conversation.SourceURL)
		if sourceURL == "" {
			return cdp.Target{}, fmt.Errorf("未找到当前店铺环境里的邮箱发送页面，且会话缺少邮箱来源链接，已阻止发送")
		}
		target, err := cdp.CreateTarget(openResult.WebDriverURL, sourceURL, 8*time.Second)
		if err != nil {
			return cdp.Target{}, fmt.Errorf("未能打开邮箱发送页面：%w", err)
		}
		return refreshTarget(openResult.WebDriverURL, target.ID, target), nil
	}
	if conversation.Source == "inbox" && conversation.SourceURL != "" {
		if target, ok := selectInboxSendTarget(targets, conversation.SourceURL); ok {
			return target, nil
		}
		target, err := cdp.CreateTarget(openResult.WebDriverURL, conversation.SourceURL, 8*time.Second)
		if err == nil {
			return refreshTarget(openResult.WebDriverURL, target.ID, target), nil
		}
	}
	bestScore := 0
	var best cdp.Target
	for _, target := range targets {
		score := scoreTarget(target, conversation, openResult.ShopName)
		if score > bestScore {
			bestScore = score
			best = target
		}
	}
	if bestScore < 35 {
		return cdp.Target{}, fmt.Errorf("未找到足够匹配的发送页面，已阻止发送")
	}
	return best, nil
}

func isEmailSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "outlook", "gmail", "fastmo", "cuiqiu", "email":
		return true
	default:
		return false
	}
}

func selectEmailSendTarget(targets []cdp.Target, conversation appcore.Conversation, manualEmailAccount ...string) (cdp.Target, bool) {
	requiredEmail := ""
	if len(manualEmailAccount) > 0 {
		requiredEmail = strings.ToLower(strings.TrimSpace(manualEmailAccount[0]))
	}
	var best cdp.Target
	bestScore := 0
	for _, target := range targets {
		if requiredEmail != "" && !targetContainsEmailAccount(target, requiredEmail) {
			continue
		}
		score := scoreEmailSendTarget(target, conversation)
		if score > bestScore {
			bestScore = score
			best = target
		}
	}
	return best, bestScore >= 40
}

func targetContainsEmailAccount(target cdp.Target, email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return true
	}
	haystack := strings.ToLower(target.URL + " " + target.Title)
	return strings.Contains(haystack, email)
}

func scoreEmailSendTarget(target cdp.Target, conversation appcore.Conversation) int {
	haystack := strings.ToLower(target.URL + " " + target.Title)
	score := 0
	if conversation.SourceURL != "" && sameNormalizedURL(target.URL, conversation.SourceURL) {
		score += 80
	}
	switch strings.ToLower(strings.TrimSpace(conversation.Source)) {
	case "outlook":
		if strings.Contains(haystack, "outlook.live.com/mail") || strings.Contains(haystack, "outlook.office.com/mail") {
			score += 50
		} else if strings.Contains(haystack, "outlook") {
			score += 35
		}
	case "gmail":
		if strings.Contains(haystack, "mail.google.com/mail") {
			score += 50
		}
	case "fastmo":
		if strings.Contains(haystack, "fastmo") {
			score += 50
		}
	case "cuiqiu":
		if strings.Contains(haystack, "mail-client.cuiqiu.com") || strings.Contains(haystack, "cuiqiu") || strings.Contains(haystack, "fastmo") {
			score += 50
		}
	case "email":
		if strings.Contains(haystack, "outlook.live.com/mail") || strings.Contains(haystack, "outlook.office.com/mail") || strings.Contains(haystack, "mail.google.com/mail") || strings.Contains(haystack, "mail-client.cuiqiu.com") || strings.Contains(haystack, "cuiqiu") || strings.Contains(haystack, "fastmo") {
			score += 40
		}
	}
	for _, value := range []string{conversation.EmailAccount, conversation.CustomerEmail, conversation.CustomerName, conversation.CustomerFullName, conversation.Preview} {
		value = strings.ToLower(strings.TrimSpace(value))
		if len(value) >= 4 && strings.Contains(haystack, value) {
			if value == strings.ToLower(strings.TrimSpace(conversation.EmailAccount)) {
				score += 80
			} else {
				score += 15
			}
		}
	}
	if strings.Contains(haystack, "service worker") || strings.Contains(haystack, "rotatecookies") || strings.HasPrefix(strings.TrimSpace(strings.ToLower(target.URL)), "blob:") {
		score -= 100
	}
	return score
}

func selectInboxSendTarget(targets []cdp.Target, sourceURL string) (cdp.Target, bool) {
	for _, target := range targets {
		if sameNormalizedURL(target.URL, sourceURL) {
			return target, true
		}
	}
	sourceSlug := extractStoreSlug(sourceURL)
	if sourceSlug == "" {
		return cdp.Target{}, false
	}
	for _, target := range targets {
		targetURL := strings.ToLower(strings.TrimSpace(target.URL))
		if strings.Contains(targetURL, "inbox.shopify.com/store/") && strings.EqualFold(extractStoreSlug(target.URL), sourceSlug) {
			return target, true
		}
	}
	return cdp.Target{}, false
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

func extractStoreSlug(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err == nil && parsed.Path != "" {
		return storeSlugFromPath(parsed.EscapedPath())
	}
	return storeSlugFromPath(rawURL)
}

func storeSlugFromPath(path string) string {
	match := regexp.MustCompile(`(?:^|/)store/([^/?#]+)(?:/|$)`).FindStringSubmatch(path)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func extractInboxConversationID(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	path := rawURL
	if err == nil && parsed.Path != "" {
		path = parsed.EscapedPath()
	}
	match := regexp.MustCompile(`(?:^|/)conversations/(?:unread|open|closed)/([^/?#]+)(?:/|$)`).FindStringSubmatch(path)
	if len(match) > 1 {
		if value, err := url.PathUnescape(match[1]); err == nil {
			return value
		}
		return match[1]
	}
	return ""
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

func validatePage(session *cdp.Client, conversation appcore.Conversation) error {
	if isEmailSource(conversation.Source) {
		return validateEmailDetailPage(session, conversation)
	}
	value, _ := session.Evaluate("document.body ? document.body.innerText : ''")
	text := strings.ToLower(fmt.Sprint(value))
	needles := []string{conversation.CustomerEmail, conversation.CustomerName, conversation.CustomerFullName, conversation.Preview}
	found := 0
	for _, needle := range needles {
		needle = strings.ToLower(strings.TrimSpace(needle))
		if len(needle) >= 4 && strings.Contains(text, needle) {
			found++
		}
	}
	if found == 0 {
		if inboxURLMatchesSelectedConversation(session, conversation, text) {
			return nil
		}
		return fmt.Errorf("当前页面无法确认客户或最新消息，已阻止发送")
	}
	if conversation.CustomerEmail != "" && !strings.Contains(text, strings.ToLower(conversation.CustomerEmail)) && conversation.Source != "inbox" && !emailAddressMismatchAllowed(conversation, found) {
		return fmt.Errorf("当前邮箱页面收件人或客户邮箱不匹配，已阻止发送")
	}
	return nil
}

func waitForInboxDetailPage(session *cdp.Client, conversation appcore.Conversation, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		lastErr = validatePage(session, conversation)
		if lastErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(400 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unknown validation failure")
	}
	return fmt.Errorf("Shopify Inbox detail did not match the selected conversation before send: %v", lastErr)
}

func inboxURLMatchesSelectedConversation(session *cdp.Client, conversation appcore.Conversation, pageText string) bool {
	if conversation.Source != "inbox" {
		return false
	}
	sourceID := extractInboxConversationID(conversation.SourceURL)
	if sourceID == "" {
		return false
	}
	value, err := session.Evaluate("location.href")
	if err != nil {
		return false
	}
	currentID := extractInboxConversationID(fmt.Sprint(value))
	if currentID == "" || !strings.EqualFold(currentID, sourceID) {
		return false
	}
	return len([]rune(strings.TrimSpace(pageText))) >= 40
}

func emailAddressMismatchAllowed(conversation appcore.Conversation, foundSignals int) bool {
	return isEmailSource(conversation.Source) && conversation.DetailLoaded && foundSignals >= 2
}

func waitForEmailDetailPage(session *cdp.Client, conversation appcore.Conversation, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		lastErr = validateEmailDetailPage(session, conversation)
		if lastErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(400 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unknown validation failure")
	}
	return fmt.Errorf("邮箱页面未在发送前稳定匹配当前会话：%v", lastErr)
}

func validateEmailDetailPage(session *cdp.Client, conversation appcore.Conversation) error {
	value, err := session.Evaluate(fmt.Sprintf(`(() => {
  const target = %s;
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const matchText = (value) => normalize(value)
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const provider = normalize(target.source).toLowerCase();
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  function detailPaneText() {
    const leftGuard = provider === "gmail" ? 240 : Math.max(360, Math.floor(window.innerWidth * 0.28));
    const selectors = provider === "gmail"
      ? ".adn,.gs,.ii,.a3s,[role='main'],main,article,section,div"
      : "[role='main'],main,[role='document'],article,section,div";
    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .map((node) => ({node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "")}))
      .filter((item) => item.rect.left >= leftGuard && item.rect.width >= 320 && item.rect.height >= 48 && item.text.length >= 8)
      .filter((item) => item.text.length <= 12000)
      .map((item) => {
        let score = Math.min(item.rect.width * item.rect.height, 900000);
        if (item.text.length > 80) score += 80000;
        if (/reply|send|\u56de\u590d|\u53d1\u9001/i.test(item.text)) score -= 25000;
        return {...item, score};
      })
      .sort((a, b) => b.score - a.score);
    const chunks = [];
    for (const item of candidates.slice(0, 8)) {
      if (!chunks.some((text) => text.includes(item.text) || item.text.includes(text))) {
        chunks.push(item.text);
      }
    }
    return normalize(chunks.join("\n"));
  }
  function outlookSourceMatches() {
    if (provider !== "outlook" || !target.sourceUrl) return true;
    try {
      const targetId = decodeURIComponent(new URL(target.sourceUrl, location.href).pathname).match(/\/id\/([^/?#]+)/i)?.[1] || "";
      const currentId = decodeURIComponent(location.pathname).match(/\/id\/([^/?#]+)/i)?.[1] || "";
      return !targetId || !currentId || targetId === currentId;
    } catch (_) {
      return true;
    }
  }
  if (!outlookSourceMatches()) {
    return {ok:false, reason:"current Outlook email URL does not match the selected message; blocked before send"};
  }
  const text = matchText(detailPaneText());
  const required = [target.preview, target.topic]
    .map((value) => matchText(value))
    .filter((value) => value.length >= 6);
  const identity = [target.customerEmail, target.customerName, target.customerFullName]
    .map((value) => matchText(value))
    .filter((value) => value.length >= 4);
  const requiredHits = required.reduce((total, part) => total + (text.includes(part) ? 1 : 0), 0);
  const identityHits = identity.reduce((total, part) => total + (text.includes(part) ? 1 : 0), 0);
  let ok = false;
  if (required.length >= 2) ok = requiredHits >= 2;
  else if (required.length === 1) ok = requiredHits === 1 && identityHits >= 1;
  else ok = identityHits >= 2;
  const email = matchText(target.customerEmail);
  if (ok && email && !text.includes(email) && identityHits === 0 && requiredHits < 2) {
    return {ok:false, requiredHits, requiredTotal:required.length, identityHits, detailLength:text.length, reason:"current email detail does not show the target customer email; blocked before send"};
  }
  if (!ok) {
    return {ok:false, requiredHits, requiredTotal:required.length, identityHits, detailLength:text.length, reason:"current email detail does not match the selected customer/message; blocked before send"};
  }
  return {ok:true, requiredHits, requiredTotal:required.length, identityHits, detailLength:text.length};
})()`, conversationSendJSON(conversation)))
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "current email detail did not pass send validation"))
	}
	return nil
}

func prepareEmailPageForSend(session *cdp.Client, conversation appcore.Conversation) error {
	value, err := session.Evaluate(fmt.Sprintf(`(async () => {
  const target = %s;
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const matchText = (value) => normalize(value)
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const provider = normalize(target.source).toLowerCase();
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const rowLike = (node) => {
    const rect = node.getBoundingClientRect();
    const role = String(node.getAttribute("role") || "").toLowerCase();
    const semantic = role.includes("row") || role.includes("listitem") || role.includes("option") || node.tagName === "TR" || node.closest("[role='listbox'],[role='grid'],table");
    if (!semantic) return false;
    if (provider === "gmail") {
      return node.tagName === "TR" && rect.left >= 180 && rect.width >= 520 && rect.height >= 28 && rect.height <= 64;
    }
    if (provider === "outlook") {
      return rect.left >= 180 && rect.left < Math.min(window.innerWidth * 0.45, 650) && rect.width >= 240 && rect.width <= 520 && rect.height >= 48 && rect.height <= 130;
    }
    return rect.width >= 240 && rect.height >= 28 && rect.height <= 180;
  };
  const parts = [target.customerEmail, target.customerName, target.customerFullName, target.topic, target.preview]
    .map((value) => matchText(value))
    .filter((value) => value.length >= 4);
  const required = [target.preview, target.topic]
    .map((value) => matchText(value))
    .filter((value) => value.length >= 6);

  async function ensureOutlookUnreadView() {
    if (!/outlook\.(live|office)\.com\/mail/i.test(location.href)) return false;
    const labelOf = (node) => normalize([node.innerText || "", node.textContent || "", node.getAttribute("aria-label") || "", node.getAttribute("title") || ""].join(" "));
    const unreadRe = /Unread|\u672a\u8bfb|\u672a\u8b80|\u672a\u95b1\u8b80/i;
    const filterRe = /Filter|\u7b5b\u9009|\u7b5b\u9009\u5668|\u7be9\u9078|\u7be9\u9078\u5668|All|\u5168\u90e8|Unread|\u672a\u8bfb|\u672a\u8b80|\u672a\u95b1\u8b80/i;
    const badRe = /\u9009\u62e9|Select|\u8df3\u8f6c|Go to|\u6392\u5e8f|\u5df2\u6392\u5e8f|Sort|\u6536\u85cf|Favorite|\u6807\u8bb0|Flag/i;
    const controls = Array.from(document.querySelectorAll("button,[role='button']"))
      .filter(visible)
      .map((node) => ({node, text: labelOf(node), rect: node.getBoundingClientRect()}))
      .filter((item) => item.rect.width <= 180 && item.rect.height <= 60 && item.rect.left > 180 && item.rect.top >= 100 && item.rect.top < 260)
      .filter((item) => filterRe.test(item.text) && !badRe.test(item.text))
      .sort((a, b) => (unreadRe.test(a.text) ? 0 : 1) - (unreadRe.test(b.text) ? 0 : 1) || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const control = controls[0];
    if (!control) return false;
    if (unreadRe.test(control.text)) return true;
    control.node.click();
    await sleep(450);
    const options = Array.from(document.querySelectorAll("[role='menuitemradio']"))
      .filter(visible)
      .map((node) => ({node, text: labelOf(node), rect: node.getBoundingClientRect()}))
      .filter((item) => item.rect.left >= control.rect.left - 40 && item.rect.left <= control.rect.left + 360 && item.rect.top >= control.rect.bottom - 10 && item.rect.top <= control.rect.bottom + 280)
      .filter((item) => unreadRe.test(item.text));
    if (!options[0]) return false;
    options[0].node.click();
    await sleep(900);
    return true;
  }

  function findListScroller() {
    const candidates = Array.from(document.querySelectorAll("main,section,div,[role='main'],[role='grid'],[role='listbox']"))
      .filter(visible)
      .map((node) => ({node, rect: node.getBoundingClientRect()}))
      .filter((item) => item.node.scrollHeight > item.node.clientHeight + 80 && item.rect.width > 260 && item.rect.height > 180)
      .map((item) => {
        const rowCount = item.node.querySelectorAll("[role='row'],[role='option'],[role='listitem'],tr").length;
        let score = rowCount * 10 + Math.min(item.rect.height, 900);
        if (item.rect.left > window.innerWidth * 0.65) score -= 300;
        if (item.rect.left < 220) score -= 200;
        return {...item, score};
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.node || document.scrollingElement || document.documentElement;
  }

  function findMatchingRow() {
    const rows = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
      .filter(visible)
      .filter(rowLike)
      .map((node) => ({node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "")}))
      .filter((item) => item.text.length >= 8 && item.text.length <= 2200)
      .map((item) => {
        const lower = matchText(item.text);
        const score = parts.reduce((total, part) => total + (lower.includes(part) ? 1 : 0), 0);
        const requiredMatch = required.length === 0 || required.some((part) => lower.includes(part));
        return {...item, score, requiredMatch};
      })
      .filter((item) => item.requiredMatch && item.score >= Math.min(2, Math.max(parts.length, 1)))
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);
    return rows[0] || null;
  }

  function detailPaneText() {
    const leftGuard = provider === "gmail" ? 240 : Math.max(360, Math.floor(window.innerWidth * 0.28));
    const selectors = provider === "gmail"
      ? ".adn,.gs,.ii,.a3s,[role='main'],main,article,section,div"
      : "[role='main'],main,[role='document'],article,section,div";
    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .map((node) => ({node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "")}))
      .filter((item) => item.rect.left >= leftGuard && item.rect.width >= 320 && item.rect.height >= 48 && item.text.length >= 8)
      .filter((item) => item.text.length <= 12000)
      .map((item) => {
        let score = Math.min(item.rect.width * item.rect.height, 900000);
        if (item.text.length > 80) score += 80000;
        if (/reply|send|\u56de\u590d|\u53d1\u9001/i.test(item.text)) score -= 25000;
        return {...item, score};
      })
      .sort((a, b) => b.score - a.score);
    const chunks = [];
    for (const item of candidates.slice(0, 8)) {
      if (!chunks.some((text) => text.includes(item.text) || item.text.includes(text))) {
        chunks.push(item.text);
      }
    }
    return normalize(chunks.join("\n"));
  }

  function currentDetailMatches() {
    const text = matchText(detailPaneText());
    if (!text) return false;
    const score = parts.reduce((total, part) => total + (text.includes(part) ? 1 : 0), 0);
    const requiredHits = required.reduce((total, part) => total + (text.includes(part) ? 1 : 0), 0);
    if (required.length >= 2) return requiredHits >= 2;
    if (required.length === 1) return requiredHits === 1 && score >= 2;
    return score >= 2;
  }

  if (currentDetailMatches()) {
    return {ok:true, clicked:false, detailLoaded:true, currentDetail:true};
  }

  const scroller = findListScroller();
  if (scroller) scroller.scrollTop = 0;
  await sleep(250);
  let lastTop = -1;
  for (let pass = 0; pass < 90; pass += 1) {
    const row = findMatchingRow();
    if (row) {
      row.node.scrollIntoView({block:"center", inline:"nearest"});
      row.node.click();
      return {ok:true, clicked:true, score:row.score, pass};
    }
    if (!scroller) break;
    const before = scroller.scrollTop;
    const step = Math.max(280, Math.floor(scroller.clientHeight * 0.82));
    scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
    await sleep(220);
    if (Math.abs(scroller.scrollTop - before) < 8 || scroller.scrollTop === lastTop) break;
    lastTop = scroller.scrollTop;
  }
  return {ok:false, reason:"email row was not found before send; blocked to avoid replying to the wrong message"};
})()`, conversationSendJSON(conversation)))
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "email page was not prepared for send"))
	}
	time.Sleep(900 * time.Millisecond)
	return nil
}

func prepareEmailPageForSendLegacy(session *cdp.Client, conversation appcore.Conversation) error {
	value, err := session.Evaluate(fmt.Sprintf(`(() => {
  const target = %s;
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const provider = normalize(target.source).toLowerCase();
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const rowLike = (node) => {
    const rect = node.getBoundingClientRect();
    const role = String(node.getAttribute("role") || "").toLowerCase();
    const semantic = role.includes("row") || role.includes("listitem") || role.includes("option") || node.tagName === "TR" || node.closest("[role='listbox'],[role='grid'],table");
    if (!semantic) return false;
    if (provider === "gmail") {
      return node.tagName === "TR" && rect.left >= 180 && rect.width >= 520 && rect.height >= 28 && rect.height <= 64;
    }
    if (provider === "outlook") {
      return rect.left >= 180 && rect.left < Math.min(window.innerWidth * 0.45, 650) && rect.width >= 240 && rect.width <= 520 && rect.height >= 48 && rect.height <= 130;
    }
    return rect.width >= 240 && rect.height >= 28 && rect.height <= 180;
  };
  const parts = [target.customerEmail, target.customerName, target.customerFullName, target.topic, target.preview]
    .map((value) => normalize(value).toLowerCase())
    .filter((value) => value.length >= 4);
  const required = [target.preview, target.topic]
    .map((value) => normalize(value).toLowerCase())
    .filter((value) => value.length >= 6);
  const rows = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
    .filter(visible)
    .filter(rowLike)
    .map((node) => ({node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "")}))
    .filter((item) => item.text.length >= 8 && item.text.length <= 2200)
    .map((item) => {
      const lower = item.text.toLowerCase();
      const score = parts.reduce((total, part) => total + (lower.includes(part) ? 1 : 0), 0);
      const requiredMatch = required.length === 0 || required.some((part) => lower.includes(part));
      return {...item, score, requiredMatch};
    })
    .filter((item) => item.requiredMatch && item.score >= Math.min(2, Math.max(parts.length, 1)))
    .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);
  const row = rows[0];
  if (row) {
    row.node.scrollIntoView({block:"center", inline:"nearest"});
    row.node.click();
    return {ok:true, clicked:true, score:row.score};
  }
  if (target.detailLoaded) return {ok:true, clicked:false, detailLoaded:true};
  return {ok:false, reason:"未能在邮箱列表中定位到这封邮件，已阻止发送，避免回复到错误邮件"};
})()`, conversationSendJSON(conversation)))
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "legacy email page was not prepared for send"))
	}
	time.Sleep(900 * time.Millisecond)
	return nil
}

func fillAndSendInbox(session *cdp.Client, replyText string) error {
	infoValue, err := session.Evaluate(`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 40 && rect.height > 18 && style.display !== "none" && style.visibility !== "hidden";
  };
  const labelOf = (node) => [
    node.innerText || "",
    node.textContent || "",
    node.getAttribute("aria-label") || "",
    node.getAttribute("title") || "",
    node.getAttribute("placeholder") || "",
    node.getAttribute("data-testid") || "",
    node.className || ""
  ].join(" ");
  const editorText = (node) => String(node.value || node.innerText || node.textContent || "").trim();
  const editorUsable = (node) => {
    const rect = node.getBoundingClientRect();
    const label = labelOf(node);
    if (/search|filter|settings|\u641c\u7d22|\u7b5b\u9009|\u8bbe\u7f6e/i.test(label)) return false;
    if (rect.left < Math.max(300, Math.min(window.innerWidth * 0.22, 520))) return false;
    if (rect.top < Math.max(260, window.innerHeight * 0.35)) return false;
    return rect.width >= 260 && rect.height >= 36;
  };
  const findEditor = () => Array.from(document.querySelectorAll("textarea,[contenteditable='true'],[role='textbox']"))
    .filter(visible)
    .filter(editorUsable)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const label = labelOf(node);
      let score = rect.top + rect.height;
      if (/\u64b0\u5199\u7535\u5b50\u90ae\u4ef6|write.*email|reply|message|\u56de\u590d|\u6d88\u606f/i.test(label)) score += 5000;
      if (editorText(node)) score += 1000;
      return {node, score};
    })
    .sort((a, b) => b.score - a.score)[0] || null;
  let picked = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    picked = findEditor();
    if (picked) break;
    await sleep(350);
  }
  if (!picked) return {ok:false, reason:"Shopify Inbox reply editor was not found"};
  const editor = picked.node;
  document.querySelectorAll("[data-ai-inbox-send-editor='1']").forEach((node) => node.removeAttribute("data-ai-inbox-send-editor"));
  editor.setAttribute("data-ai-inbox-send-editor", "1");
  editor.scrollIntoView({block:"center", inline:"nearest"});
  editor.focus();
  if (editor.isContentEditable) {
    if (typeof editor.replaceChildren === "function") editor.replaceChildren();
    else editor.textContent = "";
  } else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
    if (setter) setter.call(editor, "");
    else editor.value = "";
  }
  editor.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"deleteContentBackward", data:null}));
  return {ok:true};
})()`)
	if err != nil {
		return err
	}
	info := asMap(infoValue)
	if info["ok"] != true {
		return errors.New(validationReason(info, "Shopify Inbox reply editor was not found"))
	}
	if err := session.InsertText(replyText); err != nil {
		return err
	}
	okValue, _ := session.Evaluate(`(() => {
  const editor = document.querySelector("[data-ai-inbox-send-editor='1']");
  const value = editor ? (editor.value || editor.innerText || editor.textContent || "") : "";
  return value.trim().length > 0;
})()`)
	if okValue != true {
		return fmt.Errorf("Shopify Inbox reply text was not written")
	}
	buttonValue, _ := session.Evaluate(`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  };
  const disabled = (node) => node.disabled || node.getAttribute("aria-disabled") === "true" || node.closest("[disabled],[aria-disabled='true']");
  const labelOf = (node) => (node.innerText || "") + " " + (node.textContent || "") + " " + (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "");
  const editor = document.querySelector("[data-ai-inbox-send-editor='1']");
  const editorRect = editor?.getBoundingClientRect?.() || null;
  const sendRe = /send\s*email|send|\u53d1\u9001\u7535\u5b50\u90ae\u4ef6|\u53d1\u9001|\u5bc4\u51fa/i;
  const badRe = /settings|shortcut|emoji|image|discount|tag|\u8bbe\u7f6e|\u8868\u60c5|\u56fe\u7247|\u6298\u6263|\u6807\u7b7e/i;
  const nearEditor = (item) => {
    if (!editorRect) return true;
    const centerY = item.rect.top + item.rect.height / 2;
    const centerX = item.rect.left + item.rect.width / 2;
    return centerY >= editorRect.top - 40 && centerY <= editorRect.bottom + 90
      && centerX >= editorRect.left - 80 && centerX <= editorRect.right + 120;
  };
  const findButton = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter(visible)
    .map((node) => ({node, label: labelOf(node), rect: node.getBoundingClientRect(), disabled: disabled(node)}))
    .filter((item) => sendRe.test(item.label) && !badRe.test(item.label))
    .filter((item) => item.rect.width <= 240 && item.rect.height <= 90)
    .filter(nearEditor)
    .sort((a, b) => {
      const aEnabled = a.disabled ? 0 : 1;
      const bEnabled = b.disabled ? 0 : 1;
      const aDistance = editorRect ? Math.abs(a.rect.top - editorRect.bottom) + Math.abs(a.rect.right - editorRect.right) : 0;
      const bDistance = editorRect ? Math.abs(b.rect.top - editorRect.bottom) + Math.abs(b.rect.right - editorRect.right) : 0;
      return bEnabled - aEnabled || aDistance - bDistance;
    })[0] || null;
  let button = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    button = findButton();
    if (button && !button.disabled) break;
    await sleep(350);
  }
  if (!button) return {ok:false, reason:"Shopify Inbox send button was not found"};
  if (button.disabled) return {ok:false, reason:"Shopify Inbox send button stayed disabled after reply text was written"};
  button.node.scrollIntoView({block:"center", inline:"nearest"});
  button.node.click();
  return {ok:true, label:button.label};
})()`)
	buttonInfo := asMap(buttonValue)
	if buttonInfo["ok"] != true {
		return errors.New(validationReason(buttonInfo, "Shopify Inbox send button was not found"))
	}
	time.Sleep(1200 * time.Millisecond)
	return nil
}

func verifyInboxReplySent(session *cdp.Client, replyText string) error {
	value, err := session.Evaluate(fmt.Sprintf(`(async () => {
  const expected = %s;
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const textOf = (node) => normalize(node.value || node.innerText || node.textContent || "");
  const editorText = () => Array.from(document.querySelectorAll("[data-ai-inbox-send-editor='1'],textarea,[contenteditable='true'],[role='textbox']"))
    .filter(visible)
    .map(textOf)
    .filter(Boolean)
    .join("\n");
  const pageText = () => normalize(document.body?.innerText || "");
  const disabled = (node) => node.disabled || node.getAttribute("aria-disabled") === "true" || node.closest("[disabled],[aria-disabled='true']");
  const sendButtonDisabled = () => Array.from(document.querySelectorAll("button,[role='button']"))
    .filter(visible)
    .filter((node) => /send\s*email|send|\u53d1\u9001\u7535\u5b50\u90ae\u4ef6|\u53d1\u9001|\u5bc4\u51fa/i.test(textOf(node) + " " + (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "")))
    .some(disabled);
  const hasError = () => /couldn'?t send|failed to send|not sent|\u53d1\u9001\u5931\u8d25|\u65e0\u6cd5\u53d1\u9001|\u672a\u53d1\u9001/i.test(pageText());
  const normalizedExpected = normalize(expected).toLowerCase();
  const prefixLength = Math.min(140, Math.max(40, Math.floor(normalizedExpected.length * 0.35)));
  const prefix = normalizedExpected.slice(0, prefixLength);
  let lastReason = "Shopify Inbox sent reply was not verified";
  for (let i = 0; i < 16; i += 1) {
    const editor = editorText().toLowerCase();
    if (prefix && editor.includes(prefix)) {
      lastReason = "reply text is still in the Shopify Inbox composer; the page did not confirm it was sent";
    } else if (hasError()) {
      lastReason = "Shopify Inbox page shows a send error";
    } else {
      const detail = pageText().toLowerCase();
      if (prefix && detail.includes(prefix)) return {ok:true, mode:"message_visible"};
      if (i >= 3 && editor.trim() === "" && sendButtonDisabled()) return {ok:true, mode:"composer_cleared"};
    }
    await sleep(500);
  }
  return {ok:false, reason:lastReason};
})()`, jsonString(replyText)))
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "Shopify Inbox sent reply was not verified"))
	}
	return nil
}

func fillAndSend(session *cdp.Client, replyText string) error {
	_ = ensureReplyEditorOpen(session)
	infoValue, err := session.Evaluate(`(async () => {
  const provider = /mail\.google\.com/i.test(location.href) ? "gmail" : /outlook\.(live|office)\.com/i.test(location.href) ? "outlook" : /mail-client\.cuiqiu\.com/i.test(location.href) ? "cuiqiu" : /inbox\.shopify\.com/i.test(location.href) ? "inbox" : "";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 40 && rect.height > 16 && style.display !== "none" && style.visibility !== "hidden";
  };
  const labelOf = (node) => ((node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "") + " " + (node.getAttribute("placeholder") || "") + " " + (node.className || "") + " " + (node.innerText || "")).toLowerCase();
  const editorUsable = (node) => {
    const rect = node.getBoundingClientRect();
    const label = labelOf(node);
    if (/search|filter|font|size|\u641c\u7d22|\u7b5b\u9009|\u5b57\u4f53|\u5b57\u53f7/i.test(label)) return false;
    if (provider === "gmail" && rect.left < 250) return false;
    if (provider === "outlook" && rect.left < Math.max(560, Math.min(window.innerWidth * 0.32, 620))) return false;
    if (provider === "inbox" && rect.left < 560) return false;
    return rect.width >= 180 || /body|message|\u90ae\u4ef6\u6b63\u6587|\u6d88\u606f|compose|reply/i.test(label);
  };
  const composerRoot = (editor) => {
    const sendRe = /(^|\s)(send|\u53d1\u9001|\u5bc4\u51fa)(\s|$)/i;
    let best = null;
    for (let node = editor; node && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 48) continue;
      const hasSend = Array.from(node.querySelectorAll("button,[role='button'],span[aria-label],div[aria-label]"))
        .some((button) => sendRe.test(labelOf(button)));
      if (hasSend) best = node;
      if (best && rect.width > Math.min(window.innerWidth * 0.85, 1200)) break;
    }
    return best || editor.closest("form,[role='dialog'],[aria-label]") || editor.parentElement;
  };
  const findEditor = () => Array.from(document.querySelectorAll("textarea,input[type='text'],[contenteditable='true'],[role='textbox']"))
    .filter(visible)
    .filter(editorUsable)
    .sort((a, b) => (b.getBoundingClientRect().top + b.getBoundingClientRect().height) - (a.getBoundingClientRect().top + a.getBoundingClientRect().height))[0] || null;
  let editor = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    editor = findEditor();
    if (editor) break;
    await sleep(400);
  }
  if (!editor) return {ok:false, reason:"未找到回复编辑框"};
  document.querySelectorAll("[data-ai-send-editor='1']").forEach((node) => node.removeAttribute("data-ai-send-editor"));
  document.querySelectorAll("[data-ai-send-root='1']").forEach((node) => node.removeAttribute("data-ai-send-root"));
  editor.setAttribute("data-ai-send-editor", "1");
  const root = composerRoot(editor);
  if (root) root.setAttribute("data-ai-send-root", "1");
  editor.scrollIntoView({block:"center", inline:"nearest"});
  editor.focus();
  if (editor.isContentEditable) {
    if (typeof editor.replaceChildren === "function") editor.replaceChildren();
    else editor.textContent = "";
  } else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
    if (setter) setter.call(editor, "");
    else editor.value = "";
  }
  editor.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"deleteContentBackward", data:null}));
  return {ok:true};
})()`)
	if err != nil {
		return err
	}
	info := asMap(infoValue)
	if info["ok"] != true {
		return errors.New(validationReason(info, "reply editor was not found"))
	}
	if err := session.InsertText(replyText); err != nil {
		return err
	}
	okValue, _ := session.Evaluate(`(() => {
  const editor = document.querySelector("[data-ai-send-editor='1']");
  const value = editor ? (editor.value || editor.innerText || editor.textContent || "") : "";
  return value.trim().length > 0;
})()`)
	if okValue != true {
		return fmt.Errorf("回复写入失败，未点击发送")
	}
	buttonValue, _ := session.Evaluate(`(async () => {
  const provider = /mail\.google\.com/i.test(location.href) ? "gmail" : /outlook\.(live|office)\.com/i.test(location.href) ? "outlook" : /mail-client\.cuiqiu\.com/i.test(location.href) ? "cuiqiu" : /inbox\.shopify\.com/i.test(location.href) ? "inbox" : "";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  };
  const disabled = (node) => node.disabled || node.getAttribute("aria-disabled") === "true" || node.closest("[disabled],[aria-disabled='true']");
  const labelOf = (node) => (node.innerText || "") + " " + (node.textContent || "") + " " + (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "");
  const root = document.querySelector("[data-ai-send-root='1']") || document;
  const editor = document.querySelector("[data-ai-send-editor='1']");
  const editorRect = editor?.getBoundingClientRect?.() || null;
  const sendRe = /send|\u53d1\u9001|\u5bc4\u51fa/i;
  const sendOptionsRe = /more\s+send|send\s+options|\u66f4\u591a\u53d1\u9001|\u53d1\u9001\u9009\u9879|\u66f4\u591a\u5bc4\u51fa|\u5bc4\u51fa\u9009\u9879/i;
  const nearEditor = (item) => {
    if (!editorRect) return true;
    const centerY = item.rect.top + item.rect.height / 2;
    const centerX = item.rect.left + item.rect.width / 2;
    if (provider === "inbox") {
      return centerY >= editorRect.top - 80 && centerY <= editorRect.bottom + 90
        && centerX >= editorRect.left - 120 && centerX <= editorRect.right + 140;
    }
    return centerY >= editorRect.top - 160 && centerY <= editorRect.bottom + 160;
  };
  const collect = (scope, requireNear) => Array.from(scope.querySelectorAll("button,[role='button'],span[aria-label],div[aria-label]"))
    .filter(visible)
    .filter((node) => !disabled(node))
    .map((node) => ({node, label: labelOf(node), rect: node.getBoundingClientRect(), tag: String(node.tagName || "").toLowerCase(), role: String(node.getAttribute("role") || "").toLowerCase()}))
    .filter((item) => sendRe.test(item.label))
    .filter((item) => !sendOptionsRe.test(item.label))
    .filter((item) => item.rect.width <= 220 && item.rect.height <= 80)
    .filter((item) => !requireNear || nearEditor(item));
  const findButton = () => [
      ...collect(root, false),
      ...collect(document, true)
    ].filter((item, index, all) => all.findIndex((other) => other.node === item.node) === index)
      .sort((a, b) => {
        const aNear = nearEditor(a) ? 1 : 0;
        const bNear = nearEditor(b) ? 1 : 0;
        const aButton = a.tag === "button" || a.role === "button" ? 1 : 0;
        const bButton = b.tag === "button" || b.role === "button" ? 1 : 0;
        const aDistance = editorRect ? Math.abs(a.rect.top - editorRect.bottom) : 0;
        const bDistance = editorRect ? Math.abs(b.rect.top - editorRect.bottom) : 0;
        return bNear - aNear || bButton - aButton || aDistance - bDistance || a.rect.left - b.rect.left;
      })[0] || null;
  let button = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    button = findButton();
    if (button) break;
    await sleep(400);
  }
  if (!button) return {ok:false, reason:"未找到可用发送按钮"};
  button.node.scrollIntoView({block:"center", inline:"nearest"});
  button.node.click();
  return {ok:true, label:button.label};
})()`)
	buttonInfo := asMap(buttonValue)
	if buttonInfo["ok"] != true {
		return errors.New(validationReason(buttonInfo, "send button was not found"))
	}
	time.Sleep(1200 * time.Millisecond)
	return nil
}

func verifyEmailReplySent(session *cdp.Client, replyText string) error {
	value, err := session.Evaluate(fmt.Sprintf(`(async () => {
  const expected = %s;
  const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  function detailPaneText() {
    const leftGuard = Math.max(360, Math.floor(window.innerWidth * 0.28));
    const selectors = ".adn,.gs,.ii,.a3s,[role='main'],main,[role='document'],article,section,div";
    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .map((node) => ({node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "")}))
      .filter((item) => item.rect.left >= leftGuard && item.rect.width >= 320 && item.rect.height >= 48 && item.text.length >= 8)
      .filter((item) => item.text.length <= 14000)
      .map((item) => {
        let score = Math.min(item.rect.width * item.rect.height, 900000);
        if (item.text.length > 80) score += 80000;
        return {...item, score};
      })
      .sort((a, b) => b.score - a.score);
    const chunks = [];
    for (const item of candidates.slice(0, 8)) {
      if (!chunks.some((text) => text.includes(item.text) || item.text.includes(text))) {
        chunks.push(item.text);
      }
    }
    return normalize(chunks.join("\n"));
  }
  function editorText() {
    return Array.from(document.querySelectorAll("textarea,input[type='text'],[contenteditable='true'],[role='textbox']"))
      .filter(visible)
      .map((node) => normalize(node.value || node.innerText || node.textContent || ""))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  const normalizedExpected = normalize(expected).toLowerCase();
  const prefixLength = Math.min(140, Math.max(50, Math.floor(normalizedExpected.length * 0.35)));
  const prefix = normalizedExpected.slice(0, prefixLength);
  let lastReason = "sent reply was not found in the current email thread";
  for (let i = 0; i < 12; i += 1) {
    const editor = editorText().toLowerCase();
    if (prefix && editor.includes(prefix)) {
      lastReason = "reply text is still in the composer; the email page did not confirm it was sent";
    } else {
      const detail = detailPaneText().toLowerCase();
      if (prefix && detail.includes(prefix)) {
        return {ok:true, detailLength:detail.length};
      }
    }
    await sleep(500);
  }
  return {ok:false, reason:lastReason};
})()`, jsonString(replyText)))
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "sent reply was not verified"))
	}
	return nil
}

func isSoftEmailSendVerificationFailure(reason string) bool {
	reason = strings.ToLower(strings.TrimSpace(reason))
	if reason == "" {
		return false
	}
	if strings.Contains(reason, "still in the composer") || strings.Contains(reason, "did not confirm it was sent") {
		return false
	}
	return strings.Contains(reason, "sent reply was not found in the current email thread")
}

func fillAndSendLegacy(session *cdp.Client, replyText string) error {
	_ = ensureReplyEditorOpen(session)
	infoValue, err := session.Evaluate(`(() => {
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 40 && rect.height > 16 && style.display !== "none" && style.visibility !== "hidden";
  };
  const labelOf = (node) => ((node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "") + " " + (node.getAttribute("placeholder") || "") + " " + (node.className || "")).toLowerCase();
  const editors = Array.from(document.querySelectorAll("textarea,input[type='text'],[contenteditable='true'],[role='textbox']"))
    .filter(visible)
    .filter((node) => !/search|filter|搜索|筛选/.test(labelOf(node)))
    .sort((a, b) => (b.getBoundingClientRect().top + b.getBoundingClientRect().height) - (a.getBoundingClientRect().top + a.getBoundingClientRect().height));
  const editor = editors[0];
  if (!editor) return {ok:false, reason:"未找到回复编辑框"};
  document.querySelectorAll("[data-ai-send-editor='1']").forEach((node) => node.removeAttribute("data-ai-send-editor"));
  editor.setAttribute("data-ai-send-editor", "1");
  editor.scrollIntoView({block:"center", inline:"nearest"});
  editor.focus();
  if (editor.isContentEditable) {
    if (typeof editor.replaceChildren === "function") editor.replaceChildren();
    else editor.textContent = "";
  } else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
    if (setter) setter.call(editor, "");
    else editor.value = "";
  }
  editor.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"deleteContentBackward", data:null}));
  return {ok:true};
})()`)
	if err != nil {
		return err
	}
	info := asMap(infoValue)
	if info["ok"] != true {
		return errors.New(validationReason(info, "legacy reply editor was not found"))
	}
	if err := session.InsertText(replyText); err != nil {
		return err
	}
	okValue, _ := session.Evaluate(`(() => {
  const editor = document.querySelector("[data-ai-send-editor='1']");
  const value = editor ? (editor.value || editor.innerText || editor.textContent || "") : "";
  return value.trim().length > 0;
})()`)
	if okValue != true {
		return fmt.Errorf("回复写入失败，未点击发送")
	}
	buttonValue, _ := session.Evaluate(`(() => {
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  };
  const disabled = (node) => node.disabled || node.getAttribute("aria-disabled") === "true" || node.closest("[disabled],[aria-disabled='true']");
  const labelOf = (node) => (node.innerText || "") + " " + (node.textContent || "") + " " + (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "");
  const buttons = Array.from(document.querySelectorAll("button,[role='button'],span[aria-label],div[aria-label]"))
    .filter(visible)
    .filter((node) => !disabled(node))
    .map((node) => ({node, label: labelOf(node), rect: node.getBoundingClientRect()}))
    .filter((item) => /send|发送|寄出/i.test(item.label))
    .sort((a, b) => b.rect.top - a.rect.top);
  const button = buttons[0];
  if (!button) return {ok:false, reason:"未找到可用发送按钮"};
  button.node.scrollIntoView({block:"center", inline:"nearest"});
  button.node.click();
  return {ok:true, label:button.label};
})()`)
	buttonInfo := asMap(buttonValue)
	if buttonInfo["ok"] != true {
		return errors.New(validationReason(buttonInfo, "legacy send button was not found"))
	}
	time.Sleep(1200 * time.Millisecond)
	return nil
}

func ensureReplyEditorOpen(session *cdp.Client) error {
	value, err := session.Evaluate(`(() => {
  const provider = /mail\.google\.com/i.test(location.href) ? "gmail" : /outlook\.(live|office)\.com/i.test(location.href) ? "outlook" : /mail-client\.cuiqiu\.com/i.test(location.href) ? "cuiqiu" : /inbox\.shopify\.com/i.test(location.href) ? "inbox" : "";
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  };
  const labelOf = (node) => [
    node.innerText || "",
    node.textContent || "",
    node.getAttribute("aria-label") || "",
    node.getAttribute("title") || "",
    node.getAttribute("data-tooltip") || ""
  ].join(" ");
  const editorUsable = (node) => {
    const rect = node.getBoundingClientRect();
    const label = labelOf(node);
    if (/search|filter|font|size|\u641c\u7d22|\u7b5b\u9009|\u5b57\u4f53|\u5b57\u53f7/i.test(label)) return false;
    if (rect.width < 120 && !/body|message|\u90ae\u4ef6\u6b63\u6587|\u6d88\u606f/i.test(label)) return false;
    if (provider === "gmail" && rect.left < 250) return false;
    if (provider === "outlook" && rect.left < Math.max(560, Math.min(window.innerWidth * 0.32, 620))) return false;
    if (provider === "inbox" && rect.left < 560) return false;
    return true;
  };
  const hasEditor = Array.from(document.querySelectorAll("textarea,input[type='text'],[contenteditable='true'],[role='textbox']"))
    .filter(visible)
    .some(editorUsable);
  if (hasEditor) return {ok:true, alreadyOpen:true};
  const replyPattern = /reply|reply all|respond|\u56de\u590d|\u5168\u90e8\u7b54\u590d|\u7b54\u590d|\u7b54\u590d/i;
  const badPattern = /forward|delete|archive|report|mark|flag|unsubscribe|\u8f6c\u53d1|\u5220\u9664|\u5b58\u6863|\u62a5\u544a|\u6807\u8bb0|\u53d6\u6d88\u8ba2\u9605/i;
  const buttons = Array.from(document.querySelectorAll("button,[role='button'],span[aria-label],div[aria-label]"))
    .filter(visible)
    .map((node) => ({node, label: labelOf(node), rect: node.getBoundingClientRect()}))
    .filter((item) => replyPattern.test(item.label) && !badPattern.test(item.label))
    .filter((item) => item.rect.width <= 180 && item.rect.height <= 70)
    .filter((item) => provider !== "gmail" || item.rect.left >= 250)
    .filter((item) => provider !== "outlook" || item.rect.left >= Math.max(560, Math.min(window.innerWidth * 0.32, 620)))
    .sort((a, b) => b.rect.top - a.rect.top || a.rect.left - b.rect.left);
  const button = buttons[0];
  if (!button) return {ok:false, reason:"reply button not found"};
  button.node.scrollIntoView({block:"center", inline:"nearest"});
  button.node.click();
  return {ok:true, clicked:true, label:button.label};
})()`)
	if err != nil {
		return err
	}
	info := asMap(value)
	if info["ok"] != true {
		return errors.New(validationReason(info, "reply editor was not opened"))
	}
	time.Sleep(700 * time.Millisecond)
	return nil
}

func asMap(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func validationReason(info map[string]any, fallback string) string {
	if reason := strings.TrimSpace(fmt.Sprint(info["reason"])); reason != "" && reason != "<nil>" {
		return reason
	}
	if len(info) > 0 {
		if data, err := json.Marshal(info); err == nil && len(data) > 0 {
			return fallback + ": " + string(data)
		}
	}
	return fallback
}

func preview(text string) string {
	return regexp.MustCompile(`\s+`).ReplaceAllString(truncate(text, 160), " ")
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func conversationSendJSON(conversation appcore.Conversation) string {
	payload := map[string]any{
		"customerEmail":    conversation.CustomerEmail,
		"customerName":     conversation.CustomerName,
		"customerFullName": conversation.CustomerFullName,
		"topic":            conversation.Topic,
		"preview":          conversation.Preview,
		"detailLoaded":     conversation.DetailLoaded,
		"source":           conversation.Source,
		"sourceUrl":        conversation.SourceURL,
		"conversationId":   conversation.ConversationID,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func jsonString(value string) string {
	data, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(data)
}
