package platform

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
)

type emailMailboxBindingConflict struct {
	Mailbox       string
	BoundShopID   string
	BoundShopName string
}

func (e *emailMailboxBindingConflict) Error() string {
	return fmt.Sprintf("%v: 邮箱 %s 已绑定到店铺 %s", ErrConflict, e.Mailbox, e.BoundShopName)
}

func (e *emailMailboxBindingConflict) Unwrap() error {
	return ErrConflict
}

type emailCallbackAction struct {
	Label   string
	URL     string
	Primary bool
}

func (s *Server) ensureEmailMailboxAvailable(ctx context.Context, targetShopID string, mailbox string) error {
	targetShopID = strings.TrimSpace(targetShopID)
	mailbox = normalizeEmail(mailbox)
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return err
	}
	for _, shop := range shops {
		if shop.ID == targetShopID {
			continue
		}
		if _, err := s.store.GetEmailInstallation(ctx, shop.ID, mailbox); err == nil {
			return &emailMailboxBindingConflict{
				Mailbox:       mailbox,
				BoundShopID:   shop.ID,
				BoundShopName: strings.TrimSpace(shop.DisplayName),
			}
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

func writeEmailCallbackFailure(w http.ResponseWriter, status int, title string, message string, actions ...emailCallbackAction) {
	var actionHTML strings.Builder
	for _, action := range actions {
		if strings.TrimSpace(action.Label) == "" || strings.TrimSpace(action.URL) == "" {
			continue
		}
		className := "button"
		if action.Primary {
			className += " button-primary"
		}
		_, _ = fmt.Fprintf(&actionHTML, `<a class="%s" href="%s">%s</a>`, className, html.EscapeString(action.URL), html.EscapeString(action.Label))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title><style>body{margin:0;background:#f6f8fb;color:#172033;font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif}.page{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(520px,100%%);background:#fff;border:1px solid #dfe5ef;border-radius:14px;box-shadow:0 16px 40px rgba(33,48,74,.1);padding:28px;box-sizing:border-box}.mark{width:42px;height:42px;border-radius:12px;background:#fff4e5;color:#c86b00;display:grid;place-items:center;font-size:24px;font-weight:700}h1{font-size:22px;margin:18px 0 10px}p{margin:0;color:#5b6780;font-size:15px;line-height:1.75}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:26px;flex-wrap:wrap}.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 16px;border:1px solid #cfd7e5;border-radius:8px;color:#24324a;text-decoration:none;font-size:14px;font-weight:600;background:#fff}.button-primary{border-color:#1677ff;background:#1677ff;color:#fff}</style></head><body><main class="page"><section class="card"><div class="mark">!</div><h1>%s</h1><p>%s</p><div class="actions">%s</div></section></main></body></html>`, html.EscapeString(title), html.EscapeString(title), html.EscapeString(message), actionHTML.String())
}

func writeEmailMailboxBindingConflict(w http.ResponseWriter, r *http.Request, mailbox string, err error, retryURL string) {
	mailbox = normalizeEmail(mailbox)
	boundShopName := "其他店铺"
	var conflict *emailMailboxBindingConflict
	if errors.As(err, &conflict) {
		mailbox = firstNonEmpty(conflict.Mailbox, mailbox)
		boundShopName = firstNonEmpty(conflict.BoundShopName, boundShopName)
	}
	message := fmt.Sprintf("邮箱 %s 已绑定到店铺“%s”，不能重复接入。原有连接未受影响。", mailbox, boundShopName)
	writeEmailCallbackFailure(w, http.StatusConflict, "该邮箱已绑定", message,
		emailCallbackAction{Label: "返回 Xzdesk", URL: strings.TrimRight(requestBaseURL(r), "/") + "/"},
		emailCallbackAction{Label: "使用其他邮箱", URL: retryURL, Primary: true},
	)
}
