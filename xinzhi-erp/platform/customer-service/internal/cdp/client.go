package cdp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	neturl "net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Target struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	URL          string `json:"url"`
	Type         string `json:"type"`
	WebSocketURL string `json:"webSocketDebuggerUrl"`
}

type Client struct {
	conn      *websocket.Conn
	timeout   time.Duration
	mu        sync.Mutex
	nextID    int
	eventSink []map[string]any
}

func ListTargets(baseURL string, timeout time.Duration) ([]Target, error) {
	if err := ensureLoopbackEndpoint(baseURL); err != nil {
		return nil, err
	}
	resp, err := httpClient(timeout).Get(strings.TrimRight(baseURL, "/") + "/json/list")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var raw []Target
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	var targets []Target
	for _, target := range raw {
		if target.Type == "page" && target.WebSocketURL != "" {
			targets = append(targets, target)
		}
	}
	return targets, nil
}

func WaitForShopifyTarget(baseURL string, expectedShop string, timeout time.Duration) (Target, error) {
	deadline := time.Now().Add(timeout)
	var last []Target
	for time.Now().Before(deadline) {
		targets, err := ListTargets(baseURL, 5*time.Second)
		if err == nil {
			last = targets
			var candidates []Target
			for _, target := range targets {
				lower := strings.ToLower(target.URL + " " + target.Title)
				if strings.Contains(lower, "admin.shopify.com/store/") || strings.Contains(lower, "inbox.shopify.com/store/") {
					candidates = append(candidates, target)
				}
			}
			sort.Slice(candidates, func(i, j int) bool { return targetPriority(candidates[i]) < targetPriority(candidates[j]) })
			for _, target := range candidates {
				if expectedShop == "" || TargetMatchesShop(target, expectedShop) {
					return target, nil
				}
			}
			if len(candidates) > 0 {
				return candidates[0], nil
			}
		}
		time.Sleep(time.Second)
	}
	return Target{}, fmt.Errorf("未找到匹配的 Shopify 页面，最后目标数量：%d", len(last))
}

func CreateTarget(baseURL string, url string, timeout time.Duration) (Target, error) {
	if err := ensureLoopbackEndpoint(baseURL); err != nil {
		return Target{}, err
	}
	req, err := http.NewRequest(http.MethodPut, createTargetURL(baseURL, url), nil)
	if err != nil {
		return Target{}, err
	}
	resp, err := httpClient(timeout).Do(req)
	if err != nil {
		return Target{}, err
	}
	defer resp.Body.Close()
	var target Target
	if err := json.NewDecoder(resp.Body).Decode(&target); err != nil {
		return Target{}, err
	}
	if target.WebSocketURL != "" {
		return target, nil
	}
	targets, _ := ListTargets(baseURL, timeout)
	for _, item := range targets {
		if item.ID == target.ID || item.URL == url {
			return item, nil
		}
	}
	return Target{}, ErrNoTarget
}

func createTargetURL(baseURL string, targetURL string) string {
	return strings.TrimRight(baseURL, "/") + "/json/new?" + neturl.QueryEscape(targetURL)
}

func ActivateTarget(baseURL string, targetID string, timeout time.Duration) error {
	if targetID == "" {
		return ErrNoTarget
	}
	if err := ensureLoopbackEndpoint(baseURL); err != nil {
		return err
	}
	resp, err := httpClient(timeout).Get(strings.TrimRight(baseURL, "/") + "/json/activate/" + targetID)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("activate target HTTP %d", resp.StatusCode)
	}
	return nil
}

func NewClient(websocketURL string, timeout time.Duration) (*Client, error) {
	if err := ensureLoopbackEndpoint(websocketURL); err != nil {
		return nil, err
	}
	conn, _, err := websocket.DefaultDialer.Dial(websocketURL, nil)
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn, timeout: timeout}, nil
}

func EnsureLoopbackEndpoint(raw string) error {
	return ensureLoopbackEndpoint(raw)
}

func (c *Client) Close() {
	if c != nil && c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *Client) Command(method string, params map[string]any) (map[string]any, error) {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	payload := map[string]any{"id": id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	err := c.conn.WriteJSON(payload)
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(c.timeout)
	_ = c.conn.SetReadDeadline(deadline)
	for time.Now().Before(deadline) {
		var msg map[string]any
		if err := c.conn.ReadJSON(&msg); err != nil {
			return nil, err
		}
		if methodName, ok := msg["method"].(string); ok && methodName != "" {
			c.eventSink = append(c.eventSink, msg)
			continue
		}
		if intFromAny(msg["id"]) != id {
			continue
		}
		if errObj, ok := msg["error"]; ok {
			return nil, fmt.Errorf("%v", errObj)
		}
		return asMap(msg["result"]), nil
	}
	return nil, fmt.Errorf("CDP command timeout: %s", method)
}

func (c *Client) Evaluate(expression string) (any, error) {
	result, err := c.Command("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  true,
	})
	if err != nil {
		return nil, err
	}
	if details, ok := result["exceptionDetails"]; ok {
		return nil, fmt.Errorf("Runtime.evaluate exception: %s", summarizeRuntimeException(details))
	}
	remote := asMap(result["result"])
	if value, ok := remote["value"]; ok {
		return value, nil
	}
	return nil, nil
}

func summarizeRuntimeException(value any) string {
	details := asMap(value)
	exception := asMap(details["exception"])
	if description, ok := exception["description"].(string); ok && strings.TrimSpace(description) != "" {
		return strings.TrimSpace(description)
	}
	if value, ok := exception["value"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	if text, ok := details["text"].(string); ok && strings.TrimSpace(text) != "" {
		return strings.TrimSpace(text)
	}
	if data, err := json.Marshal(details); err == nil && len(data) > 0 {
		return string(data)
	}
	return "unknown JavaScript error"
}

func (c *Client) Navigate(url string, wait time.Duration) error {
	if _, err := c.Command("Page.enable", nil); err != nil {
		return err
	}
	if _, err := c.Command("Page.navigate", map[string]any{"url": url}); err != nil {
		return err
	}
	if wait > 0 {
		time.Sleep(wait)
	}
	return nil
}

func (c *Client) InsertText(text string) error {
	_, err := c.Command("Input.insertText", map[string]any{"text": text})
	return err
}

func (c *Client) MouseClick(x float64, y float64) error {
	params := map[string]any{"x": x, "y": y, "button": "left", "clickCount": 1}
	if _, err := c.Command("Input.dispatchMouseEvent", mergeMaps(map[string]any{"type": "mousePressed"}, params)); err != nil {
		return err
	}
	_, err := c.Command("Input.dispatchMouseEvent", mergeMaps(map[string]any{"type": "mouseReleased"}, params))
	return err
}

func (c *Client) KeyEvent(eventType string, key string, code string, vk int, modifiers int) error {
	_, err := c.Command("Input.dispatchKeyEvent", map[string]any{
		"type": eventType, "key": key, "code": code,
		"windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers,
	})
	return err
}

func (c *Client) ClearFocusedText() {
	_ = c.KeyEvent("keyDown", "Control", "ControlLeft", 17, 2)
	_ = c.KeyEvent("keyDown", "a", "KeyA", 65, 2)
	_ = c.KeyEvent("keyUp", "a", "KeyA", 65, 2)
	_ = c.KeyEvent("keyUp", "Control", "ControlLeft", 17, 0)
	_ = c.KeyEvent("keyDown", "Backspace", "Backspace", 8, 0)
	_ = c.KeyEvent("keyUp", "Backspace", "Backspace", 8, 0)
}

func (c *Client) EnableNetwork() error {
	_, err := c.Command("Network.enable", map[string]any{
		"maxResourceBufferSize": float64(1048576),
		"maxTotalBufferSize":    float64(10485760),
	})
	return err
}

func (c *Client) CollectNetworkBodies(ctx context.Context, duration time.Duration) []NetworkRecord {
	deadline := time.Now().Add(duration)
	meta := map[string]NetworkRecord{}
	var records []NetworkRecord
	_ = c.conn.SetReadDeadline(deadline)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return records
		default:
		}
		var msg map[string]any
		if err := c.conn.ReadJSON(&msg); err != nil {
			return records
		}
		method, _ := msg["method"].(string)
		params := asMap(msg["params"])
		switch method {
		case "Network.responseReceived":
			response := asMap(params["response"])
			requestID := fmt.Sprint(params["requestId"])
			url := fmt.Sprint(response["url"])
			mime := fmt.Sprint(response["mimeType"])
			if requestID != "" && networkRelevant(url, mime) {
				meta[requestID] = NetworkRecord{RequestID: requestID, URL: url, Mime: mime, Status: intFromAny(response["status"])}
			}
		case "Network.loadingFinished":
			requestID := fmt.Sprint(params["requestId"])
			record, ok := meta[requestID]
			if !ok {
				continue
			}
			bodyResult, err := c.Command("Network.getResponseBody", map[string]any{"requestId": requestID})
			if err != nil {
				continue
			}
			body := fmt.Sprint(bodyResult["body"])
			if encoded, _ := bodyResult["base64Encoded"].(bool); encoded {
				decoded, err := base64.StdEncoding.DecodeString(body)
				if err == nil {
					body = string(decoded)
				}
			}
			if strings.TrimSpace(body) == "" {
				continue
			}
			if len(body) > 180000 {
				body = body[:180000]
			}
			record.Body = body
			records = append(records, record)
			if len(records) >= 8 {
				return records
			}
		}
	}
	return records
}

type NetworkRecord struct {
	RequestID string `json:"requestId"`
	URL       string `json:"url"`
	Mime      string `json:"mime"`
	Status    int    `json:"status"`
	Body      string `json:"body"`
}

func targetPriority(target Target) int {
	url := strings.ToLower(target.URL)
	if strings.Contains(url, "inbox.shopify.com/store/") && strings.Contains(url, "/conversations/unread") {
		return 0
	}
	if strings.Contains(url, "admin.shopify.com/store/") && strings.Contains(url, "/apps/shopify-inbox") {
		return 1
	}
	if strings.Contains(url, "inbox.shopify.com/store/") {
		return 2
	}
	if strings.Contains(url, "admin.shopify.com/store/") {
		return 3
	}
	return 4
}

func TargetMatchesShop(target Target, expected string) bool {
	haystack := normalizeShopText(target.Title + " " + target.URL)
	for _, alias := range shopAliases(expected) {
		if alias != "" && strings.Contains(haystack, alias) {
			return true
		}
	}
	return false
}

func shopAliases(name string) []string {
	normalized := normalizeShopText(name)
	parts := []string{name}
	if i := strings.IndexAny(name, ".- "); i > 0 {
		parts = append(parts, name[:i])
	}
	var aliases []string
	for _, part := range parts {
		alias := normalizeShopText(part)
		if len(alias) >= 4 {
			aliases = append(aliases, alias)
		}
	}
	if normalized != "" {
		aliases = append(aliases, normalized)
	}
	return aliases
}

func normalizeShopText(value string) string {
	var b strings.Builder
	for _, ch := range strings.ToLower(value) {
		if ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

func networkRelevant(url string, mime string) bool {
	haystack := strings.ToLower(url + " " + mime)
	if strings.Contains(haystack, "image/") || strings.Contains(haystack, "font") || strings.Contains(haystack, "stylesheet") {
		return false
	}
	for _, marker := range []string{"json", "graphql", "conversation", "message", "inbox", "chat", "shopify"} {
		if strings.Contains(haystack, marker) {
			return true
		}
	}
	return false
}

func httpClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func ensureLoopbackEndpoint(raw string) error {
	parsed, err := neturl.Parse(raw)
	if err != nil {
		return err
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("blocked non-local DevTools endpoint: %s", host)
}

func asMap(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		out, _ := typed.Int64()
		return int(out)
	default:
		return 0
	}
}

func mergeMaps(base map[string]any, override map[string]any) map[string]any {
	for key, value := range override {
		base[key] = value
	}
	return base
}

var ErrNoTarget = errors.New("no target")
