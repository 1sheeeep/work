package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"shopify-support-platform/internal/adapters"
	"shopify-support-platform/internal/ai"
	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/browserread"
	"shopify-support-platform/internal/email"
	"shopify-support-platform/internal/inbox"
	"shopify-support-platform/internal/knowledge"
	"shopify-support-platform/internal/mailapi"
	"shopify-support-platform/internal/records"
	"shopify-support-platform/internal/sender"
	"shopify-support-platform/internal/sourcepage"
	"shopify-support-platform/internal/winexec"
)

type App struct {
	ctx            context.Context
	core           *appcore.Core
	cancel         context.CancelFunc
	realtimeCancel context.CancelFunc
	tray           trayController
	mu             sync.Mutex
	readMu         sync.Mutex
	readTaskID     uint64
	paused         bool
	quitting       bool
	backgroundMode bool
	currentShop    appcore.Shop
	shops          []appcore.Shop
	authMu         sync.Mutex
	authServer     *http.Server
}

func NewApp() *App {
	return &App{backgroundMode: false}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.core = appcore.NewCore()
	a.core.Bootstrap()
	a.tray = newTrayController(a)
	a.tray.Start()
	a.core.Log("tray.started", nil)
	go func() {
		time.Sleep(300 * time.Millisecond)
		wailsruntime.Show(ctx)
		wailsruntime.WindowShow(ctx)
		wailsruntime.WindowUnminimise(ctx)
	}()
	go func() {
		time.Sleep(2500 * time.Millisecond)
		a.maybeRunKnowledgeDigest("startup")
	}()
}

func (a *App) shutdown(ctx context.Context) {
	a.CancelRead()
	a.StopRealtimeObserve()
	if a.tray != nil {
		a.tray.Stop()
	}
	if a.core != nil {
		a.core.Log("app.shutdown", nil)
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	quitting := a.quitting
	a.mu.Unlock()
	if quitting {
		return false
	}
	wailsruntime.WindowHide(ctx)
	wailsruntime.Hide(ctx)
	if a.core != nil {
		a.core.Log("window.hide_to_tray", map[string]any{"reason": "close"})
	}
	return true
}

func (a *App) Bootstrap() appcore.BootstrapState {
	state := a.core.State()
	detection := adapters.DetectZhanfuClientPath(state.Settings.Zhanfu, a.core.Logger())
	if state.Settings.Zhanfu == nil {
		state.Settings.Zhanfu = map[string]any{}
	}
	state.Settings.Zhanfu["detected_client_exe_path"] = detection.Path
	state.Settings.Zhanfu["client_path_source"] = detection.Source
	if detection.Path == "" {
		state.Settings.Zhanfu["client_path_status"] = "not_found"
		state.Settings.Zhanfu["client_path_error"] = detection.Error
	} else {
		state.Settings.Zhanfu["client_path_status"] = "found"
	}
	return state
}

func (a *App) GetSettings() appcore.Settings {
	return a.core.Settings()
}

func (a *App) SaveSettings(settings appcore.Settings) appcore.ActionResult {
	result := a.core.SaveSettings(settings)
	if result.OK {
		go a.maybeRunKnowledgeDigest("settings")
	}
	return result
}

func (a *App) GetLogs(maxLines int) string {
	return a.core.TailLogs(maxLines)
}

func (a *App) RuntimeInfo() appcore.ActionResult {
	state := a.core.State()
	knowledgePath := filepath.Join(a.core.DataDir(), "knowledge_base.jsonl")
	digestPath := filepath.Join(a.core.DataDir(), "knowledge_digest.json")
	recordPath := filepath.Join(a.core.DataDir(), "records", "handled_records.jsonl")
	return appcore.OK(map[string]any{
		"rootDir":               state.RootDir,
		"dataDir":               state.DataDir,
		"configPath":            state.ConfigPath,
		"logPath":               state.LogPath,
		"knowledgePath":         knowledgePath,
		"knowledgeDigestPath":   digestPath,
		"knowledgeDigestExists": fileExists(digestPath),
		"recordPath":            recordPath,
	})
}

func (a *App) ReadLocalAsset(assetPath string) appcore.ActionResult {
	rawPath := strings.TrimSpace(assetPath)
	if rawPath == "" {
		return appcore.Fail("asset path is empty")
	}
	absPath, err := filepath.Abs(rawPath)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	allowedRoot, err := filepath.Abs(filepath.Join(a.core.RootDir(), "runtime", "email-assets"))
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if !isPathInside(absPath, allowedRoot) {
		return appcore.Fail("asset path is outside the email asset directory")
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if info.IsDir() {
		return appcore.Fail("asset path is a directory")
	}
	if info.Size() > 12*1024*1024 {
		return appcore.Fail("asset is too large")
	}
	mimeType := mimeTypeForAsset(absPath)
	if mimeType == "" {
		return appcore.Fail("unsupported asset type")
	}
	bytes, err := os.ReadFile(absPath)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(map[string]any{
		"path":     absPath,
		"mimeType": mimeType,
		"dataUrl":  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(bytes),
	})
}

func (a *App) OpenLogDirectory() appcore.ActionResult {
	dir := filepath.Dir(a.core.State().LogPath)
	cmd := exec.Command("explorer", dir)
	winexec.HideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(true)
}

func (a *App) SelectKnowledgeImportFile() appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select knowledge import file",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Knowledge JSON file", Pattern: "*.json"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(path)
}

func (a *App) SelectMailProxyImportFile() appcore.ActionResult {
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择邮箱代理 CSV",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "CSV 文件", Pattern: "*.csv"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if strings.TrimSpace(path) == "" {
		return appcore.Fail("未选择文件")
	}
	return appcore.OK(path)
}

func (a *App) SelectKnowledgeExportFile() appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "Select knowledge export location",
		DefaultFilename: "knowledge_export.json",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Knowledge JSON file", Pattern: "*.json"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(path)
}

func (a *App) SelectRecordExportFile(startDate string, endDate string) appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	fileName := "handled_records_" + compactDate(startDate) + "_" + compactDate(endDate) + ".xlsx"
	path, err := wailsruntime.SaveFileDialog(a.ctx, wailsruntime.SaveDialogOptions{
		Title:           "Select handled records export location",
		DefaultFilename: fileName,
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Excel workbook", Pattern: "*.xlsx"},
			{DisplayName: "All files", Pattern: "*.*"},
		},
	})
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(path)
}

func (a *App) SetBackgroundMode(enabled bool) appcore.ActionResult {
	a.mu.Lock()
	a.backgroundMode = enabled
	a.mu.Unlock()
	a.core.Log("background_mode.changed", map[string]any{"enabled": enabled})
	return appcore.OK(enabled)
}

func (a *App) HideToTray() appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	wailsruntime.WindowHide(a.ctx)
	wailsruntime.Hide(a.ctx)
	a.core.Log("window.hide_to_tray", map[string]any{"reason": "manual"})
	return appcore.OK(true)
}

func (a *App) ShowMainWindow() appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	wailsruntime.Show(a.ctx)
	wailsruntime.WindowShow(a.ctx)
	wailsruntime.WindowUnminimise(a.ctx)
	a.core.Log("window.show_from_tray", nil)
	return appcore.OK(true)
}

func (a *App) QuitApp() appcore.ActionResult {
	if a.ctx == nil {
		return appcore.Fail("window is not initialized")
	}
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	a.core.Log("app.quit.requested", nil)
	wailsruntime.Quit(a.ctx)
	return appcore.OK(true)
}

func (a *App) ListShops() appcore.ActionResult {
	settings := a.core.Settings()
	shops, err := adapters.ListShops(settings, a.core.Logger())
	if err != nil {
		a.core.Log("shops.list.failed", map[string]any{"error": err.Error()})
		return appcore.Fail(err.Error())
	}
	a.core.Log("shops.list.ok", map[string]any{"count": len(shops)})
	settings, shops = mailapi.SyncAdapterProxyBindings(a.core.Settings(), shops)
	testCtx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	settings = mailapi.AutoTestProxyBindings(testCtx, settings, openShopsForProxyTest(shops))
	cancel()
	shops = mailapi.AnnotateShops(settings, shops)
	if saveResult := a.core.SaveSettings(settings); !saveResult.OK {
		a.core.Log("mail.proxy_sync.save_failed", map[string]any{"error": saveResult.Error})
	}
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	return appcore.OK(shops)
}

func openShopsForProxyTest(shops []appcore.Shop) []appcore.Shop {
	out := make([]appcore.Shop, 0, len(shops))
	for _, shop := range shops {
		if isOpenShopStatus(shop) {
			out = append(out, shop)
		}
	}
	return out
}

func (a *App) AttachOpenShop(shop appcore.Shop) appcore.ActionResult {
	openResult, err := adapters.AttachOpenShop(a.core.Settings(), shop, a.core.Logger())
	if err != nil {
		a.core.Log("shop.attach.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
		return appcore.Fail(err.Error())
	}
	a.core.SetOpenResult(openResult)
	a.currentShop = shop
	a.core.Log("shop.attach.ok", map[string]any{"shop": shop.DisplayName, "webdriverUrl": openResult.WebDriverURL})
	return appcore.OK(openResult)
}

func (a *App) TestBrowserSettings() appcore.ActionResult {
	return appcore.OK(adapters.ProbeStatuses(a.core.Settings(), a.core.Logger()))
}

func (a *App) ProbeAISettings() appcore.ActionResult {
	return appcore.OK(ai.ProbeSettings(a.core.Settings().AI))
}

func (a *App) StartZhanfuAPI() appcore.ActionResult {
	if err := adapters.StartZhanfuAPI(a.core.Settings().Zhanfu, a.core.Logger()); err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(true)
}

func (a *App) ImportMailProxyBindings(csvPath string) appcore.ActionResult {
	settings, result, err := mailapi.ImportProxyBindings(a.core.Settings(), csvPath)
	if err != nil {
		a.core.Log("mail.proxy_import.failed", map[string]any{"error": err.Error()})
		return appcore.Fail(err.Error())
	}
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	a.core.Log("mail.proxy_import.ok", map[string]any{"imported": result.Imported, "skipped": result.Skipped})
	return appcore.OK(result)
}

func (a *App) TestShopMailProxy(mallID string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	settings, result, err := mailapi.TestShopProxy(ctx, a.core.Settings(), shop)
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	if err != nil {
		a.core.Log("mail.proxy_test.failed", map[string]any{"mall_id": mallID, "error": err.Error()})
		return appcore.Fail(err.Error())
	}
	a.core.Log("mail.proxy_test.ok", map[string]any{"mall_id": mallID, "matched": result.Matched})
	return appcore.OK(result)
}

func (a *App) StartOutlookAuthorization(mallID string) appcore.ActionResult {
	return a.StartMailAuthorization(mallID)
}

func (a *App) StartGmailAuthorization(mallID string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	provider := mailapi.GmailProvider{}
	settings, result, err := provider.AuthorizationURL(a.core.Settings(), shop)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	if err := a.startOutlookCallbackServer(result.RedirectURI); err != nil {
		return appcore.Fail(err.Error())
	}
	result.BrowserOpened = true
	go a.openMailAuthorizationURL(shop, result.AuthURL, "gmail")
	a.core.Log("mail.gmail_auth.start", map[string]any{"mall_id": mallID, "redirect_uri": result.RedirectURI, "browser_opened": result.BrowserOpened})
	return appcore.OK(result)
}

func (a *App) SaveCuiqiuAuthorization(mallID string, token string, mailID string, domainID string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	settings, savedMailID, err := mailapi.SaveCuiqiuAuthorization(ctx, a.core.Settings(), shop, token, mailID, domainID)
	if err != nil {
		a.core.Log("mail.cuiqiu_auth.failed", map[string]any{"mall_id": mallID, "error": err.Error()})
		return appcore.Fail(err.Error())
	}
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	shops := mailapi.AnnotateShops(settings, a.cachedShops())
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "mail:auth-updated", map[string]any{"mallId": mallID, "shops": shops})
	}
	a.core.Log("mail.cuiqiu_auth.ok", map[string]any{"mall_id": mallID, "mail_id": savedMailID})
	return appcore.OK(shops)
}

func (a *App) StartMailAuthorization(mallID string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	provider := mailapi.NewProviderForShop(a.core.Settings(), shop)
	settings, result, err := provider.AuthorizationURL(a.core.Settings(), shop)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	if err := a.startOutlookCallbackServer(result.RedirectURI); err != nil {
		return appcore.Fail(err.Error())
	}
	result.BrowserOpened = true
	go a.openMailAuthorizationURL(shop, result.AuthURL, mailapi.MailProviderForShop(settings, shop))
	a.core.Log("mail.auth.start", map[string]any{"mall_id": mallID, "provider": mailapi.MailProviderForShop(settings, shop), "redirect_uri": result.RedirectURI, "browser_opened": result.BrowserOpened})
	return appcore.OK(result)
}

func (a *App) openMailAuthorizationURL(shop appcore.Shop, authURL string, provider string) {
	openResult, openErr := adapters.OpenShop(a.core.Settings(), shop, a.core.Logger())
	if openErr == nil {
		openErr = sourcepage.OpenURLBestEffortFocus(openResult, authURL)
	}
	if openErr != nil {
		a.core.Log("mail.auth.open_failed", map[string]any{"mall_id": shop.MallID, "provider": provider, "error": openErr.Error()})
		return
	}
	a.core.SetOpenResult(openResult)
	a.core.Log("mail.auth.opened", map[string]any{"mall_id": shop.MallID, "provider": provider, "webdriver_url": openResult.WebDriverURL})
}

func (a *App) CompleteOutlookAuthorization(callbackCode string) appcore.ActionResult {
	return a.CompleteMailAuthorization(callbackCode)
}

func (a *App) CompleteMailAuthorization(callbackCode string) appcore.ActionResult {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	provider := mailapi.NewProviderForPendingAuthorization(a.core.Settings(), callbackCode)
	settings, result, err := provider.CompleteAuthorization(ctx, a.core.Settings(), callbackCode)
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return saveResult
	}
	if err != nil {
		a.core.Log("mail.auth.failed", map[string]any{"error": err.Error()})
		return appcore.Fail(err.Error())
	}
	shops := mailapi.AnnotateShops(a.core.Settings(), a.cachedShops())
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "mail:auth-updated", map[string]any{"mallId": result.MallID, "shops": shops})
	}
	a.core.Log("mail.auth.ok", map[string]any{"mall_id": result.MallID, "matched": result.Matched})
	return appcore.OK(result)
}

func (a *App) ReadShopMailViaAPI(mallID string, queryOptions map[string]any) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := a.readShopMailViaAPI(ctx, shop, queryOptions)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) ReadShopMailViaWeb(mallID string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	a.readMu.Lock()
	defer a.readMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	result, err := a.readShopMailViaWebForBatch(ctx, shop, true)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) ReadAllOpenShopsViaWeb() appcore.ActionResult {
	return a.ReadAllOpenShops()
}

func (a *App) ReadAllShopsViaWeb() appcore.ActionResult {
	return a.ReadAllShops()
}

func (a *App) ReadAllOpenShopsMailViaAPI() appcore.ActionResult {
	return a.readShopsMailViaAPI("api-current", true)
}

func (a *App) ReadAllShopsMailViaAPI() appcore.ActionResult {
	return a.readShopsMailViaAPI("api-all", false)
}

func (a *App) ReadAllOpenShopsMailDefault() appcore.ActionResult {
	return a.readShopsMailDefault("current", true)
}

func (a *App) ReadAllShopsMailDefault() appcore.ActionResult {
	return a.readShopsMailDefault("all", false)
}

func (a *App) DisableShopMailAPI(mallID string, disabled bool) appcore.ActionResult {
	settings := mailapi.SetShopAPIDisabled(a.core.Settings(), mallID, disabled)
	result := a.core.SaveSettings(settings)
	if !result.OK {
		return result
	}
	shops := mailapi.AnnotateShops(a.core.Settings(), a.cachedShops())
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	a.core.Log("mail.api_shop_toggle.ok", map[string]any{"mall_id": mallID, "disabled": disabled})
	return appcore.OK(shops)
}

func (a *App) SaveShopServiceEmail(mallID string, email string) appcore.ActionResult {
	shop, ok := a.findShopByMallID(mallID)
	if !ok {
		return appcore.Fail("shop not found: " + mallID)
	}
	settings, err := mailapi.SaveShopServiceEmail(a.core.Settings(), shop, email)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	result := a.core.SaveSettings(settings)
	if !result.OK {
		return result
	}
	shops := mailapi.AnnotateShops(a.core.Settings(), a.cachedShops())
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	a.core.Log("mail.service_email.saved", map[string]any{"mall_id": mallID, "email": strings.TrimSpace(email)})
	return appcore.OK(shops)
}

func (a *App) startOutlookCallbackServer(redirectURI string) error {
	parsed, err := url.Parse(redirectURI)
	if err != nil {
		return err
	}
	if parsed.Host == "" {
		return errors.New("Outlook 回调地址缺少主机名")
	}
	path := parsed.Path
	if path == "" {
		path = "/"
	}
	a.authMu.Lock()
	if a.authServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = a.authServer.Shutdown(shutdownCtx)
		cancel()
		a.authServer = nil
	}
	mux := http.NewServeMux()
	server := &http.Server{Addr: parsed.Host, Handler: mux}
	listener, err := net.Listen("tcp", parsed.Host)
	if err != nil {
		a.authMu.Unlock()
		return fmt.Errorf("Outlook 回调端口不可用：%w", err)
	}
	a.authServer = server
	a.authMu.Unlock()
	mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		callbackURL := "http://" + r.Host + r.URL.String()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if callbackError := strings.TrimSpace(r.URL.Query().Get("error")); callbackError != "" {
			description := strings.TrimSpace(r.URL.Query().Get("error_description"))
			message := mailapi.MicrosoftAuthorizationError(callbackError, description)
			a.core.Log("mail.outlook_callback.error", map[string]any{"error": callbackError, "description": description, "state": r.URL.Query().Get("state")})
			_, _ = io.WriteString(w, "<!doctype html><meta charset=\"utf-8\"><title>Outlook 授权失败</title><body>"+html.EscapeString(message)+"</body>")
			return
		}
		if r.URL.Query().Get("code") == "" {
			a.core.Log("mail.outlook_callback.missing_code", map[string]any{"query": r.URL.RawQuery})
			_, _ = io.WriteString(w, "<!doctype html><meta charset=\"utf-8\"><title>Outlook 授权失败</title><body>Microsoft 未返回授权码，请重新点击“API授权”。</body>")
			return
		}
		go func() {
			result := a.CompleteOutlookAuthorization(callbackURL)
			if !result.OK {
				a.core.Log("mail.outlook_callback.failed", map[string]any{"error": result.Error})
			}
		}()
		_, _ = io.WriteString(w, "<!doctype html><meta charset=\"utf-8\"><title>Outlook 授权完成</title><body>Outlook 授权码已收到，可以关闭此页面并回到软件。</body>")
	})
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			a.core.Log("mail.outlook_callback.listen_failed", map[string]any{"error": err.Error()})
		}
	}()
	return nil
}

func (a *App) ReadShopInbox(shop appcore.Shop) appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	return a.readShopInboxLocked(shop)
}

func (a *App) readShopInboxLocked(shop appcore.Shop) appcore.ActionResult {
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	shop = mailapi.AnnotateShop(a.core.Settings(), shop)
	a.emitReadProgressPhase("single", "start", shop, appcore.InboxResult{}, nil, 1, 1, 0)
	var result appcore.InboxResult
	var err error
	var webInboxErr error
	if shop.APIDisabled {
		result, err = a.readShopMailViaWebForBatch(ctx, shop, true)
	} else {
		inboxResult, inboxErr := a.readShopInboxViaWebForBatch(ctx, shop, true)
		webInboxErr = inboxErr
		mailResult, mailErr := a.readShopMailViaAPI(ctx, shop, batchMailAPIOptions())
		if isContextDone(inboxErr) {
			err = inboxErr
		} else if isContextDone(mailErr) {
			err = mailErr
		} else if inboxErr != nil && mailErr != nil {
			if isMissingShopifyInboxPageError(inboxErr) {
				err = mailErr
			} else {
				err = fmt.Errorf("Shopify Inbox：%s；Outlook API：%s", friendlyReadError(inboxErr), friendlyReadError(mailErr))
			}
		} else if inboxErr != nil {
			result = mailResult
			result.Warnings = appendUniqueStrings(result.Warnings, "Shopify Inbox 网页读取失败："+friendlyReadError(inboxErr))
			result.Status = mergeInboxStatus(result.Status, "partial")
		} else if mailErr != nil {
			result = inboxResult
			result.ProviderErrors = appendUniqueStrings(result.ProviderErrors, "Outlook API："+friendlyReadError(mailErr))
			result.Status = mergeInboxStatus(result.Status, "partial")
		} else {
			result = combineInboxAndMailResults(inboxResult, mailResult)
		}
	}
	if err == nil && webInboxErr != nil && browserread.IsCDPConnectFailure(webInboxErr) && len(result.Conversations) == 0 {
		err = cdpReadIncompleteError(webInboxErr)
	}
	if err != nil {
		if isContextDone(err) {
			err = errors.New(cancelledReadMessage())
		}
		a.emitReadProgressPhase("single", "error", shop, appcore.InboxResult{
			Status:        "partial",
			Conversations: []appcore.Conversation{},
		}, err, 1, 1, 0)
		return appcore.Fail(err.Error())
	}
	if err := ctx.Err(); err != nil {
		a.emitReadProgressPhase("single", "error", shop, appcore.InboxResult{
			Status:        "partial",
			Conversations: []appcore.Conversation{},
		}, err, 1, 1, 0)
		return appcore.Fail(cancelledReadMessage())
	}
	result.Conversations = appcore.AnnotateDuplicates(result.Conversations)
	a.core.StoreConversations(shop, result.Conversations)
	a.emitReadProgressPhase("single", "done", shop, result, nil, 1, 1, 1)
	a.core.Log("messages.read_store.ok", inboxLogMeta(shop.DisplayName, result))
	return appcore.OK(result)
}

func (a *App) GetShopConversations(shop appcore.Shop) appcore.ActionResult {
	productCards := a.core.ShopProductCards(shop)
	if cards, err := a.fetchStorefrontProductCards(shop); err == nil && len(cards) > 0 {
		productCards = a.core.StoreShopProductCards(shop, mergeManualAndAutoProductCards(productCards, cards))
	} else if err != nil {
		a.core.Log("product.cache.fetch.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
	}
	conversations := annotateConversationsForShop(shop, a.core.ConversationCache(shop))
	conversations = a.resolveConversationProductInterestCards(context.Background(), shop, conversations)
	conversations = a.withProductCards(conversations, productCards)
	return appcore.OK(appcore.InboxResult{
		StoreSlug:     appcore.ShopKey(shop),
		Title:         shop.DisplayName,
		Status:        "ready",
		ProductCards:  productCards,
		Conversations: appcore.AnnotateDuplicates(conversations),
	})
}

func (a *App) AddShopProductCard(shop appcore.Shop, card appcore.ProductCard) appcore.ActionResult {
	card.Title = strings.TrimSpace(card.Title)
	card.URL = strings.TrimSpace(card.URL)
	card.ImageURL = strings.TrimSpace(card.ImageURL)
	card.Manual = true
	if card.URL == "" {
		return appcore.Fail("product link cannot be empty")
	}
	parsed, err := url.Parse(card.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return appcore.Fail("invalid product link format")
	}
	card = enrichProductCardFromStorefront(card)
	card.Manual = true
	if !isRecommendableProductCard(card) {
		return appcore.Fail("该链接像物流、保险、包装、捐赠等服务项，不适合作为产品推荐")
	}
	if card.Title == "" {
		card.Title = "Recommended Product"
	}
	current := a.core.ShopProductCards(shop)
	automatic := []appcore.ProductCard(nil)
	if cards, err := a.fetchStorefrontProductCards(shop); err == nil {
		automatic = cards
	} else {
		a.core.Log("product.cache.fetch.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
	}
	next := mergeManualAndAutoProductCards(append([]appcore.ProductCard{card}, current...), automatic)
	stored := a.core.StoreShopProductCards(shop, next)
	a.core.Log("product.cache.manual_added", map[string]any{"shop": shop.DisplayName, "url": card.URL})
	return appcore.OK(stored)
}

func (a *App) DeleteShopProductCard(shop appcore.Shop, productURL string) appcore.ActionResult {
	productURL = strings.TrimSpace(productURL)
	if productURL == "" {
		return appcore.Fail("product link cannot be empty")
	}
	current := a.core.ShopProductCards(shop)
	filtered := make([]appcore.ProductCard, 0, len(current))
	removed := false
	for _, card := range current {
		if card.Manual && strings.EqualFold(strings.TrimSpace(card.URL), productURL) {
			removed = true
			continue
		}
		filtered = append(filtered, card)
	}
	if !removed {
		return appcore.Fail("manual product link not found")
	}
	automatic := []appcore.ProductCard(nil)
	if cards, err := a.fetchStorefrontProductCards(shop); err == nil {
		automatic = cards
	} else {
		a.core.Log("product.cache.fetch.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
	}
	stored := a.core.StoreShopProductCards(shop, mergeManualAndAutoProductCards(filtered, automatic))
	a.core.Log("product.cache.manual_deleted", map[string]any{"shop": shop.DisplayName, "url": productURL})
	return appcore.OK(stored)
}

func (a *App) readShopInboxOnly(ctx context.Context, shop appcore.Shop, openIfNeeded bool) (appcore.InboxResult, appcore.OpenResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, appcore.OpenResult{}, err
	}
	var openResult appcore.OpenResult
	var err error
	mode := "attach_open"
	if openIfNeeded {
		mode = "open_or_attach"
	}
	a.core.Log("messages.read_shop.start", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "mode": mode})
	if openIfNeeded {
		openResult, err = adapters.OpenShop(a.core.Settings(), shop, a.core.Logger())
	} else {
		openResult, err = adapters.AttachOpenShop(a.core.Settings(), shop, a.core.Logger())
	}
	if err != nil {
		a.core.Log("messages.read_shop.open_failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "mode": mode, "error": err.Error()})
		return appcore.InboxResult{}, appcore.OpenResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, openResult, err
	}
	a.core.Log("messages.read_shop.connected", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "mode": mode, "webdriver_url": openResult.WebDriverURL})
	a.core.SetOpenResult(openResult)
	a.currentShop = shop
	recoveredConnection := false
	for {
		if err := a.waitIfPaused(ctx); err != nil {
			return appcore.InboxResult{}, openResult, err
		}
		readCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
		result, err := inbox.ReadShopInbox(readCtx, inbox.ReadOptions{
			OpenResult:     openResult,
			Shop:           shop,
			Cache:          a.core.ConversationCache(shop),
			Logger:         a.core.Logger(),
			PauseFunc:      a.waitIfPaused,
			ActivateTarget: !a.isBackgroundMode(),
			ForceRefresh:   false,
		})
		cancel()
		if err != nil && browserread.IsInterrupted(err) && a.isReadPaused() {
			a.core.Log("inbox.read.paused", map[string]any{"shop": shop.DisplayName})
			continue
		}
		if shouldRecoverCDPConnection(err, recoveredConnection) {
			a.core.Log("inbox.read.cdp_recovery.start", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
			recovered, recoverErr := adapters.RecoverOpenShopConnection(a.core.Settings(), shop, a.core.Logger())
			if recoverErr == nil {
				recoveredConnection = true
				openResult = recovered
				a.core.SetOpenResult(openResult)
				a.core.Log("inbox.read.cdp_recovery.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": openResult.WebDriverURL})
				continue
			}
			a.core.Log("inbox.read.cdp_recovery.failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": recoverErr.Error()})
		}
		if err != nil {
			a.core.Log("inbox.read.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
			return appcore.InboxResult{}, openResult, err
		}
		a.core.Log("inbox.read.ok", inboxLogMeta(shop.DisplayName, result))
		return result, openResult, nil
	}
}

func (a *App) ReadAllOpenShops() appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	shops := a.cachedShops()
	if len(shops) == 0 {
		listResult := a.ListShops()
		if !listResult.OK {
			return listResult
		}
		shops, _ = listResult.Data.([]appcore.Shop)
	}
	if err := ctx.Err(); err != nil {
		a.core.Log("messages.read_open.cancelled", map[string]any{"stage": "list_shops"})
		return appcore.OK(cancelledReadPayload(shops, 0, len(shops)))
	}
	shops = adapters.AnnotateOpenStatuses(a.core.Settings(), shops, a.core.Logger())
	if err := ctx.Err(); err != nil {
		a.core.Log("messages.read_open.cancelled", map[string]any{"stage": "open_status"})
		return appcore.OK(cancelledReadPayload(shops, 0, len(shops)))
	}
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	var openShops []appcore.Shop
	for _, shop := range shops {
		if isOpenShopStatus(shop) {
			openShops = append(openShops, shop)
		}
	}
	if len(openShops) == 0 {
		a.core.Log("messages.read_open.no_open_shops", map[string]any{"total": len(shops)})
		return appcore.OK(map[string]any{
			"conversations": []appcore.Conversation{},
			"errors":        []string{"No open shop environment detected; read current shop only handles already-open environments."},
			"shops":         shops,
			"opened":        0,
			"skipped":       len(shops),
		})
	}
	var all []appcore.Conversation
	var errors []string
	var warnings []string
	var providerErrors []string
	opened := 0
	skipped := len(shops) - len(openShops)
	for index, shop := range openShops {
		if err := a.waitIfPaused(ctx); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_open.cancelled", map[string]any{"stage": "pause_wait", "opened": opened})
			break
		}
		a.emitReadProgressPhase("current", "start", shop, appcore.InboxResult{}, nil, index+1, len(openShops), opened)
		result, openResult, err := a.readShopInboxOnly(ctx, shop, false)
		if isContextDone(err) {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_open.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		var inboxErr error
		if err != nil {
			if strings.TrimSpace(openResult.WebDriverURL) == "" {
				skipped++
				errors = append(errors, fmt.Sprintf("%s：%s", shop.DisplayName, friendlyReadError(err)))
				a.core.Log("messages.read_open.skipped", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
				a.emitReadProgressPhase("current", "error", shop, appcore.InboxResult{
					Status:        "partial",
					Conversations: []appcore.Conversation{},
				}, err, index+1, len(openShops), opened)
				continue
			}
			inboxErr = err
			a.core.Log("messages.read_open.inbox_failed_email_continues", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
			result = appcore.InboxResult{
				StoreSlug:     appcore.ShopKey(shop),
				Title:         shop.DisplayName,
				Status:        "partial",
				Warnings:      []string{"Shopify Inbox read failed; email scan continued: " + err.Error()},
				Conversations: []appcore.Conversation{},
			}
		}
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_open.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		opened++
		result = a.mergeOpenEmail(ctx, shop, openResult, result)
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_open.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		if inboxErr != nil && len(result.Conversations) == 0 {
			if browserread.IsCDPConnectFailure(inboxErr) {
				skipped++
				err = cdpReadIncompleteError(inboxErr)
				errors = append(errors, fmt.Sprintf("%s：%s", shop.DisplayName, friendlyReadError(err)))
				a.core.Log("messages.read_open.inbox_incomplete", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": inboxErr.Error()})
				a.emitReadProgressPhase("current", "error", shop, appcore.InboxResult{Status: "partial", Conversations: []appcore.Conversation{}}, err, index+1, len(openShops), opened)
				continue
			}
			errors = append(errors, fmt.Sprintf("%s：Shopify Inbox 和邮箱都未读取到内容：%s", shop.DisplayName, friendlyReadError(inboxErr)))
			a.core.Log("messages.read_open.skipped_after_email_empty", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": inboxErr.Error()})
		}
		result.ProductCards = a.updateShopProductCache(ctx, shop, result)
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_open.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		result.Conversations = a.resolveConversationProductInterestCards(ctx, shop, annotateConversationsForShop(shop, result.Conversations))
		result.Conversations = a.withShopProductCards(shop, result.Conversations)
		warnings = append(warnings, prefixMessages(shop.DisplayName, result.Warnings)...)
		providerErrors = append(providerErrors, prefixMessages(shop.DisplayName, result.ProviderErrors)...)
		a.core.StoreConversations(shop, result.Conversations)
		a.emitReadProgressPhase("current", "done", shop, result, nil, index+1, len(openShops), opened)
		all = append(all, result.Conversations...)
	}
	all = appcore.AnnotateDuplicates(all)
	a.core.Log("messages.read_open.done", map[string]any{"count": len(all), "open_candidates": len(openShops), "opened": opened, "skipped": skipped, "errors": len(errors)})
	return appcore.OK(map[string]any{"conversations": all, "errors": errors, "warnings": warnings, "providerErrors": providerErrors, "shops": shops, "opened": opened, "skipped": skipped})
}

func isOpenShopStatus(shop appcore.Shop) bool {
	status := strings.ToLower(strings.TrimSpace(shop.Status))
	if status == "open" || status == "opened" || status == "running" || status == "active" || status == "1" || status == "true" {
		return true
	}
	return false
}

func shouldRecoverCDPConnection(err error, alreadyRecovered bool) bool {
	return err != nil && !alreadyRecovered && browserread.IsCDPConnectFailure(err)
}

func cdpReadIncompleteError(err error) error {
	if err == nil {
		return errors.New("\u6d4f\u89c8\u5668\u8fde\u63a5\u8d85\u65f6\uff0c\u672a\u5b8c\u6210\u8bfb\u53d6")
	}
	return fmt.Errorf("\u6d4f\u89c8\u5668\u8fde\u63a5\u8d85\u65f6\uff0c\u672a\u5b8c\u6210\u8bfb\u53d6\uff1a%w", err)
}

func (a *App) ReadAllShops() appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	shops := a.cachedShops()
	if len(shops) == 0 {
		listResult := a.ListShops()
		if !listResult.OK {
			return listResult
		}
		shops, _ = listResult.Data.([]appcore.Shop)
	}
	if err := ctx.Err(); err != nil {
		a.core.Log("messages.read_all.cancelled", map[string]any{"stage": "list_shops"})
		return appcore.OK(cancelledReadPayload(shops, 0, len(shops)))
	}
	var all []appcore.Conversation
	var errors []string
	var warnings []string
	var providerErrors []string
	opened := 0
	skipped := 0
	for index, shop := range shops {
		if err := a.waitIfPaused(ctx); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_all.cancelled", map[string]any{"stage": "pause_wait", "opened": opened})
			break
		}
		a.emitReadProgressPhase("all", "start", shop, appcore.InboxResult{}, nil, index+1, len(shops), opened)
		result, openResult, err := a.readShopInboxOnly(ctx, shop, true)
		if isContextDone(err) {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_all.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		if err != nil {
			skipped++
			errors = append(errors, fmt.Sprintf("%s：%s", shop.DisplayName, friendlyReadError(err)))
			a.core.Log("messages.read_all.shop_failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
			a.emitReadProgressPhase("all", "error", shop, appcore.InboxResult{
				Status:        "partial",
				Conversations: []appcore.Conversation{},
			}, err, index+1, len(shops), opened)
			continue
		}
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_all.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		opened++
		result = a.mergeOpenEmail(ctx, shop, openResult, result)
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_all.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		result.ProductCards = a.updateShopProductCache(ctx, shop, result)
		if err := ctx.Err(); err != nil {
			errors = append(errors, cancelledReadMessage())
			a.core.Log("messages.read_all.cancelled", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "opened": opened})
			break
		}
		result.Conversations = a.resolveConversationProductInterestCards(ctx, shop, annotateConversationsForShop(shop, result.Conversations))
		result.Conversations = a.withShopProductCards(shop, result.Conversations)
		warnings = append(warnings, prefixMessages(shop.DisplayName, result.Warnings)...)
		providerErrors = append(providerErrors, prefixMessages(shop.DisplayName, result.ProviderErrors)...)
		a.core.StoreConversations(shop, result.Conversations)
		a.emitReadProgressPhase("all", "done", shop, result, nil, index+1, len(shops), opened)
		all = append(all, result.Conversations...)
	}
	all = appcore.AnnotateDuplicates(all)
	a.core.Log("messages.read_all.done", map[string]any{"count": len(all), "opened": opened, "skipped": skipped, "errors": len(errors)})
	return appcore.OK(map[string]any{"conversations": all, "errors": errors, "warnings": warnings, "providerErrors": providerErrors, "shops": shops, "opened": opened, "skipped": skipped})
}

func (a *App) emitReadProgress(mode string, shop appcore.Shop, result appcore.InboxResult, err error) {
	a.emitReadProgressPhase(mode, "done", shop, result, err, 0, 0, 0)
}

func (a *App) emitReadProgressPhase(mode string, phase string, shop appcore.Shop, result appcore.InboxResult, err error, index int, total int, completed int) {
	if a.ctx == nil {
		return
	}
	payload := map[string]any{
		"phase":          phase,
		"mode":           mode,
		"shop":           shop,
		"conversations":  result.Conversations,
		"productCards":   result.ProductCards,
		"warnings":       result.Warnings,
		"providerErrors": result.ProviderErrors,
		"status":         result.Status,
		"count":          len(result.Conversations),
	}
	if index > 0 {
		payload["index"] = index
	}
	if total > 0 {
		payload["total"] = total
	}
	if completed > 0 {
		payload["completed"] = completed
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	wailsruntime.EventsEmit(a.ctx, "read:shop-progress", payload)
}

func (a *App) cachedShops() []appcore.Shop {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]appcore.Shop(nil), a.shops...)
}

func (a *App) findShopByMallID(mallID string) (appcore.Shop, bool) {
	mallID = strings.TrimSpace(mallID)
	for _, shop := range a.cachedShops() {
		if shop.MallID == mallID {
			return shop, true
		}
	}
	shops, err := adapters.ListShops(a.core.Settings(), a.core.Logger())
	if err != nil {
		return appcore.Shop{}, false
	}
	settings, shops := mailapi.SyncAdapterProxyBindings(a.core.Settings(), shops)
	if saveResult := a.core.SaveSettings(settings); !saveResult.OK {
		a.core.Log("mail.proxy_sync.save_failed", map[string]any{"error": saveResult.Error})
	}
	a.mu.Lock()
	a.shops = append([]appcore.Shop(nil), shops...)
	a.mu.Unlock()
	for _, shop := range shops {
		if shop.MallID == mallID {
			return shop, true
		}
	}
	return appcore.Shop{}, false
}

func (a *App) readShopMailViaAPI(ctx context.Context, shop appcore.Shop, queryOptions map[string]any) (appcore.InboxResult, error) {
	shop = mailapi.AnnotateShop(a.core.Settings(), shop)
	provider := mailapi.NewProviderForShop(a.core.Settings(), shop)
	options := map[string]any{}
	for key, value := range queryOptions {
		options[key] = value
	}
	options["cutoff"] = a.emailScanCutoff(shop, time.Now())
	options["ignored_fingerprints"] = a.core.EmailIgnoredFingerprints(shop)
	settings, result, err := provider.ReadMessages(ctx, a.core.Settings(), shop, options)
	saveResult := a.core.SaveSettings(settings)
	if !saveResult.OK {
		return result, errors.New(saveResult.Error)
	}
	if err != nil {
		a.core.Log("mail.api_read.failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
		return result, err
	}
	result.Conversations = a.resolveConversationProductInterestCards(ctx, shop, annotateConversationsForShop(shop, result.Conversations))
	result.Conversations = a.withShopProductCards(shop, result.Conversations)
	result.Conversations = appcore.AnnotateDuplicates(result.Conversations)
	a.core.StoreConversations(shop, result.Conversations)
	if added := a.core.MergeEmailIgnoredFingerprints(shop, result.IgnoredEmailFingerprints); added > 0 {
		a.core.Log("email.ignored.persisted", map[string]any{"shop": shop.DisplayName, "added": added, "ignored_count": result.IgnoredEmailCount, "source": mailapi.MailProviderForShop(a.core.Settings(), shop) + "_api"})
	}
	a.saveEmailScanSuccess(shop, result)
	a.core.Log("mail.api_read.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "count": len(result.Conversations)})
	return result, nil
}

func batchMailAPIOptions() map[string]any {
	return map[string]any{"top": 25, "max": 100}
}

func (a *App) readShopInboxViaWebForBatch(ctx context.Context, shop appcore.Shop, openIfNeeded bool) (appcore.InboxResult, error) {
	result, openResult, err := a.readShopInboxOnly(ctx, shop, openIfNeeded)
	if isContextDone(err) {
		return appcore.InboxResult{}, err
	}
	if err != nil {
		return appcore.InboxResult{}, err
	}
	result.ProductCards = a.updateShopProductCache(ctx, shop, result)
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, err
	}
	result.Conversations = a.resolveConversationProductInterestCards(ctx, shop, annotateConversationsForShop(shop, result.Conversations))
	result.Conversations = a.withShopProductCards(shop, result.Conversations)
	a.core.StoreConversations(shop, result.Conversations)
	_ = openResult
	return result, nil
}

func combineInboxAndMailResults(inboxResult appcore.InboxResult, mailResult appcore.InboxResult) appcore.InboxResult {
	result := inboxResult
	if strings.TrimSpace(result.StoreSlug) == "" {
		result.StoreSlug = mailResult.StoreSlug
	}
	if strings.TrimSpace(result.Title) == "" {
		result.Title = mailResult.Title
	}
	mergeInboxMeta(&result, mailResult)
	result.Conversations = append(result.Conversations, mailResult.Conversations...)
	return result
}

func (a *App) readShopMailViaWebForBatch(ctx context.Context, shop appcore.Shop, openIfNeeded bool) (appcore.InboxResult, error) {
	result, openResult, err := a.readShopInboxOnly(ctx, shop, openIfNeeded)
	if isContextDone(err) {
		return appcore.InboxResult{}, err
	}
	inboxErr := err
	if err != nil {
		if strings.TrimSpace(openResult.WebDriverURL) == "" {
			return appcore.InboxResult{}, err
		}
		a.core.Log("mail.default.web_inbox_failed_email_continues", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
		result = appcore.InboxResult{
			StoreSlug:     appcore.ShopKey(shop),
			Title:         shop.DisplayName,
			Status:        "partial",
			Warnings:      []string{"Shopify Inbox read failed; email scan continued: " + err.Error()},
			Conversations: []appcore.Conversation{},
		}
	}
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, err
	}
	result = a.mergeOpenEmail(ctx, shop, openResult, result)
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, err
	}
	if inboxErr != nil && len(result.Conversations) == 0 {
		result.ProviderErrors = appendUniqueStrings(result.ProviderErrors, "Inbox/email: "+inboxErr.Error())
		result.Status = mergeInboxStatus(result.Status, "partial")
	}
	result.ProductCards = a.updateShopProductCache(ctx, shop, result)
	if err := ctx.Err(); err != nil {
		return appcore.InboxResult{}, err
	}
	result.Conversations = a.resolveConversationProductInterestCards(ctx, shop, annotateConversationsForShop(shop, result.Conversations))
	result.Conversations = a.withShopProductCards(shop, result.Conversations)
	a.core.StoreConversations(shop, result.Conversations)
	return result, nil
}

func (a *App) readShopsMailDefault(mode string, openOnly bool) appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	shops := a.cachedShops()
	if len(shops) == 0 {
		listResult := a.ListShops()
		if !listResult.OK {
			return listResult
		}
		shops, _ = listResult.Data.([]appcore.Shop)
	}
	shops = mailapi.AnnotateShops(a.core.Settings(), shops)
	totalCandidates := len(shops)
	initialSkipped := 0
	if openOnly {
		shops = adapters.AnnotateOpenStatuses(a.core.Settings(), shops, a.core.Logger())
		filtered := make([]appcore.Shop, 0, len(shops))
		for _, shop := range shops {
			if isOpenShopStatus(shop) {
				filtered = append(filtered, shop)
			}
		}
		initialSkipped = len(shops) - len(filtered)
		shops = filtered
	}
	if len(shops) == 0 {
		return appcore.OK(map[string]any{
			"conversations": []appcore.Conversation{},
			"errors":        []string{"No open shop environment detected; read current shop only handles already-open environments."},
			"shops":         shops,
			"opened":        0,
			"skipped":       totalCandidates,
		})
	}
	var all []appcore.Conversation
	var errors []string
	var warnings []string
	var providerErrors []string
	opened := 0
	skipped := initialSkipped
	for index, shop := range shops {
		if err := a.waitIfPaused(ctx); err != nil {
			errors = append(errors, cancelledReadMessage())
			break
		}
		a.emitReadProgressPhase(mode, "start", shop, appcore.InboxResult{}, nil, index+1, len(shops), opened)
		channel := "邮箱 API"
		var result appcore.InboxResult
		var err error
		var webInboxErr error
		if shop.APIDisabled {
			channel = "网页邮箱"
			result, err = a.readShopMailViaWebForBatch(ctx, shop, !openOnly)
		} else {
			channel = "网页 Inbox / 邮箱 API"
			inboxResult, inboxErr := a.readShopInboxViaWebForBatch(ctx, shop, !openOnly)
			webInboxErr = inboxErr
			mailResult, mailErr := a.readShopMailViaAPI(ctx, shop, batchMailAPIOptions())
			if isContextDone(inboxErr) {
				err = inboxErr
			} else if isContextDone(mailErr) {
				err = mailErr
			} else if inboxErr != nil && mailErr != nil {
				if isMissingShopifyInboxPageError(inboxErr) {
					err = mailErr
				} else {
					err = fmt.Errorf("Shopify Inbox：%s；Outlook API：%s", friendlyReadError(inboxErr), friendlyReadError(mailErr))
				}
			} else if inboxErr != nil {
				result = mailResult
				result.Warnings = appendUniqueStrings(result.Warnings, "Shopify Inbox 网页读取失败："+friendlyReadError(inboxErr))
				result.Status = mergeInboxStatus(result.Status, "partial")
			} else if mailErr != nil {
				result = inboxResult
				result.ProviderErrors = appendUniqueStrings(result.ProviderErrors, "Outlook API："+friendlyReadError(mailErr))
				result.Status = mergeInboxStatus(result.Status, "partial")
			} else {
				result = combineInboxAndMailResults(inboxResult, mailResult)
			}
			if err == nil && webInboxErr != nil && browserread.IsCDPConnectFailure(webInboxErr) && len(result.Conversations) == 0 {
				err = cdpReadIncompleteError(webInboxErr)
				a.core.Log("mail.default.inbox_incomplete", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": webInboxErr.Error()})
			}
			if err == nil {
				result.Conversations = appcore.AnnotateDuplicates(result.Conversations)
				a.core.StoreConversations(shop, result.Conversations)
			}
		}
		if isContextDone(err) {
			errors = append(errors, cancelledReadMessage())
			break
		}
		if err != nil {
			skipped++
			errors = append(errors, fmt.Sprintf("%s %s：%s", shop.DisplayName, channel, friendlyReadError(err)))
			a.emitReadProgressPhase(mode, "error", shop, appcore.InboxResult{Status: "partial", Conversations: []appcore.Conversation{}}, err, index+1, len(shops), opened)
			continue
		}
		opened++
		warnings = append(warnings, prefixMessages(shop.DisplayName, result.Warnings)...)
		providerErrors = append(providerErrors, prefixMessages(shop.DisplayName, result.ProviderErrors)...)
		a.emitReadProgressPhase(mode, "done", shop, result, nil, index+1, len(shops), opened)
		all = append(all, result.Conversations...)
	}
	all = appcore.AnnotateDuplicates(all)
	a.core.Log("mail.default_read.done", map[string]any{"mode": mode, "count": len(all), "shops": len(shops), "opened": opened, "skipped": skipped, "errors": len(errors)})
	return appcore.OK(map[string]any{"conversations": all, "errors": errors, "warnings": warnings, "providerErrors": providerErrors, "shops": mailapi.AnnotateShops(a.core.Settings(), shops), "opened": opened, "skipped": skipped})
}

func (a *App) readShopsMailViaAPI(mode string, openOnly bool) appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	taskID := a.setReadCancel(cancel)
	defer func() {
		cancel()
		a.clearReadCancel(taskID)
	}()
	shops := a.cachedShops()
	if len(shops) == 0 {
		listResult := a.ListShops()
		if !listResult.OK {
			return listResult
		}
		shops, _ = listResult.Data.([]appcore.Shop)
	}
	if openOnly {
		shops = adapters.AnnotateOpenStatuses(a.core.Settings(), shops, a.core.Logger())
		filtered := make([]appcore.Shop, 0, len(shops))
		for _, shop := range shops {
			if isOpenShopStatus(shop) {
				filtered = append(filtered, shop)
			}
		}
		shops = filtered
	}
	var all []appcore.Conversation
	var errors []string
	var warnings []string
	var providerErrors []string
	for index, shop := range shops {
		if err := a.waitIfPaused(ctx); err != nil {
			errors = append(errors, cancelledReadMessage())
			break
		}
		a.emitReadProgressPhase(mode, "start", shop, appcore.InboxResult{}, nil, index+1, len(shops), index)
		result, err := a.readShopMailViaAPI(ctx, shop, batchMailAPIOptions())
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s 邮箱 API：%s", shop.DisplayName, friendlyReadError(err)))
			a.emitReadProgressPhase(mode, "error", shop, appcore.InboxResult{Status: "partial", Conversations: []appcore.Conversation{}}, err, index+1, len(shops), index)
			continue
		}
		warnings = append(warnings, prefixMessages(shop.DisplayName, result.Warnings)...)
		providerErrors = append(providerErrors, prefixMessages(shop.DisplayName, result.ProviderErrors)...)
		a.emitReadProgressPhase(mode, "done", shop, result, nil, index+1, len(shops), index+1)
		all = append(all, result.Conversations...)
	}
	all = appcore.AnnotateDuplicates(all)
	a.core.Log("mail.api_read_batch.done", map[string]any{"mode": mode, "count": len(all), "shops": len(shops), "errors": len(errors)})
	return appcore.OK(map[string]any{"conversations": all, "errors": errors, "warnings": warnings, "providerErrors": providerErrors, "shops": mailapi.AnnotateShops(a.core.Settings(), shops), "opened": len(shops), "skipped": 0})
}

func (a *App) mergeOpenEmail(ctx context.Context, shop appcore.Shop, openResult appcore.OpenResult, result appcore.InboxResult) appcore.InboxResult {
	shop = mailapi.AnnotateShop(a.core.Settings(), shop)
	cutoff := a.emailScanCutoff(shop, time.Now())
	var emailResult appcore.InboxResult
	var err error
	recoveredConnection := false
	for {
		if pauseErr := a.waitIfPaused(ctx); pauseErr != nil {
			return result
		}
		emailResult, err = email.ProbeWithContext(ctx, openResult, shop.MailAccount, shop.MailAccountSource == "manual", a.core.EmailIgnoredFingerprints(shop), cutoff, !a.isBackgroundMode(), a.core.Logger())
		if err != nil && browserread.IsInterrupted(err) && a.isReadPaused() {
			a.core.Log("email.probe.paused", map[string]any{"shop": shop.DisplayName})
			continue
		}
		if shouldRecoverCDPConnection(err, recoveredConnection) {
			a.core.Log("email.probe.cdp_recovery.start", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": err.Error()})
			recovered, recoverErr := adapters.RecoverOpenShopConnection(a.core.Settings(), shop, a.core.Logger())
			if recoverErr == nil {
				recoveredConnection = true
				openResult = recovered
				a.core.SetOpenResult(openResult)
				a.core.Log("email.probe.cdp_recovery.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": openResult.WebDriverURL})
				continue
			}
			a.core.Log("email.probe.cdp_recovery.failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "error": recoverErr.Error()})
		}
		break
	}
	if err != nil {
		a.core.Log("email.probe.skipped", map[string]any{"shop": shop.DisplayName, "error": err.Error(), "cutoff": cutoff})
		result.ProviderErrors = appendUniqueStrings(result.ProviderErrors, "email probe skipped: "+err.Error())
		result.Status = mergeInboxStatus(result.Status, "partial")
		return result
	}
	a.saveEmailScanSuccess(shop, emailResult)
	if added := a.core.MergeEmailIgnoredFingerprints(shop, emailResult.IgnoredEmailFingerprints); added > 0 {
		a.core.Log("email.ignored.persisted", map[string]any{"shop": shop.DisplayName, "added": added, "ignored_count": emailResult.IgnoredEmailCount})
	}
	mergeInboxMeta(&result, emailResult)
	if len(emailResult.Conversations) == 0 {
		a.core.Log("email.probe.empty", map[string]any{"shop": shop.DisplayName, "status": emailResult.Status, "warnings": len(emailResult.Warnings), "provider_errors": len(emailResult.ProviderErrors), "cutoff": cutoff})
		return result
	}
	result.Conversations = append(result.Conversations, emailResult.Conversations...)
	a.core.Log("email.probe.merged", map[string]any{"shop": shop.DisplayName, "count": len(emailResult.Conversations), "status": result.Status, "warnings": len(result.Warnings), "provider_errors": len(result.ProviderErrors), "cutoff": cutoff})
	return result
}

func (a *App) emailScanCutoff(shop appcore.Shop, now time.Time) string {
	return emailScanCutoffFromState(a.core.EmailScanState(shop), now)
}

func emailScanCutoffFromState(state appcore.EmailScanState, now time.Time) string {
	windowStart := now.AddDate(0, 0, -7)
	return windowStart.UTC().Format(time.RFC3339)
}

func (a *App) saveEmailScanSuccess(shop appcore.Shop, result appcore.InboxResult) {
	now := time.Now().UTC()
	provider := ""
	for _, conversation := range result.Conversations {
		if strings.TrimSpace(conversation.Source) != "" {
			provider = conversation.Source
			break
		}
	}
	a.core.SaveEmailScanState(shop, appcore.EmailScanState{
		LastSuccessfulEmailScanAt: now.Format(time.RFC3339),
		Provider:                  provider,
		Mailbox:                   shop.DisplayName,
		LastStatus:                result.Status,
		LastCount:                 len(result.Conversations),
		LastIgnored:               result.IgnoredEmailCount,
		UpdatedAt:                 now.Format(time.RFC3339),
	})
	a.core.Log("email.scan_state.saved", map[string]any{"shop": shop.DisplayName, "count": len(result.Conversations), "ignored": result.IgnoredEmailCount, "status": result.Status})
}

func (a *App) isBackgroundMode() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.backgroundMode
}

func (a *App) ProbeEmail() appcore.ActionResult {
	a.readMu.Lock()
	defer a.readMu.Unlock()
	openResult := a.core.OpenResult()
	ignored := []string{}
	cutoff := ""
	if a.currentShop.MallID != "" {
		ignored = a.core.EmailIgnoredFingerprints(a.currentShop)
		cutoff = a.emailScanCutoff(a.currentShop, time.Now())
	}
	result, err := email.Probe(openResult, ignored, cutoff, !a.isBackgroundMode(), a.core.Logger())
	if err != nil {
		a.core.Log("email.probe.failed", map[string]any{"error": err.Error()})
		return appcore.Fail(err.Error())
	}
	if a.currentShop.MallID != "" {
		a.saveEmailScanSuccess(a.currentShop, result)
		if added := a.core.MergeEmailIgnoredFingerprints(a.currentShop, result.IgnoredEmailFingerprints); added > 0 {
			a.core.Log("email.ignored.persisted", map[string]any{"shop": a.currentShop.DisplayName, "added": added, "ignored_count": result.IgnoredEmailCount})
		}
		result.Conversations = annotateConversationsForShop(a.currentShop, result.Conversations)
		cached := a.core.ConversationCache(a.currentShop)
		merged := append(cached, result.Conversations...)
		a.core.StoreConversations(a.currentShop, merged)
		result.Conversations = merged
	}
	a.core.Log("email.probe.ok", map[string]any{"count": len(result.Conversations)})
	return appcore.OK(result)
}

func (a *App) StartRealtimeObserve(shop appcore.Shop) appcore.ActionResult {
	a.StopRealtimeObserve()
	ctx, cancel := context.WithCancel(context.Background())
	a.realtimeCancel = cancel
	go func() {
		ticker := time.NewTicker(45 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !a.readMu.TryLock() {
					a.core.Log("realtime.skipped_busy", map[string]any{"shop": shop.DisplayName})
					continue
				}
				select {
				case <-ctx.Done():
					a.readMu.Unlock()
					return
				default:
				}
				_ = a.readShopInboxLocked(shop)
				a.readMu.Unlock()
			}
		}
	}()
	a.core.Log("realtime.started", map[string]any{"shop": shop.DisplayName})
	return appcore.OK(true)
}

func (a *App) StopRealtimeObserve() appcore.ActionResult {
	a.mu.Lock()
	cancel := a.realtimeCancel
	a.realtimeCancel = nil
	a.mu.Unlock()
	if cancel != nil {
		cancel()
		a.core.Log("realtime.stopped", nil)
	}
	return appcore.OK(true)
}

func (a *App) PauseRead() appcore.ActionResult {
	a.mu.Lock()
	a.paused = true
	a.mu.Unlock()
	killed := browserread.KillActiveSidecars("paused")
	a.core.Log("task.paused", map[string]any{"killed_sidecars": killed})
	return appcore.OK(true)
}

func (a *App) ResumeRead() appcore.ActionResult {
	a.mu.Lock()
	a.paused = false
	a.mu.Unlock()
	a.core.Log("task.resumed", nil)
	return appcore.OK(true)
}

func (a *App) CancelRead() appcore.ActionResult {
	a.mu.Lock()
	cancel := a.cancel
	a.cancel = nil
	a.paused = false
	a.readTaskID++
	a.mu.Unlock()
	killed := browserread.KillActiveSidecars("cancelled")
	a.core.Log("task.sidecars_killed", map[string]any{"count": killed})
	if cancel != nil {
		cancel()
		a.core.Log("task.cancelled", nil)
	}
	return appcore.OK(true)
}

func (a *App) MarkHandled(conversationID string) appcore.ActionResult {
	if conversationID == "" {
		return appcore.Fail("conversation id is required")
	}
	changed := a.core.MarkHandled(conversationID)
	return appcore.OK(changed)
}

func (a *App) MarkConversationHandled(conversation appcore.Conversation) appcore.ActionResult {
	if conversation.ID == "" && conversation.ConversationID == "" {
		return appcore.Fail("conversation id is required")
	}
	conversation = a.prepareRecordConversation(conversation)
	conversation.Status = "handled"
	conversation.SendStatus = "handled"
	changed := a.core.UpdateConversation(conversation)
	record, err := a.recordStore().Upsert(conversation, "handled", time.Now())
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.Log("record.handled.upserted", map[string]any{"key": record.Key, "shop": record.ShopName, "order": record.OrderNumber})
	return appcore.OK(map[string]any{"updated": changed, "record": record})
}

func (a *App) GenerateAIReply(conversation appcore.Conversation) appcore.ActionResult {
	updated, err := a.aiClient().GenerateReply(conversation)
	if err != nil {
		a.core.Log("ai.reply.failed", map[string]any{"error": err.Error()})
		return appcore.Fail(err.Error())
	}
	a.core.UpdateConversation(updated)
	return appcore.OK(updated)
}

func (a *App) TranslateCustomerContext(conversation appcore.Conversation) appcore.ActionResult {
	updated, err := a.aiClient().TranslateCustomerContext(conversation)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.UpdateConversation(updated)
	return appcore.OK(updated)
}

func (a *App) TranslateReplyBoxText(text string, conversation appcore.Conversation, target string) appcore.ActionResult {
	result, err := a.aiClient().TranslateReplyBoxText(text, conversation, target)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) TestAISettings() appcore.ActionResult {
	result, err := a.aiClient().Test()
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) SendReply(conversation appcore.Conversation, text string) appcore.ActionResult {
	shop, ok := a.findShopForConversation(conversation)
	if !ok {
		return appcore.Fail("无法确定该会话所属店铺，已阻止发送")
	}
	shop = mailapi.AnnotateShop(a.core.Settings(), shop)
	if shouldSendMailViaAPI(conversation, shop) {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		provider := mailapi.OutlookGraphProvider{}
		settings, result, err := provider.SendReply(ctx, a.core.Settings(), shop, conversation, text)
		saveResult := a.core.SaveSettings(settings)
		if !saveResult.OK {
			return saveResult
		}
		if err != nil {
			message := cleanErrorMessage(err, result.Message)
			a.core.Log("reply.send.failed", map[string]any{"stage": "mail_api", "source": conversation.Source, "customer": conversation.CustomerName, "topic": conversation.Topic, "sourceUrl": conversation.SourceURL, "error": message, "code": result.Error})
			return appcore.Fail(message)
		}
		return a.finishSentReply(conversation, result)
	}
	if shouldBlockUnsupportedMailAPI(conversation, shop) {
		return appcore.Fail("该邮箱暂未接入 API 发送；如需继续使用旧网页邮箱发送，请先在邮箱 API 页打开该店铺的“禁止API”")
	}
	manualEmailAccount := ""
	if shop.MailAccountSource == "manual" && isEmailConversationSource(conversation.Source) && strings.TrimSpace(shop.MailAccount) != "" {
		manualEmailAccount = strings.ToLower(strings.TrimSpace(shop.MailAccount))
		conversation.EmailAccount = manualEmailAccount
	}
	openResult, err := a.openResultForConversation(conversation)
	if err != nil {
		message := cleanErrorMessage(err, "send failed: cannot locate current shop browser")
		a.core.Log("reply.send.failed", map[string]any{"stage": "open_result", "source": conversation.Source, "customer": conversation.CustomerName, "error": message})
		return appcore.Fail(message)
	}
	result, err := sender.SendWithOptions(openResult, conversation, text, sender.SendOptions{
		ActivateTarget:     true,
		ManualEmailAccount: manualEmailAccount,
	}, a.core.Logger())
	if err != nil {
		message := cleanErrorMessage(err, result.Message)
		a.core.Log("reply.send.failed", map[string]any{"stage": "send", "source": conversation.Source, "customer": conversation.CustomerName, "topic": conversation.Topic, "sourceUrl": conversation.SourceURL, "error": message, "code": result.Error})
		return appcore.Fail(message)
	}
	return a.finishSentReply(conversation, result)
}

func (a *App) finishSentReply(conversation appcore.Conversation, result appcore.SendResult) appcore.ActionResult {
	conversation = a.prepareRecordConversation(conversation)
	conversation.Status = "sent"
	conversation.SendStatus = "sent"
	conversation.AIUsed = true
	a.core.UpdateConversation(conversation)
	record, err := a.recordStore().Upsert(conversation, "sent", time.Now())
	if err != nil {
		message := cleanErrorMessage(err, "reply sent, but writing handled record failed")
		a.core.Log("reply.send.failed", map[string]any{"stage": "record", "source": conversation.Source, "customer": conversation.CustomerName, "error": message})
		return appcore.Fail(message)
	}
	a.core.Log("record.sent.upserted", map[string]any{"key": record.Key, "shop": record.ShopName, "order": record.OrderNumber})
	return appcore.OK(result)
}

func shouldSendMailViaAPI(conversation appcore.Conversation, shop appcore.Shop) bool {
	return false
}

func shouldBlockUnsupportedMailAPI(conversation appcore.Conversation, shop appcore.Shop) bool {
	return false
}

func isEmailConversationSource(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "outlook", "gmail", "fastmo", "cuiqiu", "email":
		return true
	default:
		return false
	}
}

func (a *App) OpenSourcePage(conversation appcore.Conversation) appcore.ActionResult {
	openResult, err := a.openResultForConversation(conversation)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if err := sourcepage.OpenSource(openResult, conversation); err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(true)
}

func (a *App) BringSourcePageToFront(conversation appcore.Conversation) appcore.ActionResult {
	openResult, err := a.openResultForConversation(conversation)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if err := sourcepage.BringToFront(openResult, conversation); err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(true)
}

func (a *App) OpenConversationLink(conversation appcore.Conversation, url string) appcore.ActionResult {
	openResult, err := a.openResultForConversation(conversation)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	if err := sourcepage.OpenConversationLink(openResult, conversation, url); err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(true)
}

func (a *App) openResultForConversation(conversation appcore.Conversation) (appcore.OpenResult, error) {
	shop, ok := a.findShopForConversation(conversation)
	if !ok {
		return appcore.OpenResult{}, fmt.Errorf("cannot determine the shop environment for this conversation; page operation blocked")
	}
	openResult, err := adapters.AttachOpenShop(a.core.Settings(), shop, a.core.Logger())
	if err != nil {
		return appcore.OpenResult{}, fmt.Errorf("cannot connect to the shop environment for this conversation; page operation blocked: %w", err)
	}
	if err := sourcepage.ValidateOpenResultForConversation(openResult, conversation); err != nil {
		return appcore.OpenResult{}, err
	}
	a.core.SetOpenResult(openResult)
	a.currentShop = shop
	return openResult, nil
}

func (a *App) findShopForConversation(conversation appcore.Conversation) (appcore.Shop, bool) {
	shops := a.cachedShops()
	if len(shops) == 0 {
		if result := a.ListShops(); result.OK {
			if listed, ok := result.Data.([]appcore.Shop); ok {
				shops = listed
			}
		}
	}
	targetKey := strings.ToLower(strings.TrimSpace(conversation.ShopKey))
	targetMallID := strings.ToLower(strings.TrimSpace(conversation.MallID))
	targetName := strings.ToLower(strings.TrimSpace(conversation.ShopName))
	for _, shop := range shops {
		if targetKey != "" && strings.EqualFold(appcore.ShopKey(shop), targetKey) {
			return shop, true
		}
		if targetMallID != "" && strings.EqualFold(shop.MallID, targetMallID) {
			if targetName == "" || strings.EqualFold(shop.DisplayName, targetName) {
				return shop, true
			}
		}
	}
	for _, shop := range shops {
		if targetName != "" && strings.EqualFold(shop.DisplayName, targetName) {
			return shop, true
		}
	}
	return appcore.Shop{}, false
}

func (a *App) ListRecordCategories() appcore.ActionResult {
	categories, err := a.recordStore().Categories()
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(categories)
}

func (a *App) SaveRecordCategories(categories []records.CategoryOption) appcore.ActionResult {
	saved, err := a.recordStore().SaveCategories(categories)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.Log("record.categories.saved", map[string]any{"groups": len(saved)})
	return appcore.OK(saved)
}

func (a *App) ClassifyConversationRecord(conversation appcore.Conversation) appcore.ActionResult {
	store := a.recordStore()
	categories, err := store.Categories()
	if err != nil {
		return appcore.Fail(err.Error())
	}
	draft, err := a.aiClient().ClassifyRecord(conversation, categories)
	if err != nil {
		draft = store.Classify(conversation)
	}
	updated, err := store.UpdateDraft(conversation, draft)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.UpdateConversation(updated)
	return appcore.OK(map[string]any{"conversation": updated, "draft": draft})
}

func (a *App) UpdateConversationRecordDraft(conversation appcore.Conversation, draft records.ClassificationDraft) appcore.ActionResult {
	updated, err := a.recordStore().UpdateDraft(conversation, draft)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.UpdateConversation(updated)
	return appcore.OK(updated)
}

func (a *App) ExportHandledRecords(startDate string, endDate string, destination string) appcore.ActionResult {
	result, err := a.recordStore().Export(startDate, endDate, destination)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	a.core.Log("record.exported", map[string]any{"path": result.Path, "row_count": result.RowCount, "start": result.StartDate, "end": result.EndDate})
	return appcore.OK(result)
}

func (a *App) ListKnowledge(includeDisabled bool) appcore.ActionResult {
	entries, err := a.knowledgeStore().List(includeDisabled)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(entries)
}

func (a *App) AddKnowledgeFromConversation(conversation appcore.Conversation, replyText string, problemSummary string, notes string) appcore.ActionResult {
	entry, err := a.knowledgeStore().Add(conversation, replyText, a.currentShop, problemSummary, notes)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(entry)
}

func (a *App) DisableKnowledge(id string) appcore.ActionResult {
	changed, err := a.knowledgeStore().Disable(id)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(changed)
}

func (a *App) DeleteKnowledge(id string) appcore.ActionResult {
	changed, err := a.knowledgeStore().Delete(id)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(changed)
}

func (a *App) ImportKnowledge(path string) appcore.ActionResult {
	result, err := a.knowledgeStore().Import(path)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) ExportKnowledge(path string) appcore.ActionResult {
	result, err := a.knowledgeStore().Export(path)
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) SummarizeKnowledge() appcore.ActionResult {
	result, err := a.aiClient().SummarizeKnowledge("manual")
	if err != nil {
		return appcore.Fail(err.Error())
	}
	return appcore.OK(result)
}

func (a *App) knowledgeStore() knowledge.Store {
	return knowledge.NewStore(a.core.DataDir(), a.core.Logger())
}

func (a *App) recordStore() records.Store {
	return records.NewStore(a.core.DataDir())
}

func (a *App) aiClient() ai.Client {
	settings := a.core.Settings()
	merged := map[string]any{}
	for key, value := range settings.AI {
		merged[key] = value
	}
	merged["knowledge_enabled"] = mapBool(settings.Knowledge, "enabled", true)
	merged["case_limit"] = mapInt(settings.Knowledge, "case_limit", 2)
	merged["digest_char_limit"] = mapInt(settings.Knowledge, "digest_char_limit", 1200)
	merged["forbidden_terms"] = settings.Knowledge["forbidden_terms"]
	return ai.NewClient(merged, a.knowledgeStore(), a.core.Logger())
}

func (a *App) prepareRecordConversation(conversation appcore.Conversation) appcore.Conversation {
	if shop, ok := a.findShopForConversation(conversation); ok {
		if strings.TrimSpace(conversation.ShopKey) == "" {
			conversation.ShopKey = appcore.ShopKey(shop)
		}
		if strings.TrimSpace(conversation.ShopName) == "" {
			conversation.ShopName = shop.DisplayName
		}
		if strings.TrimSpace(conversation.MallID) == "" {
			conversation.MallID = shop.MallID
		}
	}
	if strings.TrimSpace(conversation.ShopName) == "" && strings.TrimSpace(a.currentShop.DisplayName) != "" {
		conversation.ShopName = a.currentShop.DisplayName
	}
	if strings.TrimSpace(conversation.ShopKey) == "" && strings.TrimSpace(a.currentShop.DisplayName) != "" {
		conversation.ShopKey = appcore.ShopKey(a.currentShop)
	}
	if strings.TrimSpace(conversation.MallID) == "" {
		conversation.MallID = a.currentShop.MallID
	}
	return conversation
}

func compactDate(value string) string {
	value = strings.TrimSpace(value)
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed.Format("20060102")
	}
	return time.Now().Format("20060102")
}

func (a *App) maybeRunKnowledgeDigest(trigger string) {
	if a == nil || a.core == nil {
		return
	}
	settings := a.core.Settings()
	knowledgeSettings := settings.Knowledge
	if !mapBool(knowledgeSettings, "enabled", true) || !mapBool(knowledgeSettings, "auto_digest", true) {
		a.core.Log("knowledge.digest.skipped", map[string]any{"reason": "disabled", "trigger": trigger})
		return
	}
	if !mapBool(settings.AI, "enabled", false) {
		a.core.Log("knowledge.digest.skipped", map[string]any{"reason": "ai_disabled", "trigger": trigger})
		return
	}
	store := a.knowledgeStore()
	entries, err := store.List(false)
	if err != nil || len(entries) == 0 {
		a.core.Log("knowledge.digest.skipped", map[string]any{"reason": "no_entries", "trigger": trigger})
		return
	}
	meta := store.DigestMeta()
	reason := knowledgeDigestReason(meta, len(entries), mapInt(knowledgeSettings, "digest_interval_days", 7), mapInt(knowledgeSettings, "digest_min_new_entries", 20))
	if reason == "" {
		a.core.Log("knowledge.digest.skipped", map[string]any{"reason": "not_due", "trigger": trigger})
		return
	}
	if _, err := a.aiClient().SummarizeKnowledge("auto:" + trigger + ":" + reason); err != nil {
		a.core.Log("knowledge.digest.failed", map[string]any{"error": err.Error(), "reason": reason, "trigger": trigger})
		return
	}
	a.core.Log("knowledge.digest.ok", map[string]any{"reason": reason, "trigger": trigger})
}

func knowledgeDigestReason(meta map[string]any, currentCount int, intervalDays int, minNewEntries int) string {
	if strings.TrimSpace(fmt.Sprint(meta["summary"])) == "" {
		return "missing_digest"
	}
	previousCount := mapInt(meta, "entry_count", 0)
	if currentCount-previousCount >= maxInt(1, minNewEntries) {
		return "new_entries"
	}
	updatedAt := strings.TrimSpace(fmt.Sprint(meta["updated_at"]))
	updated, err := time.Parse(time.RFC3339, updatedAt)
	if err != nil {
		return "missing_updated_at"
	}
	if time.Since(updated) >= time.Duration(maxInt(1, intervalDays))*24*time.Hour {
		return "interval"
	}
	return ""
}

func mapBool(values map[string]any, key string, fallback bool) bool {
	value, ok := values[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	return fallback
}

func mapInt(values map[string]any, key string, fallback int) int {
	value, ok := values[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		out, err := typed.Int64()
		if err == nil {
			return int(out)
		}
	case string:
		var out int
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &out); err == nil {
			return out
		}
	}
	return fallback
}

func cleanErrorMessage(err error, fallback string) string {
	message := ""
	if err != nil {
		message = strings.TrimSpace(err.Error())
	}
	if message == "" || message == "<nil>" {
		message = strings.TrimSpace(fallback)
	}
	if message == "" || message == "<nil>" {
		return "操作失败，请查看日志"
	}
	return localizeRuntimeError(message)
}

func friendlyReadError(err error) string {
	if err == nil {
		return "读取失败"
	}
	if browserread.IsCDPConnectFailure(err) {
		return "\u6d4f\u89c8\u5668\u8fde\u63a5\u8d85\u65f6\uff0c\u672a\u5b8c\u6210\u8bfb\u53d6"
	}
	return localizeRuntimeError(err.Error())
}

func isMissingShopifyInboxPageError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "no shopify page found in existing browser") ||
		strings.Contains(lower, "current page is not a shopify store page")
}

func localizeRuntimeError(message string) string {
	message = strings.TrimSpace(strings.TrimPrefix(message, "Error:"))
	if message == "" || message == "<nil>" {
		return "读取失败"
	}
	replacements := []struct {
		old string
		new string
	}{
		{"playwright sidecar failed: Error:", "读取脚本执行失败："},
		{"playwright sidecar failed:", "读取脚本执行失败："},
		{"no Shopify page found in existing browser", "未找到已打开的 Shopify 店铺页面"},
		{"current page is not a shopify store page", "当前页面不是 Shopify 店铺页面"},
		{"no open shop environment detected; read current shop only handles already-open environments.", "没有检测到已打开的店铺环境；读取已打开只处理当前已打开的环境。"},
		{"outlook inbox navigation was not confirmed by UI", "未能确认 Outlook 已进入收件箱"},
		{"outlook unread view was not confirmed", "未能确认 Outlook 未读筛选视图"},
		{"node runtime not found for playwright sidecar", "未找到 Node 运行时，无法启动读取脚本"},
		{"playwright sidecar script not found", "未找到 Playwright 读取脚本"},
		{"missing DevTools address", "缺少浏览器 DevTools 地址"},
	}
	for _, item := range replacements {
		message = strings.ReplaceAll(message, item.old, item.new)
	}
	return strings.TrimSpace(message)
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func isContextDone(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || browserread.IsInterrupted(err)
}

func cancelledReadMessage() string {
	return "读取任务已停止"
}

func cancelledReadPayload(shops []appcore.Shop, opened int, skipped int) map[string]any {
	return map[string]any{
		"conversations":  []appcore.Conversation{},
		"errors":         []string{cancelledReadMessage()},
		"warnings":       []string{},
		"providerErrors": []string{},
		"shops":          shops,
		"opened":         opened,
		"skipped":        skipped,
	}
}

func (a *App) setReadCancel(cancel context.CancelFunc) uint64 {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	a.readTaskID++
	taskID := a.readTaskID
	a.cancel = cancel
	a.paused = false
	a.mu.Unlock()
	return taskID
}

func (a *App) clearReadCancel(taskID uint64) {
	a.mu.Lock()
	if a.readTaskID == taskID {
		a.cancel = nil
		a.paused = false
	}
	a.mu.Unlock()
}

func (a *App) isReadPaused() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.paused
}

func inboxLogMeta(shop string, result appcore.InboxResult) map[string]any {
	return map[string]any{
		"shop":            shop,
		"count":           len(result.Conversations),
		"status":          result.Status,
		"fallback_used":   result.FallbackUsed,
		"warnings":        len(result.Warnings),
		"provider_errors": len(result.ProviderErrors),
	}
}

func annotateConversationsForShop(shop appcore.Shop, conversations []appcore.Conversation) []appcore.Conversation {
	key := appcore.ShopKey(shop)
	out := make([]appcore.Conversation, len(conversations))
	for index, conversation := range conversations {
		conversation.ShopKey = key
		conversation.ShopName = shop.DisplayName
		conversation.MallID = shop.MallID
		out[index] = conversation
	}
	return out
}

func (a *App) updateShopProductCache(ctx context.Context, shop appcore.Shop, result appcore.InboxResult) []appcore.ProductCard {
	current := a.core.ShopProductCards(shop)
	if err := ctx.Err(); err != nil {
		return current
	}
	cards, err := a.fetchStorefrontProductCardsWithContext(ctx, shop)
	if err != nil {
		if ctx.Err() != nil {
			return current
		}
		a.core.Log("product.cache.fetch.failed", map[string]any{"shop": shop.DisplayName, "error": err.Error()})
		cards = collectProductCards(result.ProductCards, result.Conversations)
	}
	if err := ctx.Err(); err != nil {
		return current
	}
	return a.core.StoreShopProductCards(shop, mergeManualAndAutoProductCards(current, cards))
}

func (a *App) fetchStorefrontProductCards(shop appcore.Shop) ([]appcore.ProductCard, error) {
	return a.fetchStorefrontProductCardsWithContext(context.Background(), shop)
}

func (a *App) fetchStorefrontProductCardsWithContext(ctx context.Context, shop appcore.Shop) ([]appcore.ProductCard, error) {
	domain := storefrontDomainFromShop(shop)
	if domain == "" {
		return nil, fmt.Errorf("no storefront domain found")
	}
	details, fallback, _ := fetchStorefrontProductsJSON(ctx, domain)
	bestSelling, err := fetchBestSellingProductCards(ctx, domain, details)
	if len(bestSelling) > 0 {
		return collectProductCardsLimit(append(bestSelling, fallback...), nil, 5), nil
	}
	if len(fallback) > 0 {
		return collectProductCardsLimit(fallback, nil, 5), nil
	}
	if err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("no product links found from storefront")
}

func fetchBestSellingProductCards(ctx context.Context, domain string, details map[string]appcore.ProductCard) ([]appcore.ProductCard, error) {
	body, err := fetchStorefrontURL(ctx, fmt.Sprintf("https://%s/collections/all?sort_by=best-selling", domain), "text/html")
	if err != nil {
		return nil, err
	}
	return productCardsFromHandles(productHandlesFromHTML(string(body), domain), domain, details, 5), nil
}

func productCardsFromHandles(handles []string, domain string, details map[string]appcore.ProductCard, limit int) []appcore.ProductCard {
	if limit <= 0 {
		limit = 5
	}
	cards := make([]appcore.ProductCard, 0, limit)
	seen := map[string]bool{}
	for _, handle := range handles {
		handle = strings.TrimSpace(handle)
		if handle == "" {
			continue
		}
		if seen[handle] {
			continue
		}
		seen[handle] = true
		card := details[handle]
		if strings.TrimSpace(card.URL) == "" {
			card = appcore.ProductCard{
				Title: titleFromProductHandle(handle),
				URL:   fmt.Sprintf("https://%s/products/%s", domain, url.PathEscape(handle)),
			}
		}
		if !isRecommendableProductCard(card) {
			continue
		}
		cards = append(cards, card)
		if len(cards) >= limit {
			break
		}
	}
	return cards
}

type storefrontProductsPayload struct {
	Products []struct {
		Title  string `json:"title"`
		Handle string `json:"handle"`
		Image  struct {
			Src string `json:"src"`
		} `json:"image"`
		Images []struct {
			Src string `json:"src"`
		} `json:"images"`
	} `json:"products"`
}

func fetchStorefrontProductsJSON(ctx context.Context, domain string) (map[string]appcore.ProductCard, []appcore.ProductCard, error) {
	body, err := fetchStorefrontURL(ctx, fmt.Sprintf("https://%s/products.json?limit=250", domain), "application/json")
	if err != nil {
		return nil, nil, err
	}
	var payload storefrontProductsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, nil, err
	}
	byHandle := map[string]appcore.ProductCard{}
	fallback := make([]appcore.ProductCard, 0, 12)
	for _, product := range payload.Products {
		handle := strings.TrimSpace(product.Handle)
		title := strings.TrimSpace(product.Title)
		if handle == "" || title == "" {
			continue
		}
		imageURL := strings.TrimSpace(product.Image.Src)
		if imageURL == "" && len(product.Images) > 0 {
			imageURL = strings.TrimSpace(product.Images[0].Src)
		}
		card := appcore.ProductCard{
			Title:    title,
			URL:      fmt.Sprintf("https://%s/products/%s", domain, url.PathEscape(handle)),
			ImageURL: normalizeProductImageURL(imageURL),
		}
		if !isRecommendableProductCard(card) {
			continue
		}
		byHandle[handle] = card
		if len(fallback) < 12 {
			fallback = append(fallback, card)
		}
	}
	return byHandle, fallback, nil
}

type storefrontProductDetailPayload struct {
	Title         string   `json:"title"`
	Handle        string   `json:"handle"`
	FeaturedImage string   `json:"featured_image"`
	Image         string   `json:"image"`
	Images        []string `json:"images"`
}

func enrichProductCardFromStorefront(card appcore.ProductCard) appcore.ProductCard {
	parsed, err := url.Parse(card.URL)
	if err != nil || parsed.Host == "" {
		return card
	}
	handle := productHandleFromHref(parsed.String(), strings.TrimPrefix(strings.ToLower(parsed.Host), "www."))
	if handle == "" {
		return card
	}
	domain := strings.TrimPrefix(strings.ToLower(parsed.Host), "www.")
	body, err := fetchStorefrontURL(context.Background(), fmt.Sprintf("https://%s/products/%s.js", domain, url.PathEscape(handle)), "application/json")
	if err != nil {
		return card
	}
	var payload storefrontProductDetailPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return card
	}
	if title := strings.TrimSpace(payload.Title); title != "" {
		card.Title = title
	}
	imageURL := strings.TrimSpace(payload.FeaturedImage)
	if imageURL == "" {
		imageURL = strings.TrimSpace(payload.Image)
	}
	if imageURL == "" && len(payload.Images) > 0 {
		imageURL = strings.TrimSpace(payload.Images[0])
	}
	if imageURL != "" {
		card.ImageURL = normalizeProductImageURL(imageURL)
	}
	return card
}

func normalizeProductImageURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "data:") {
		return raw
	}
	if strings.HasPrefix(raw, "/") {
		return raw
	}
	return raw
}

func fetchStorefrontURL(ctx context.Context, rawURL string, accept string) ([]byte, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 XzdeskAgent/1.0")
	req.Header.Set("Accept", accept)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s returned HTTP %d", rawURL, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 2_000_000))
}

func productHandlesFromHTML(source string, domain string) []string {
	matches := regexp.MustCompile(`(?i)href\s*=\s*["']([^"']*/products/[^"'?#]+)`).FindAllStringSubmatch(source, -1)
	out := make([]string, 0, 5)
	seen := map[string]bool{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		href := html.UnescapeString(match[1])
		handle := productHandleFromHref(href, domain)
		if handle == "" || seen[handle] {
			continue
		}
		seen[handle] = true
		out = append(out, handle)
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func productHandleFromHref(href string, domain string) string {
	parsed, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if parsed.Host != "" {
		host := strings.TrimPrefix(strings.ToLower(parsed.Host), "www.")
		if host != strings.ToLower(domain) {
			return ""
		}
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for index, part := range parts {
		if strings.EqualFold(part, "products") && index+1 < len(parts) {
			handle, err := url.PathUnescape(parts[index+1])
			if err != nil {
				return parts[index+1]
			}
			return strings.TrimSpace(handle)
		}
	}
	return ""
}

func titleFromProductHandle(handle string) string {
	if decoded, err := url.PathUnescape(strings.TrimSpace(handle)); err == nil {
		handle = decoded
	}
	words := strings.Fields(strings.ReplaceAll(handle, "-", " "))
	for index, word := range words {
		runes := []rune(word)
		if len(runes) == 0 {
			continue
		}
		runes[0] = unicode.ToUpper(runes[0])
		words[index] = string(runes)
	}
	return strings.Join(words, " ")
}

func isRecommendableProductCard(card appcore.ProductCard) bool {
	handle := productHandleFromCardURL(card.URL)
	if handle == "" {
		return false
	}
	title := strings.ToLower(strings.TrimSpace(card.Title))
	handleWords := strings.ToLower(strings.NewReplacer("-", " ", "_", " ", "/", " ").Replace(handle))
	joined := strings.Join([]string{title, handleWords}, " ")
	compact := strings.NewReplacer("-", "", "_", "", " ", "", "/", "").Replace(joined)

	blockedPhrases := []string{
		"shipping insurance",
		"shipping protection",
		"package protection",
		"package insurance",
		"route protection",
		"order protection",
		"delivery protection",
		"delivery insurance",
		"warranty",
		"extended warranty",
		"gift card",
		"giftcard",
		"donation",
		"support animal rescue",
		"animal rescue",
		"rescue donation",
		"tip",
		"tips",
		"packaging",
		"packing",
		"shipping fee",
		"extra shipping",
		"custom fee",
	}
	for _, phrase := range blockedPhrases {
		normalized := strings.ToLower(phrase)
		if strings.Contains(joined, normalized) || strings.Contains(compact, strings.ReplaceAll(normalized, " ", "")) {
			return false
		}
	}

	blockedTokens := []string{
		"insurance",
		"warranty",
		"donation",
		"giftcard",
		"packaging",
		"packing",
	}
	for _, token := range blockedTokens {
		if strings.Contains(compact, token) {
			return false
		}
	}

	return true
}

func productHandleFromCardURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	if parsed.Host == "" {
		return ""
	}
	return productHandleFromHref(parsed.String(), strings.TrimPrefix(strings.ToLower(parsed.Host), "www."))
}

func storefrontDomainFromShop(shop appcore.Shop) string {
	source := strings.TrimSpace(shop.DisplayName)
	if source == "" {
		return ""
	}
	if match := regexp.MustCompile(`(?i)^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)-[^@\s]+@`).FindStringSubmatch(source); len(match) >= 2 {
		return strings.TrimPrefix(strings.ToLower(match[1]), "www.")
	}
	blocked := map[string]bool{
		"outlook.com":      true,
		"gmail.com":        true,
		"hotmail.com":      true,
		"icloud.com":       true,
		"yahoo.com":        true,
		"shopify.com":      true,
		"shopifyemail.com": true,
		"myshopify.com":    true,
	}
	matches := regexp.MustCompile(`(?i)\b(?:https?://)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b`).FindAllStringSubmatch(source, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		domain := strings.TrimPrefix(strings.ToLower(match[1]), "www.")
		if domain == "" || blocked[domain] || strings.HasSuffix(domain, ".myshopify.com") {
			continue
		}
		return domain
	}
	return ""
}

func (a *App) resolveConversationProductInterestCards(ctx context.Context, shop appcore.Shop, conversations []appcore.Conversation) []appcore.Conversation {
	if !conversationsHaveProductInterestTitles(conversations) {
		return conversations
	}
	catalog := collectProductCardsLimit(a.core.ShopProductCards(shop), nil, 250)
	if ctx.Err() == nil {
		if fetched, err := a.fetchStorefrontProductCatalogWithContext(ctx, shop); err == nil && len(fetched) > 0 {
			catalog = collectProductCardsLimit(append(catalog, fetched...), nil, 250)
		}
	}
	if len(catalog) == 0 {
		return conversations
	}
	return resolveProductInterestCards(conversations, catalog)
}

func conversationsHaveProductInterestTitles(conversations []appcore.Conversation) bool {
	for _, conversation := range conversations {
		for _, title := range conversation.ProductInterestTitles {
			if strings.TrimSpace(title) != "" {
				return true
			}
		}
	}
	return false
}

func (a *App) fetchStorefrontProductCatalogWithContext(ctx context.Context, shop appcore.Shop) ([]appcore.ProductCard, error) {
	domain := storefrontDomainFromShop(shop)
	if domain == "" {
		return nil, fmt.Errorf("no storefront domain found")
	}
	details, fallback, err := fetchStorefrontProductsJSON(ctx, domain)
	if err != nil {
		return nil, err
	}
	cards := make([]appcore.ProductCard, 0, len(details))
	if bestSelling, bestErr := fetchBestSellingProductCards(ctx, domain, details); bestErr == nil && len(bestSelling) > 0 {
		cards = append(cards, bestSelling...)
	}
	for _, card := range details {
		cards = append(cards, card)
	}
	cards = append(cards, fallback...)
	return collectProductCardsLimit(cards, nil, 250), nil
}

func resolveProductInterestCards(conversations []appcore.Conversation, catalog []appcore.ProductCard) []appcore.Conversation {
	catalog = collectProductCardsLimit(catalog, nil, 250)
	if len(conversations) == 0 || len(catalog) == 0 {
		return conversations
	}
	out := make([]appcore.Conversation, len(conversations))
	for index, conversation := range conversations {
		matched := make([]appcore.ProductCard, 0, len(conversation.ProductInterestTitles))
		for _, title := range conversation.ProductInterestTitles {
			if card, ok := matchProductInterestCard(title, catalog); ok {
				matched = append(matched, card)
			}
		}
		if len(matched) > 0 {
			conversation.ProductCards = collectProductCardsLimit(append(matched, conversation.ProductCards...), nil, 50)
		} else {
			conversation.ProductCards = collectProductCards(conversation.ProductCards, nil)
		}
		out[index] = conversation
	}
	return out
}

func matchProductInterestCard(title string, catalog []appcore.ProductCard) (appcore.ProductCard, bool) {
	needle := productTitleMatchKey(title)
	if needle == "" {
		return appcore.ProductCard{}, false
	}
	bestScore := 0
	var best appcore.ProductCard
	for _, card := range catalog {
		if strings.TrimSpace(card.URL) == "" {
			continue
		}
		score := productTitleMatchScore(needle, productTitleMatchKey(card.Title))
		if handle := productHandleFromCardURL(card.URL); handle != "" {
			score = maxInt(score, productTitleMatchScore(needle, productTitleMatchKey(titleFromProductHandle(handle))))
		}
		if score > bestScore {
			bestScore = score
			best = card
		}
	}
	if bestScore < 70 {
		return appcore.ProductCard{}, false
	}
	return best, true
}

func productTitleMatchScore(needle string, candidate string) int {
	needle = strings.TrimSpace(needle)
	candidate = strings.TrimSpace(candidate)
	if needle == "" || candidate == "" {
		return 0
	}
	if needle == candidate {
		return 100
	}
	if len(candidate) >= 12 && strings.Contains(needle, candidate) {
		return 95
	}
	if len(needle) >= 12 && strings.Contains(candidate, needle) {
		return 92
	}
	needleTokens := productTitleMatchTokens(needle)
	candidateTokens := productTitleMatchTokens(candidate)
	if len(needleTokens) == 0 || len(candidateTokens) == 0 {
		return 0
	}
	candidateSet := map[string]bool{}
	for _, token := range candidateTokens {
		candidateSet[token] = true
	}
	common := 0
	for _, token := range needleTokens {
		if candidateSet[token] {
			common++
		}
	}
	minTokens := len(needleTokens)
	if len(candidateTokens) < minTokens {
		minTokens = len(candidateTokens)
	}
	if common < 2 || minTokens == 0 {
		return 0
	}
	return common * 100 / minTokens
}

func productTitleMatchKey(value string) string {
	value = html.UnescapeString(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	replacer := strings.NewReplacer("&", " and ", "%", " ", "+", " ")
	value = replacer.Replace(value)
	words := strings.FieldsFunc(value, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r))
	})
	out := make([]string, 0, len(words))
	for _, word := range words {
		word = strings.ToLower(strings.TrimSpace(word))
		if word == "" || word == "page" {
			continue
		}
		out = append(out, word)
	}
	return strings.Join(out, " ")
}

func productTitleMatchTokens(key string) []string {
	parts := strings.Fields(key)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if len([]rune(part)) < 2 && !stringHasDigit(part) {
			continue
		}
		out = append(out, part)
	}
	return out
}

func stringHasDigit(value string) bool {
	for _, r := range value {
		if unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

func (a *App) withShopProductCards(shop appcore.Shop, conversations []appcore.Conversation) []appcore.Conversation {
	return a.withProductCards(conversations, a.core.ShopProductCards(shop))
}

func (a *App) withProductCards(conversations []appcore.Conversation, cards []appcore.ProductCard) []appcore.Conversation {
	cards = collectProductCards(cards, nil)
	out := make([]appcore.Conversation, len(conversations))
	for index, conversation := range conversations {
		conversation.ProductCards = collectProductCards(append(conversation.ProductCards, cards...), nil)
		out[index] = conversation
	}
	return out
}

func collectProductCards(cards []appcore.ProductCard, conversations []appcore.Conversation) []appcore.ProductCard {
	return collectProductCardsLimit(cards, conversations, 50)
}

func collectProductCardsLimit(cards []appcore.ProductCard, conversations []appcore.Conversation, limit int) []appcore.ProductCard {
	if limit <= 0 {
		limit = 50
	}
	out := make([]appcore.ProductCard, 0, limit)
	seen := map[string]bool{}
	add := func(card appcore.ProductCard) {
		if len(out) >= limit {
			return
		}
		card.Title = strings.TrimSpace(card.Title)
		card.URL = strings.TrimSpace(card.URL)
		card.ImageURL = normalizeProductImageURL(card.ImageURL)
		if card.URL == "" {
			return
		}
		if !isRecommendableProductCard(card) {
			return
		}
		key := strings.ToLower(card.URL)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, card)
	}
	for _, card := range cards {
		add(card)
	}
	for _, conversation := range conversations {
		for _, card := range conversation.ProductCards {
			add(card)
		}
	}
	return out
}

func mergeManualAndAutoProductCards(existing []appcore.ProductCard, automatic []appcore.ProductCard) []appcore.ProductCard {
	manual := make([]appcore.ProductCard, 0, len(existing))
	existingAuto := make([]appcore.ProductCard, 0, len(existing))
	autoSource := automatic
	for _, card := range existing {
		if card.Manual {
			title := strings.TrimSpace(card.Title)
			if strings.EqualFold(title, "Manual Product") ||
				title == "Recommended Product" ||
				strings.Trim(title, "?") == "" ||
				strings.TrimSpace(card.ImageURL) == "" {
				card = enrichProductCardFromStorefront(card)
			}
			if !isRecommendableProductCard(card) {
				continue
			}
			manual = append(manual, card)
			continue
		}
		existingAuto = append(existingAuto, card)
	}
	existingAuto = collectProductCardsLimit(existingAuto, nil, 5)
	if len(automatic) < len(existingAuto) {
		autoSource = append(append([]appcore.ProductCard(nil), automatic...), existingAuto...)
	}
	out := collectProductCardsLimit(manual, nil, 50)
	seen := map[string]bool{}
	for _, card := range out {
		seen[strings.ToLower(strings.TrimSpace(card.URL))] = true
	}
	autoAdded := 0
	for _, card := range autoSource {
		if card.Manual || autoAdded >= 5 {
			continue
		}
		card.Title = strings.TrimSpace(card.Title)
		card.URL = strings.TrimSpace(card.URL)
		card.ImageURL = normalizeProductImageURL(card.ImageURL)
		if card.URL == "" {
			continue
		}
		if !isRecommendableProductCard(card) {
			continue
		}
		key := strings.ToLower(card.URL)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, card)
		autoAdded++
	}
	return out
}

func mergeInboxMeta(base *appcore.InboxResult, extra appcore.InboxResult) {
	base.Status = mergeInboxStatus(base.Status, extra.Status)
	base.Warnings = appendUniqueStrings(base.Warnings, extra.Warnings...)
	base.ProviderErrors = appendUniqueStrings(base.ProviderErrors, extra.ProviderErrors...)
	base.IgnoredEmailCount += extra.IgnoredEmailCount
	base.IgnoredEmailFingerprints = appendUniqueStrings(base.IgnoredEmailFingerprints, extra.IgnoredEmailFingerprints...)
	if extra.FallbackUsed {
		base.FallbackUsed = true
		base.Status = mergeInboxStatus(base.Status, "fallback")
	}
	if len(extra.ProviderErrors) > 0 || len(extra.Warnings) > 0 {
		base.Status = mergeInboxStatus(base.Status, "partial")
	}
}

func mergeInboxStatus(current string, next string) string {
	current = strings.TrimSpace(strings.ToLower(current))
	next = strings.TrimSpace(strings.ToLower(next))
	if current == "" {
		current = "ready"
	}
	if next == "" {
		return current
	}
	rank := map[string]int{"ready": 0, "fallback": 1, "partial": 2, "failed": 3}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func appendUniqueStrings(items []string, more ...string) []string {
	seen := map[string]bool{}
	var out []string
	for _, item := range append(items, more...) {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}

func prefixMessages(prefix string, messages []string) []string {
	if len(messages) == 0 {
		return nil
	}
	var out []string
	for _, message := range messages {
		message = strings.TrimSpace(message)
		if message == "" {
			continue
		}
		if strings.TrimSpace(prefix) != "" {
			out = append(out, prefix+": "+message)
		} else {
			out = append(out, message)
		}
	}
	return out
}

func (a *App) waitIfPaused(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		a.mu.Lock()
		paused := a.paused
		a.mu.Unlock()
		if !paused {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	if _, err := os.Stat(path); err != nil {
		return false
	}
	return true
}

func isPathInside(path string, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != "" && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func mimeTypeForAsset(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return ""
	}
}
