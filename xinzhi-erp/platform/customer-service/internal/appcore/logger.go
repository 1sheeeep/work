package appcore

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Logger struct {
	path string
	mu   sync.Mutex
}

func NewLogger(path string) *Logger {
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	return &Logger{path: path}
}

func (l *Logger) Append(event string, details any) {
	if l == nil {
		return
	}
	payload := map[string]any{
		"time":    time.Now().Format(time.RFC3339),
		"event":   event,
		"details": redact(details),
	}
	raw, _ := json.Marshal(payload)
	l.mu.Lock()
	defer l.mu.Unlock()
	_ = os.MkdirAll(filepath.Dir(l.path), 0755)
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(raw, '\n'))
}

func (l *Logger) Tail(maxLines int) string {
	if l == nil {
		return ""
	}
	if maxLines <= 0 || maxLines > 1000 {
		maxLines = 200
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.Open(l.path)
	if err != nil {
		return ""
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > maxLines {
			lines = lines[len(lines)-maxLines:]
		}
	}
	return strings.Join(lines, "\n")
}

var sensitiveKey = regexp.MustCompile(`(?i)(password|passwd|cookie|token|authorization|secret|captcha|proxy_password|proxy_url|proxyUrl|access_token|refresh_token|auth_code|code|mall_account|ip_address)`)

func redact(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range typed {
			if sensitiveKey.MatchString(key) {
				out[key] = "***REDACTED***"
			} else {
				out[key] = redact(item)
			}
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = redact(item)
		}
		return out
	case string:
		redacted := regexp.MustCompile(`(?i)(cookie|authorization|token|password|code|client_secret)=([^;&\s]+)`).ReplaceAllString(typed, "$1=***REDACTED***")
		redacted = regexp.MustCompile(`(?i)(https?://[^:\s/@]+):([^@\s]+)@`).ReplaceAllString(redacted, "$1:***REDACTED***@")
		return redacted
	default:
		return value
	}
}
