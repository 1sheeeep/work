package adapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
	"shopify-support-platform/internal/winexec"
)

type logger interface {
	Append(event string, details any)
}

type attachFailureKind string

const (
	attachFailureDevtools   attachFailureKind = "devtools"
	attachFailureNotRunning attachFailureKind = "not_running"
)

type attachFailureError struct {
	kind    attachFailureKind
	message string
}

func (e *attachFailureError) Error() string {
	return e.message
}

func newAttachDevtoolsError(message string) error {
	return &attachFailureError{kind: attachFailureDevtools, message: message}
}

func newAttachNotRunningError(message string) error {
	return &attachFailureError{kind: attachFailureNotRunning, message: message}
}

func attachFailureIs(err error, kind attachFailureKind) bool {
	var typed *attachFailureError
	return errors.As(err, &typed) && typed.kind == kind
}

func shouldRecoverAttachFailure(shop appcore.Shop, err error) bool {
	if err == nil {
		return false
	}
	if attachFailureIs(err, attachFailureDevtools) {
		return true
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "api") && (strings.Contains(message, "未开启") || strings.Contains(message, "not") || strings.Contains(message, "key")) {
		return false
	}
	if strings.Contains(message, "没有运行") || strings.Contains(message, "not running") || strings.Contains(message, "not confirmed running") {
		return false
	}
	if !strings.Contains(message, "devtools") && !strings.Contains(message, "webdriver") {
		return false
	}
	if shop.AdapterName == "zhanfu" {
		return isOpenShopStatusLike(shop)
	}
	return true
}

func isOpenShopStatusLike(shop appcore.Shop) bool {
	status := strings.ToLower(strings.TrimSpace(shop.Status))
	if status == "open" || status == "opened" || status == "running" || status == "active" || status == "1" || status == "true" {
		return true
	}
	for _, key := range []string{"status", "opened", "running", "isOpen", "is_open"} {
		value := strings.ToLower(strings.TrimSpace(fmt.Sprint(shop.Raw[key])))
		if value == "open" || value == "opened" || value == "running" || value == "active" || value == "1" || value == "true" {
			return true
		}
	}
	return false
}

func ListShops(settings appcore.Settings, log logger) ([]appcore.Shop, error) {
	var shops []appcore.Shop
	collect := func(items []appcore.Shop, err error) error {
		if err != nil {
			if log != nil {
				log.Append("adapter.list.partial_failed", map[string]any{"error": err.Error()})
			}
			return nil
		}
		shops = append(shops, items...)
		return nil
	}
	_ = collect(listZhanfu(settings.Zhanfu, "default", "站斧", log))
	_ = collect(listBitBrowser(settings.BitBrowser, "default", "BitBrowser", log))
	_ = collect(listAdsPower(settings.AdsPower, "default", "AdsPower", log))
	for _, item := range settings.ZhanfuInstances {
		name := stringValue(item, "name", "instance")
		_ = collect(listZhanfu(merge(settingCopy(settings.Zhanfu), item), name, "站斧-"+name, log))
	}
	for _, item := range settings.BitBrowserInstances {
		name := stringValue(item, "name", "instance")
		_ = collect(listBitBrowser(merge(settingCopy(settings.BitBrowser), item), name, "BitBrowser-"+name, log))
	}
	for _, item := range settings.AdsPowerInstances {
		name := stringValue(item, "name", "instance")
		_ = collect(listAdsPower(merge(settingCopy(settings.AdsPower), item), name, "AdsPower-"+name, log))
	}
	shops = dedupeShops(shops, log)
	if len(shops) == 0 {
		return shops, errors.New("没有读取到店铺。请确认浏览器本地 API 已开启，并且设置里的端口/API Key 正确")
	}
	return AnnotateOpenStatuses(settings, shops, log), nil
}

func dedupeShops(shops []appcore.Shop, log logger) []appcore.Shop {
	if len(shops) < 2 {
		return shops
	}
	out := make([]appcore.Shop, 0, len(shops))
	indexByKey := map[string]int{}
	dropped := 0
	for _, shop := range shops {
		keys := shopDedupKeys(shop)
		duplicateIndex := -1
		for _, key := range keys {
			if index, ok := indexByKey[key]; ok {
				duplicateIndex = index
				break
			}
		}
		if duplicateIndex >= 0 {
			dropped++
			if shopLooksRicher(out[duplicateIndex], shop) {
				out[duplicateIndex] = shop
				for _, key := range keys {
					indexByKey[key] = duplicateIndex
				}
			}
			continue
		}
		out = append(out, shop)
		index := len(out) - 1
		for _, key := range keys {
			indexByKey[key] = index
		}
	}
	if dropped > 0 && log != nil {
		log.Append("adapter.list.deduped", map[string]any{"input": len(shops), "output": len(out), "dropped": dropped})
	}
	return out
}

func shopDedupKeys(shop appcore.Shop) []string {
	adapter := strings.ToLower(strings.TrimSpace(shop.AdapterName))
	instance := strings.ToLower(strings.TrimSpace(shop.AdapterInstance))
	id := strings.ToLower(strings.TrimSpace(shop.MallID))
	if adapter == "" || id == "" {
		return nil
	}
	keys := []string{adapter + "|" + instance + "|" + id}
	if adapter == "adspower" {
		keys = append(keys, adapter+"|"+id)
	}
	return keys
}

func shopLooksRicher(current appcore.Shop, candidate appcore.Shop) bool {
	currentName := strings.TrimSpace(current.DisplayName)
	candidateName := strings.TrimSpace(candidate.DisplayName)
	id := strings.TrimSpace(current.MallID)
	if candidateName != "" && (currentName == "" || currentName == id) {
		return true
	}
	return current.SourceLabel == "" && strings.TrimSpace(candidate.SourceLabel) != ""
}

func AnnotateOpenStatuses(settings appcore.Settings, shops []appcore.Shop, log logger) []appcore.Shop {
	out := make([]appcore.Shop, len(shops))
	copy(out, shops)
	bitOpen := openBitBrowserIDs(settings, out, log)
	adsOpen := openAdsPowerIDs(settings, out, log)
	processOpen := openProcessDebugIDs(out, log)
	counts := map[string]int{"open": 0, "closed": 0, "unknown": 0}
	for index := range out {
		shop := &out[index]
		shop.Status = "closed"
		if processOpen[shop.AdapterInstance+"|"+shop.MallID] {
			shop.Status = "open"
			counts[shop.Status]++
			continue
		}
		switch shop.AdapterName {
		case "bitbrowser":
			if bitOpen[shop.AdapterInstance+"|"+shop.MallID] {
				shop.Status = "open"
			}
		case "adspower":
			if adsOpen[shop.AdapterInstance+"|"+shop.MallID] {
				shop.Status = "open"
			}
		case "zhanfu":
		default:
			shop.Status = "unknown"
		}
		counts[shop.Status]++
	}
	if log != nil {
		log.Append("adapter.open_status.annotated", map[string]any{"total": len(out), "open": counts["open"], "closed": counts["closed"], "unknown": counts["unknown"]})
	}
	return out
}

func openBitBrowserIDs(settings appcore.Settings, shops []appcore.Shop, log logger) map[string]bool {
	open := map[string]bool{}
	groups := map[string][]string{}
	configs := map[string]map[string]any{}
	for _, shop := range shops {
		if shop.AdapterName != "bitbrowser" {
			continue
		}
		key := shop.AdapterInstance
		groups[key] = append(groups[key], shop.MallID)
		configs[key] = configForShop(settings.BitBrowser, settings.BitBrowserInstances, shop)
	}
	for instance, ids := range groups {
		cfg := configs[instance]
		baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:54345"), "/")
		port := intValue(cfg, "http_port", 54345)
		if !portOpen("127.0.0.1", port) {
			continue
		}
		var response map[string]any
		if err := postJSON(baseURL+"/browser/pids", map[string]any{"ids": ids}, &response, minInt(intValue(cfg, "http_timeout_seconds", 12), 5)); err != nil {
			if log != nil {
				log.Append("bitbrowser.open_status.failed", map[string]any{"instance": instance, "error": err.Error()})
			}
			continue
		}
		data := asMap(response["data"])
		for _, id := range ids {
			if intFromAny(data[id]) > 0 {
				open[instance+"|"+id] = true
			}
		}
	}
	return open
}

func openAdsPowerIDs(settings appcore.Settings, shops []appcore.Shop, log logger) map[string]bool {
	open := map[string]bool{}
	configs := map[string]map[string]any{}
	for _, shop := range shops {
		if shop.AdapterName == "adspower" {
			configs[shop.AdapterInstance] = configForShop(settings.AdsPower, settings.AdsPowerInstances, shop)
		}
	}
	for instance, cfg := range configs {
		baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:50325"), "/")
		port := intValue(cfg, "http_port", 50325)
		apiKey := adsPowerAPIKey(cfg)
		if !portOpen("127.0.0.1", port) || apiKey == "" {
			continue
		}
		var response map[string]any
		if err := getJSONWithHeaders(baseURL+"/api/v1/browser/local-active", map[string]string{}, adsPowerHeaders(apiKey), &response, minInt(intValue(cfg, "http_timeout_seconds", 12), 5)); err != nil {
			if log != nil {
				log.Append("adspower.open_status.failed", map[string]any{"instance": instance, "error": err.Error()})
			}
			continue
		}
		data := asMap(response["data"])
		items, _ := data["list"].([]any)
		for _, item := range items {
			row := asMap(item)
			id := fmt.Sprint(row["user_id"])
			if id != "" && id != "<nil>" {
				open[instance+"|"+id] = true
			}
		}
	}
	return open
}

func ProbeStatuses(settings appcore.Settings, log logger) []appcore.BrowserStatus {
	var statuses []appcore.BrowserStatus
	probe := func(adapterName string, instance string, label string, cfg map[string]any, fn func(map[string]any, string, string, logger) ([]appcore.Shop, error)) {
		items, err := fn(cfg, instance, label, log)
		status := appcore.BrowserStatus{
			AdapterName:     adapterName,
			AdapterInstance: instance,
			Label:           label,
			OK:              err == nil,
			ShopCount:       len(items),
			BaseURL:         stringValue(cfg, "base_url", ""),
			Port:            intValue(cfg, "http_port", 0),
		}
		if err != nil {
			status.Error = err.Error()
		}
		if adapterName == "zhanfu" {
			detection := DetectZhanfuClientPath(cfg, nil)
			status.ClientPath = detection.Path
			status.ClientPathSource = detection.Source
			status.ClientPathError = detection.Error
		}
		statuses = append(statuses, status)
	}
	probe("zhanfu", "default", "站斧", settings.Zhanfu, listZhanfu)
	probe("bitbrowser", "default", "BitBrowser", settings.BitBrowser, listBitBrowser)
	probe("adspower", "default", "AdsPower", settings.AdsPower, listAdsPower)
	for _, item := range settings.ZhanfuInstances {
		name := stringValue(item, "name", "instance")
		probe("zhanfu", name, "站斧-"+name, merge(settingCopy(settings.Zhanfu), item), listZhanfu)
	}
	for _, item := range settings.BitBrowserInstances {
		name := stringValue(item, "name", "instance")
		probe("bitbrowser", name, "BitBrowser-"+name, merge(settingCopy(settings.BitBrowser), item), listBitBrowser)
	}
	for _, item := range settings.AdsPowerInstances {
		name := stringValue(item, "name", "instance")
		probe("adspower", name, "AdsPower-"+name, merge(settingCopy(settings.AdsPower), item), listAdsPower)
	}
	return statuses
}

type ClientPathDetection struct {
	Path    string
	Source  string
	Error   string
	Checked []string
}

type zhanfuClientCandidate struct {
	Path   string
	Source string
}

func DetectZhanfuClientPath(cfg map[string]any, log logger) ClientPathDetection {
	detection := firstExistingZhanfuClient(zhanfuClientCandidates(cfg))
	if detection.Path != "" {
		if log != nil {
			log.Append("zhanfu.client.detected", map[string]any{"path": detection.Path, "source": detection.Source})
		}
		return detection
	}
	detection.Error = "未找到站斧客户端。请先安装站斧，软件会在启动时自动探测站斧位置。"
	if log != nil {
		log.Append("zhanfu.client.not_found", map[string]any{"checked": detection.Checked})
	}
	return detection
}

func zhanfuClientCandidates(cfg map[string]any) []zhanfuClientCandidate {
	var candidates []zhanfuClientCandidate
	add := func(path string, source string) {
		path = strings.TrimSpace(os.ExpandEnv(path))
		if path == "" {
			return
		}
		candidates = append(candidates, zhanfuClientCandidate{Path: path, Source: source})
	}
	for _, key := range []string{"client_exe_path", "clientPath"} {
		add(stringValue(cfg, key, ""), "configured")
	}
	candidates = append(candidates, runningZhanfuClientCandidates()...)
	for _, path := range commonZhanfuClientPaths() {
		add(path, "common_path")
	}
	candidates = append(candidates, shortcutZhanfuClientCandidates()...)
	return candidates
}

func firstExistingZhanfuClient(candidates []zhanfuClientCandidate) ClientPathDetection {
	seen := map[string]bool{}
	var checked []string
	for _, candidate := range candidates {
		path := strings.TrimSpace(candidate.Path)
		if path == "" {
			continue
		}
		path = filepath.Clean(os.ExpandEnv(path))
		key := strings.ToLower(path)
		if seen[key] {
			continue
		}
		seen[key] = true
		checked = append(checked, path)
		if !existingExecutable(path) {
			continue
		}
		if candidate.Source != "configured" && !likelyZhanfuClientPath(path) {
			continue
		}
		return ClientPathDetection{Path: path, Source: candidate.Source, Checked: checked}
	}
	return ClientPathDetection{Checked: checked}
}

func existingExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && strings.EqualFold(filepath.Ext(path), ".exe")
}

func likelyZhanfuClientPath(path string) bool {
	base := strings.ToLower(filepath.Base(path))
	if strings.Contains(base, "zhanfubrowser") {
		return false
	}
	lower := strings.ToLower(filepath.ToSlash(path))
	return strings.Contains(lower, "zhanfu") || strings.Contains(path, "站斧")
}

func runningZhanfuClientCandidates() []zhanfuClientCandidate {
	script := "Get-CimInstance Win32_Process | Where-Object { ($_.Name -match 'zhanfu|站斧') -or ($_.ExecutablePath -match 'zhanfu|站斧') -or ($_.CommandLine -match 'zhanfu|站斧') } | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3"
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	winexec.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return nil
	}
	var candidates []zhanfuClientCandidate
	for _, row := range jsonRows(out) {
		path := first(row, "ExecutablePath")
		if path == "" {
			path = firstExeFromCommandLine(fmt.Sprint(row["CommandLine"]))
		}
		if likelyZhanfuClientPath(path) {
			candidates = append(candidates, zhanfuClientCandidate{Path: path, Source: "running_process"})
		}
	}
	return candidates
}

func commonZhanfuClientPaths() []string {
	paths := []string{
		`D:\soft\ZhanFu\站斧.exe`,
		`D:\soft\ZhanFu\ZhanFu.exe`,
		`C:\Program Files\ZhanFu\站斧.exe`,
		`C:\Program Files\ZhanFu\ZhanFu.exe`,
		`C:\Program Files (x86)\ZhanFu\站斧.exe`,
		`C:\Program Files (x86)\ZhanFu\ZhanFu.exe`,
	}
	for _, root := range []string{os.Getenv("LOCALAPPDATA"), os.Getenv("APPDATA")} {
		if root == "" {
			continue
		}
		paths = append(paths,
			filepath.Join(root, "Programs", "ZhanFu", "站斧.exe"),
			filepath.Join(root, "Programs", "ZhanFu", "ZhanFu.exe"),
			filepath.Join(root, "ZhanFu", "站斧.exe"),
			filepath.Join(root, "ZhanFu", "ZhanFu.exe"),
		)
	}
	return paths
}

func shortcutZhanfuClientCandidates() []zhanfuClientCandidate {
	script := `$roots = @(
	[Environment]::GetFolderPath('Desktop'),
	[Environment]::GetFolderPath('CommonDesktopDirectory'),
	[Environment]::GetFolderPath('StartMenu'),
	[Environment]::GetFolderPath('CommonStartMenu'),
	[Environment]::GetFolderPath('Programs'),
	[Environment]::GetFolderPath('CommonPrograms')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
$items = foreach ($root in $roots) {
	Get-ChildItem -Path $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue |
		ForEach-Object {
			$shortcut = $shell.CreateShortcut($_.FullName)
			[pscustomobject]@{ Shortcut = $_.FullName; Target = $shortcut.TargetPath }
		} |
		Where-Object { $_.Shortcut -match 'zhanfu|站斧' -or $_.Target -match 'zhanfu|站斧' }
}
$items | ConvertTo-Json -Depth 3`
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	winexec.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return nil
	}
	var candidates []zhanfuClientCandidate
	for _, row := range jsonRows(out) {
		path := first(row, "Target")
		if likelyZhanfuClientPath(path) {
			candidates = append(candidates, zhanfuClientCandidate{Path: path, Source: "shortcut"})
		}
	}
	return candidates
}

func firstExeFromCommandLine(commandLine string) string {
	pattern := regexp.MustCompile(`(?i)"([^"]+\.exe)"|([^\s"]+\.exe)`)
	match := pattern.FindStringSubmatch(commandLine)
	if len(match) == 0 {
		return ""
	}
	for _, item := range match[1:] {
		if strings.TrimSpace(item) != "" {
			return strings.TrimSpace(item)
		}
	}
	return ""
}

func jsonRows(raw []byte) []map[string]any {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	var rows []map[string]any
	switch typed := payload.(type) {
	case []any:
		for _, item := range typed {
			if row := asMap(item); len(row) > 0 {
				rows = append(rows, row)
			}
		}
	case map[string]any:
		rows = append(rows, typed)
	}
	return rows
}

func StartZhanfuAPI(cfg map[string]any, log logger) error {
	port := intValue(cfg, "http_port", 45008)
	if portOpen("127.0.0.1", port) {
		if log != nil {
			log.Append("zhanfu.api.already_running", map[string]any{"port": port})
		}
		return nil
	}
	detection := DetectZhanfuClientPath(cfg, log)
	path := detection.Path
	if path == "" {
		return errors.New(detection.Error)
	}
	if !existingExecutable(path) {
		return fmt.Errorf("未找到站斧客户端。请先安装站斧，软件会在启动时自动探测站斧位置：%s", path)
	}
	args := []string{"--multip", "--run_type=web_driver", "--ipc_type=http", fmt.Sprintf("--httpport=%d", port)}
	cmd := exec.Command(path, args...)
	winexec.HideWindow(cmd)
	cmd.Dir = filepath.Dir(path)
	if log != nil {
		log.Append("zhanfu.api.starting", map[string]any{"command": append([]string{path}, args...), "source": detection.Source})
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	deadline := time.Now().Add(time.Duration(intValue(cfg, "startup_timeout_seconds", 20)) * time.Second)
	for time.Now().Before(deadline) {
		if portOpen("127.0.0.1", port) {
			if log != nil {
				log.Append("zhanfu.api.started", map[string]any{"port": port})
			}
			return nil
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("站斧客户端已启动，但 API 端口 %d 仍未监听", port)
}

func AttachOpenShop(settings appcore.Settings, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	if result, err := attachProcessDebugBrowser(shop, log); err == nil {
		return result, nil
	}
	cfg := configForShop(settingsForAdapter(settings, shop.AdapterName), instancesForAdapter(settings, shop.AdapterName), shop)
	result, err := attachOpenShopWithConfig(cfg, shop, log)
	if err == nil {
		return result, nil
	}
	if !shouldRecoverAttachFailure(shop, err) {
		return appcore.OpenResult{}, err
	}
	return recoverOpenShopConnectionWithConfig(cfg, shop, log, err)
}

func RecoverOpenShopConnection(settings appcore.Settings, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	if result, err := attachProcessDebugBrowser(shop, log); err == nil {
		return result, nil
	}
	cfg := configForShop(settingsForAdapter(settings, shop.AdapterName), instancesForAdapter(settings, shop.AdapterName), shop)
	result, err := attachOpenShopWithConfig(cfg, shop, log)
	if err == nil {
		return result, nil
	}
	if !shouldRecoverAttachFailure(shop, err) {
		return appcore.OpenResult{}, err
	}
	return recoverOpenShopConnectionWithConfig(cfg, shop, log, err)
}

func attachOpenShopWithConfig(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	switch shop.AdapterName {
	case "zhanfu":
		return attachZhanfu(cfg, shop, log)
	case "bitbrowser":
		return attachBitBrowser(cfg, shop, log)
	case "adspower":
		return attachAdsPower(cfg, shop, log)
	default:
		return appcore.OpenResult{}, fmt.Errorf("unsupported adapter: %s", shop.AdapterName)
	}
}

func recoverOpenShopConnectionWithConfig(cfg map[string]any, shop appcore.Shop, log logger, originalErr error) (appcore.OpenResult, error) {
	if log != nil {
		log.Append("adapter.connection_recovery.start", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "error": originalErr.Error()})
	}
	openResult, openErr := openShopWithConfig(cfg, shop, log)
	if openErr != nil {
		if log != nil {
			log.Append("adapter.connection_recovery.open_failed", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "error": openErr.Error()})
		}
		return appcore.OpenResult{}, fmt.Errorf("browser environment is running but DevTools recovery failed: %w", openErr)
	}
	attached, attachErr := attachOpenShopWithConfig(cfg, shop, log)
	if attachErr == nil {
		if log != nil {
			log.Append("adapter.connection_recovery.ok", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": attached.WebDriverURL})
		}
		return attached, nil
	}
	if strings.TrimSpace(openResult.WebDriverURL) != "" && waitForDevtools(openResult.WebDriverURL, 8*time.Second) {
		if log != nil {
			log.Append("adapter.connection_recovery.ok", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": openResult.WebDriverURL, "source": "open_result"})
		}
		return openResult, nil
	}
	if log != nil {
		log.Append("adapter.connection_recovery.attach_failed", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "error": attachErr.Error()})
	}
	return appcore.OpenResult{}, fmt.Errorf("browser environment is running but DevTools address is still unavailable after recovery: %w", attachErr)
}

func openShopWithConfig(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	switch shop.AdapterName {
	case "zhanfu":
		return openZhanfu(cfg, shop, log)
	case "bitbrowser":
		return openBitBrowser(cfg, shop, log)
	case "adspower":
		return openAdsPower(cfg, shop, log)
	default:
		return appcore.OpenResult{}, fmt.Errorf("unsupported adapter: %s", shop.AdapterName)
	}
}

func OpenShop(settings appcore.Settings, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	if openResult, err := AttachOpenShop(settings, shop, log); err == nil {
		if log != nil {
			log.Append("adapter.open.attach_existing", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID})
		}
		return openResult, nil
	}
	switch shop.AdapterName {
	case "zhanfu":
		return openZhanfu(configForShop(settings.Zhanfu, settings.ZhanfuInstances, shop), shop, log)
	case "bitbrowser":
		return openBitBrowser(configForShop(settings.BitBrowser, settings.BitBrowserInstances, shop), shop, log)
	case "adspower":
		return openAdsPower(configForShop(settings.AdsPower, settings.AdsPowerInstances, shop), shop, log)
	default:
		return appcore.OpenResult{}, fmt.Errorf("unsupported adapter: %s", shop.AdapterName)
	}
}

func configForShop(base map[string]any, instances []map[string]any, shop appcore.Shop) map[string]any {
	cfg := base
	for _, item := range instances {
		if stringValue(item, "name", "default") == shop.AdapterInstance {
			cfg = merge(settingCopy(base), item)
			break
		}
	}
	return cfg
}

func settingsForAdapter(settings appcore.Settings, adapterName string) map[string]any {
	switch adapterName {
	case "zhanfu":
		return settings.Zhanfu
	case "bitbrowser":
		return settings.BitBrowser
	case "adspower":
		return settings.AdsPower
	default:
		return nil
	}
}

func instancesForAdapter(settings appcore.Settings, adapterName string) []map[string]any {
	switch adapterName {
	case "zhanfu":
		return settings.ZhanfuInstances
	case "bitbrowser":
		return settings.BitBrowserInstances
	case "adspower":
		return settings.AdsPowerInstances
	default:
		return nil
	}
}

func listZhanfu(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	port := intValue(cfg, "http_port", 45008)
	if !portOpen("127.0.0.1", port) {
		return nil, fmt.Errorf("API 未监听端口 %d", port)
	}
	return listZhanfuPaged(cfg, instance, label, log)
}

func attachZhanfu(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:45008"), "/")
	port := intValue(cfg, "http_port", 45008)
	if !portOpen("127.0.0.1", port) {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境 API 未开启，已跳过，不会自动启动")
	}
	payload := map[string]any{
		"action":    "GetBrowserWebDriver",
		"module":    "WebDriverModule",
		"browserId": shop.MallID,
	}
	var response any
	if err := postJSON(baseURL, payload, &response, intValue(cfg, "http_timeout_seconds", 60)); err != nil {
		return appcore.OpenResult{}, err
	}
	data, err := unwrapZhanfu(response)
	if err != nil {
		return appcore.OpenResult{}, err
	}
	flat := flatten(data)
	webdriverURL, debuggerAddress := extractWebdriverInfo(flat)
	if webdriverURL == "" && debuggerAddress != "" {
		webdriverURL = "http://" + debuggerAddress
	}
	if webdriverURL == "" {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境当前没有打开或未返回 DevTools 端口，已跳过")
	}
	return appcore.OpenResult{
		MallID: shop.MallID, ShopName: shop.DisplayName, WebDriverURL: webdriverURL, DebuggerAddress: debuggerAddress,
		AdapterName: shop.AdapterName, AdapterInstance: shop.AdapterInstance, WebDriverRaw: asMap(data),
	}, nil
}

func openZhanfu(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:45008"), "/")
	port := intValue(cfg, "http_port", 45008)
	if !portOpen("127.0.0.1", port) {
		return appcore.OpenResult{}, fmt.Errorf("站斧 API 未开启，不能自动打开店铺环境")
	}
	payload := map[string]any{
		"action":    "OpenBrowser",
		"module":    "WebDriverModule",
		"browserId": shop.MallID,
	}
	var openResponse any
	if err := postJSON(baseURL, payload, &openResponse, maxInt(intValue(cfg, "http_timeout_seconds", 60), 60)); err != nil {
		return appcore.OpenResult{}, err
	}
	deadline := time.Now().Add(time.Duration(intValue(cfg, "browser_startup_timeout_seconds", 60)) * time.Second)
	var last any
	for time.Now().Before(deadline) {
		result, err := attachZhanfu(cfg, shop, log)
		if err == nil {
			result.OpenResponse = asMap(openResponse)
			if log != nil {
				log.Append("zhanfu.open_browser.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": result.WebDriverURL})
			}
			return result, nil
		}
		last = err.Error()
		time.Sleep(time.Second)
	}
	return appcore.OpenResult{}, fmt.Errorf("站斧店铺已请求打开，但未返回 DevTools 端口：%v", last)
}

func listBitBrowser(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	port := intValue(cfg, "http_port", 54345)
	if !portOpen("127.0.0.1", port) {
		return nil, fmt.Errorf("API 未监听端口 %d", port)
	}
	return listBitBrowserPaged(cfg, instance, label, log)
}

func attachBitBrowser(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:54345"), "/")
	port := intValue(cfg, "http_port", 54345)
	if !portOpen("127.0.0.1", port) {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境 API 未开启，已跳过，不会自动启动")
	}
	var response map[string]any
	if err := postJSON(baseURL+"/browser/pids", map[string]any{"ids": []string{shop.MallID}}, &response, intValue(cfg, "http_timeout_seconds", 12)); err != nil {
		return appcore.OpenResult{}, err
	}
	data := asMap(response["data"])
	pid := intFromAny(data[shop.MallID])
	if pid <= 0 {
		return appcore.OpenResult{}, fmt.Errorf("该 BitBrowser 店铺环境当前没有运行进程，已跳过，不会自动打开")
	}
	commandLine := processCommandLine(pid)
	userDataDir := commandLineOption(commandLine, "user-data-dir")
	devtoolsPort := devtoolsPortFromDir(userDataDir)
	if devtoolsPort == 0 {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境当前没有打开或未返回 DevTools 端口，已跳过")
	}
	webdriverURL := fmt.Sprintf("http://127.0.0.1:%d", devtoolsPort)
	if !devtoolsAvailable(webdriverURL) {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境当前没有打开或未返回 DevTools 端口，已跳过")
	}
	return appcore.OpenResult{
		MallID: shop.MallID, ShopName: shop.DisplayName, WebDriverURL: webdriverURL, DebuggerAddress: fmt.Sprintf("127.0.0.1:%d", devtoolsPort),
		AdapterName: shop.AdapterName, AdapterInstance: shop.AdapterInstance, WebDriverRaw: map[string]any{"pid": pid, "source": "bitbrowser_attach_open"},
	}, nil
}

func openBitBrowser(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:54345"), "/")
	port := intValue(cfg, "http_port", 54345)
	if !portOpen("127.0.0.1", port) {
		return appcore.OpenResult{}, fmt.Errorf("BitBrowser API 未开启，不能自动打开店铺环境")
	}
	payload := map[string]any{"id": shop.MallID, "args": []string{}, "queue": boolValue(cfg, "open_queue", true)}
	var response map[string]any
	if err := postJSON(baseURL+"/browser/open", payload, &response, maxInt(intValue(cfg, "http_timeout_seconds", 12), 60)); err != nil {
		return appcore.OpenResult{}, err
	}
	if !successResponse(response) {
		return appcore.OpenResult{}, fmt.Errorf("%v", response["msg"])
	}
	data := asMap(response["data"])
	webdriverURL, debuggerAddress := extractWebdriverInfo(flatten(data))
	if webdriverURL == "" && debuggerAddress != "" {
		webdriverURL = "http://" + strings.TrimPrefix(strings.TrimPrefix(debuggerAddress, "http://"), "https://")
	}
	if webdriverURL == "" {
		if result, err := attachBitBrowser(cfg, shop, log); err == nil {
			result.OpenResponse = response
			return result, nil
		}
		return appcore.OpenResult{}, fmt.Errorf("BitBrowser 已请求打开，但未返回 DevTools 地址")
	}
	if !devtoolsAvailable(webdriverURL) {
		time.Sleep(2 * time.Second)
	}
	if log != nil {
		log.Append("bitbrowser.open_browser.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": webdriverURL})
	}
	return appcore.OpenResult{
		MallID: shop.MallID, ShopName: shop.DisplayName, WebDriverURL: webdriverURL, DebuggerAddress: debuggerAddress,
		AdapterName: shop.AdapterName, AdapterInstance: shop.AdapterInstance, OpenResponse: response, WebDriverRaw: data,
	}, nil
}

func listAdsPower(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	port := intValue(cfg, "http_port", 50325)
	apiKey := adsPowerAPIKey(cfg)
	if !portOpen("127.0.0.1", port) {
		return nil, fmt.Errorf("API 未监听端口 %d", port)
	}
	if apiKey == "" {
		return nil, fmt.Errorf("AdsPower API Key 为空")
	}
	return listAdsPowerPaged(cfg, instance, label, log)
}

func listZhanfuPaged(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:45008"), "/")
	pageSize := browserPageSize(cfg)
	timeout := intValue(cfg, "http_timeout_seconds", 60)
	var shops []appcore.Shop
	lastPage := ""
	for page := 1; ; page++ {
		payload := map[string]any{
			"action": "GetBrowserList",
			"module": "WebDriverModule",
			"args":   mustJSON(map[string]any{"page": page, "limit": pageSize}),
		}
		var response any
		if err := postJSON(baseURL, payload, &response, timeout); err != nil {
			return nil, err
		}
		data, err := unwrapZhanfu(response)
		if err != nil {
			return nil, err
		}
		pageShops := normalizeShopList(data, "zhanfu", instance, label)
		fingerprint := shopPageFingerprint(pageShops)
		if page > 1 && fingerprint != "" && fingerprint == lastPage {
			break
		}
		shops = append(shops, pageShops...)
		if len(pageShops) < pageSize {
			break
		}
		lastPage = fingerprint
	}
	if log != nil {
		log.Append("zhanfu.list_shops.ok", map[string]any{"instance": instance, "count": len(shops), "base_url": baseURL})
	}
	return shops, nil
}

func listBitBrowserPaged(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:54345"), "/")
	pageSize := browserPageSize(cfg)
	timeout := intValue(cfg, "http_timeout_seconds", 12)
	var shops []appcore.Shop
	lastPage := ""
	for page := 0; ; page++ {
		var response map[string]any
		if err := postJSON(baseURL+"/browser/list", map[string]any{"page": page, "pageSize": pageSize}, &response, timeout); err != nil {
			return nil, err
		}
		if !successResponse(response) {
			return nil, fmt.Errorf("%v", response["msg"])
		}
		data := asMap(response["data"])
		items, _ := data["list"].([]any)
		pageShops := normalizeShopList(items, "bitbrowser", instance, label)
		fingerprint := shopPageFingerprint(pageShops)
		if page > 0 && fingerprint != "" && fingerprint == lastPage {
			break
		}
		shops = append(shops, pageShops...)
		total := intFromAny(data["totalNum"])
		if total > 0 && len(shops) >= total {
			break
		}
		if len(items) < pageSize {
			break
		}
		lastPage = fingerprint
	}
	if log != nil {
		log.Append("bitbrowser.list_shops.ok", map[string]any{"instance": instance, "count": len(shops), "base_url": baseURL})
	}
	return shops, nil
}

func listAdsPowerPaged(cfg map[string]any, instance string, label string, log logger) ([]appcore.Shop, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:50325"), "/")
	pageSize := browserPageSize(cfg)
	timeout := intValue(cfg, "http_timeout_seconds", 12)
	apiKey := adsPowerAPIKey(cfg)
	var shops []appcore.Shop
	lastPage := ""
	for page := 1; ; page++ {
		items, err := adsPowerListPage(baseURL, apiKey, page, pageSize, timeout)
		if err != nil {
			if log != nil {
				log.Append("adspower.list_page.retry", map[string]any{"instance": instance, "page": page, "error": err.Error()})
			}
			time.Sleep(time.Duration(page) * 700 * time.Millisecond)
			items, err = adsPowerListPage(baseURL, apiKey, page, pageSize, timeout)
		}
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "too many request") {
			if log != nil {
				log.Append("adspower.rate_limited", map[string]any{"instance": instance, "page": page, "message": err.Error()})
			}
			time.Sleep(1500 * time.Millisecond)
			items, err = adsPowerListPage(baseURL, apiKey, page, pageSize, timeout)
		}
		if err != nil {
			return nil, err
		}
		pageShops := normalizeShopList(items, "adspower", instance, label)
		fingerprint := shopPageFingerprint(pageShops)
		if page > 1 && fingerprint != "" && fingerprint == lastPage {
			break
		}
		shops = append(shops, pageShops...)
		if len(items) < pageSize {
			break
		}
		lastPage = fingerprint
	}
	if log != nil {
		log.Append("adspower.list_shops.ok", map[string]any{"instance": instance, "count": len(shops), "base_url": baseURL})
	}
	return shops, nil
}

func adsPowerListPage(baseURL string, apiKey string, page int, pageSize int, timeout int) ([]any, error) {
	var response map[string]any
	params := map[string]string{"page": strconv.Itoa(page), "page_size": strconv.Itoa(pageSize)}
	if err := getJSONWithHeaders(baseURL+"/api/v1/user/list", params, adsPowerHeaders(apiKey), &response, timeout); err != nil {
		return nil, err
	}
	if intFromAny(response["code"]) != 0 {
		return nil, fmt.Errorf("%v", response["msg"])
	}
	data := asMap(response["data"])
	items, ok := data["list"].([]any)
	if !ok {
		return nil, fmt.Errorf("AdsPower /api/v1/user/list 返回格式异常")
	}
	return items, nil
}

func browserPageSize(cfg map[string]any) int {
	size := intValue(cfg, "page_size", 100)
	if size <= 0 {
		return 100
	}
	if size > 100 {
		return 100
	}
	return size
}

func shopPageFingerprint(shops []appcore.Shop) string {
	if len(shops) == 0 {
		return ""
	}
	parts := make([]string, 0, len(shops))
	for _, shop := range shops {
		parts = append(parts, shop.MallID+"|"+shop.DisplayName)
	}
	return strings.Join(parts, "\n")
}

func attachAdsPower(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:50325"), "/")
	apiKey := adsPowerAPIKey(cfg)
	if apiKey == "" {
		return appcore.OpenResult{}, fmt.Errorf("该店铺环境 API 未开启，已跳过，不会自动启动")
	}
	var response map[string]any
	if err := getJSONWithHeaders(baseURL+"/api/v1/browser/local-active", map[string]string{}, adsPowerHeaders(apiKey), &response, intValue(cfg, "http_timeout_seconds", 12)); err != nil {
		return appcore.OpenResult{}, err
	}
	data := asMap(response["data"])
	list, _ := data["list"].([]any)
	for _, item := range list {
		row := asMap(item)
		if fmt.Sprint(row["user_id"]) != shop.MallID {
			continue
		}
		webdriverURL, debuggerAddress := extractAdsPowerConnection(row)
		if webdriverURL == "" {
			return appcore.OpenResult{}, fmt.Errorf("该店铺环境当前没有打开或未返回 DevTools 端口，已跳过")
		}
		if !devtoolsAvailable(webdriverURL) {
			return appcore.OpenResult{}, fmt.Errorf("该店铺环境当前没有打开或未返回 DevTools 端口，已跳过")
		}
		return appcore.OpenResult{
			MallID: shop.MallID, ShopName: shop.DisplayName, WebDriverURL: webdriverURL, DebuggerAddress: debuggerAddress,
			AdapterName: shop.AdapterName, AdapterInstance: shop.AdapterInstance, WebDriverRaw: row,
		}, nil
	}
	return appcore.OpenResult{}, fmt.Errorf("该 AdsPower 店铺环境当前没有打开，已跳过，不会自动打开")
}

func openAdsPower(cfg map[string]any, shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	baseURL := strings.TrimRight(stringValue(cfg, "base_url", "http://127.0.0.1:50325"), "/")
	port := intValue(cfg, "http_port", 50325)
	apiKey := adsPowerAPIKey(cfg)
	if !portOpen("127.0.0.1", port) {
		return appcore.OpenResult{}, fmt.Errorf("AdsPower API 未开启，不能自动打开店铺环境")
	}
	if apiKey == "" {
		return appcore.OpenResult{}, fmt.Errorf("AdsPower API Key 为空")
	}
	var response map[string]any
	if err := getJSONWithHeaders(baseURL+"/api/v1/browser/start", map[string]string{"user_id": shop.MallID, "open_tabs": "1"}, adsPowerHeaders(apiKey), &response, maxInt(intValue(cfg, "http_timeout_seconds", 12), 60)); err != nil {
		return appcore.OpenResult{}, err
	}
	if intFromAny(response["code"]) != 0 {
		return appcore.OpenResult{}, fmt.Errorf("%v", response["msg"])
	}
	data := asMap(response["data"])
	webdriverURL, debuggerAddress := extractAdsPowerConnection(data)
	if webdriverURL == "" {
		webdriverURL, debuggerAddress = extractWebdriverInfo(flatten(data))
	}
	if webdriverURL == "" && debuggerAddress != "" {
		webdriverURL = "http://" + strings.TrimPrefix(strings.TrimPrefix(debuggerAddress, "http://"), "https://")
	}
	if webdriverURL == "" {
		return appcore.OpenResult{}, fmt.Errorf("AdsPower 已请求打开，但未返回 DevTools 地址")
	}
	if log != nil {
		log.Append("adspower.open_browser.ok", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": webdriverURL})
	}
	return appcore.OpenResult{
		MallID: shop.MallID, ShopName: shop.DisplayName, WebDriverURL: webdriverURL, DebuggerAddress: debuggerAddress,
		AdapterName: shop.AdapterName, AdapterInstance: shop.AdapterInstance, OpenResponse: response, WebDriverRaw: data,
	}, nil
}

func normalizeShopList(payload any, adapterName string, instance string, label string) []appcore.Shop {
	candidates := payload
	if obj := asMap(payload); len(obj) > 0 {
		for _, key := range []string{"mall_list", "list", "rows", "browsers", "browserList", "malls", "data"} {
			if value, ok := obj[key]; ok {
				candidates = value
				if nested := asMap(value); len(nested) > 0 && nested["list"] != nil {
					candidates = nested["list"]
				}
				break
			}
		}
	}
	items, _ := candidates.([]any)
	var shops []appcore.Shop
	for _, item := range items {
		row := asMap(item)
		id := first(row, "mall_id", "mallId", "id", "browserId", "profile_id", "user_id", "serial_number")
		if id == "" {
			continue
		}
		name := first(row, "mall_name", "mallName", "name", "shop_name", "shopName", "title", "remark", "user_name", "platform")
		if name == "" {
			name = id
		}
		shops = append(shops, appcore.Shop{
			MallID: id, DisplayName: name, AdapterName: adapterName, AdapterInstance: instance, SourceLabel: sourceLabel(adapterName, row, label), Raw: row,
		})
	}
	return shops
}

func sourceLabel(adapterName string, row map[string]any, fallback string) string {
	account := first(row, "account_name", "accountName", "user_name", "userName", "username", "login_name", "group_name", "teamName", "belongUserName")
	if account == "" {
		return fallback
	}
	prefix := map[string]string{"zhanfu": "站斧", "bitbrowser": "BitBrowser", "adspower": "AdsPower"}[adapterName]
	return prefix + "-" + account
}

func adsPowerAPIKey(cfg map[string]any) string {
	for _, key := range []string{"api_key", "apiKey"} {
		value := strings.TrimSpace(stringValue(cfg, key, ""))
		if value != "" {
			return value
		}
	}
	envName := strings.TrimSpace(stringValue(cfg, "api_key_env", ""))
	if envName != "" {
		return strings.TrimSpace(os.Getenv(envName))
	}
	return ""
}

func adsPowerHeaders(apiKey string) map[string]string {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + strings.TrimSpace(apiKey)}
}

func postJSON(url string, payload any, out any, timeout int) error {
	if err := ensureLocalHTTPURL(url); err != nil {
		return err
	}
	raw, _ := json.Marshal(payload)
	client := http.Client{Timeout: time.Duration(timeout) * time.Second}
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json;charset=utf-8")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func getJSON(url string, params map[string]string, out any, timeout int) error {
	return getJSONWithHeaders(url, params, nil, out, timeout)
}

func getJSONWithHeaders(url string, params map[string]string, headers map[string]string, out any, timeout int) error {
	if err := ensureLocalHTTPURL(url); err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	q := req.URL.Query()
	for key, value := range params {
		q.Set(key, value)
	}
	req.URL.RawQuery = q.Encode()
	req.Header.Set("Accept", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := http.Client{Timeout: time.Duration(timeout) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func unwrapZhanfu(value any) (any, error) {
	obj := asMap(value)
	if len(obj) == 0 {
		return value, nil
	}
	ret := fmt.Sprint(obj["ret"])
	if obj["ret"] != nil && ret != "200" {
		return nil, fmt.Errorf("站斧返回异常: %v", obj)
	}
	returnObj, ok := obj["returnObj"]
	if !ok {
		return obj, nil
	}
	returnMap := asMap(returnObj)
	if success, ok := returnMap["success"].(bool); ok && !success {
		return nil, fmt.Errorf("%v", returnMap["msg"])
	}
	if data, ok := returnMap["data"]; ok {
		return data, nil
	}
	return returnObj, nil
}

func extractWebdriverInfo(flat map[string]any) (string, string) {
	var webdriverURL string
	var debuggerAddress string
	for key, value := range flat {
		keyLower := strings.ToLower(strings.ReplaceAll(key, ".", ""))
		valueString := scalarString(value)
		normalizedDebugger := normalizeDebuggerAddress(valueString)
		switch {
		case strings.Contains(keyLower, "webdriver") && strings.HasPrefix(valueString, "http"):
			webdriverURL = valueString
			if debuggerAddress == "" {
				debuggerAddress = normalizeDebuggerAddress(valueString)
			}
		case strings.Contains(keyLower, "webdriver") && onlyDigits(valueString):
			webdriverURL = "http://127.0.0.1:" + valueString
			if debuggerAddress == "" {
				debuggerAddress = "127.0.0.1:" + valueString
			}
		case (keyLower == "http" || strings.HasSuffix(keyLower, "http")) && normalizedDebugger != "":
			debuggerAddress = normalizedDebugger
			webdriverURL = "http://" + normalizedDebugger
		case (keyLower == "ws" || strings.HasSuffix(keyLower, "ws") || strings.Contains(keyLower, "websocket")) && normalizedDebugger != "":
			debuggerAddress = normalizedDebugger
			if webdriverURL == "" {
				webdriverURL = "http://" + normalizedDebugger
			}
		case (keyLower == "port" || keyLower == "webdriverport" || keyLower == "seleniumport") && onlyDigits(valueString):
			webdriverURL = "http://127.0.0.1:" + valueString
			if debuggerAddress == "" {
				debuggerAddress = "127.0.0.1:" + valueString
			}
		case (keyLower == "debuggeraddress" || keyLower == "debugaddress" || keyLower == "debuggingaddress") && normalizedDebugger != "":
			debuggerAddress = normalizedDebugger
			if webdriverURL == "" {
				webdriverURL = "http://" + normalizedDebugger
			}
		case strings.Contains(keyLower, "debug") && strings.Contains(keyLower, "port") && onlyDigits(valueString):
			debuggerAddress = "127.0.0.1:" + valueString
			if webdriverURL == "" {
				webdriverURL = "http://" + debuggerAddress
			}
		}
	}
	return webdriverURL, debuggerAddress
}

func extractAdsPowerConnection(row map[string]any) (string, string) {
	debuggerAddress := adsPowerDebuggerAddress(row)
	if debuggerAddress == "" {
		return "", ""
	}
	return "http://" + strings.TrimPrefix(strings.TrimPrefix(debuggerAddress, "http://"), "https://"), strings.TrimPrefix(strings.TrimPrefix(debuggerAddress, "http://"), "https://")
}

func adsPowerDebuggerAddress(row map[string]any) string {
	for _, key := range []string{"debug_ws", "debuggerAddress", "websocket", "debugger_address"} {
		if normalized := normalizeDebuggerAddress(scalarString(row[key])); normalized != "" {
			return normalized
		}
	}
	if ws := asMap(row["ws"]); len(ws) > 0 {
		for _, key := range []string{"selenium", "puppeteer", "debugger", "ws"} {
			if normalized := normalizeDebuggerAddress(scalarString(ws[key])); normalized != "" {
				return normalized
			}
		}
	}
	if normalized := normalizeDebuggerAddress(scalarString(row["ws"])); normalized != "" {
		return normalized
	}
	for _, key := range []string{"debug_port", "debugPort", "webdriver_port", "webdriverPort", "selenium_port", "seleniumPort"} {
		if normalized := normalizeDebuggerAddress(scalarString(row[key])); normalized != "" {
			return normalized
		}
	}
	return ""
}

func normalizeDebuggerAddress(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "<nil>" {
		return ""
	}
	for _, prefix := range []string{"ws://", "wss://", "http://", "https://"} {
		if strings.HasPrefix(value, prefix) {
			value = strings.TrimPrefix(value, prefix)
			break
		}
	}
	value = strings.SplitN(value, "/", 2)[0]
	value = strings.TrimPrefix(strings.TrimPrefix(value, "http://"), "https://")
	if onlyDigits(value) {
		return "127.0.0.1:" + value
	}
	if _, _, err := net.SplitHostPort(value); err == nil {
		return value
	}
	return ""
}

func attachProcessDebugBrowser(shop appcore.Shop, log logger) (appcore.OpenResult, error) {
	processes := runningDebugBrowserProcesses()
	portOwners := debugPortOwners(processes)
	for _, process := range processes {
		name := strings.ToLower(fmt.Sprint(process["Name"]))
		commandLine := fmt.Sprint(process["CommandLine"])
		if !debugProcessAllowed(name, commandLine) {
			continue
		}
		portText := commandLineOption(commandLine, "remote-debugging-port")
		if !onlyDigits(portText) {
			continue
		}
		webdriverURL := "http://127.0.0.1:" + portText
		if !devtoolsAvailable(webdriverURL) {
			continue
		}
		matchSource := ""
		if debugProcessMatchesShop(commandLine, shop) {
			matchSource = "process_command_line"
		} else if owner := portOwners[portText]; owner != "" && owner != strings.TrimSpace(shop.MallID) {
			continue
		} else if processTargetsMatchShop(webdriverURL, shop, log) {
			matchSource = "process_target_match"
		} else {
			continue
		}
		if log != nil {
			log.Append("adapter.attach.process_debug.ok", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "port": portText, "source": matchSource})
		}
		return appcore.OpenResult{
			MallID:          shop.MallID,
			ShopName:        shop.DisplayName,
			WebDriverURL:    webdriverURL,
			DebuggerAddress: "127.0.0.1:" + portText,
			AdapterName:     shop.AdapterName,
			AdapterInstance: shop.AdapterInstance,
			WebDriverRaw:    map[string]any{"pid": process["ProcessId"], "name": process["Name"], "source": "process_debug_port"},
		}, nil
	}
	return appcore.OpenResult{}, fmt.Errorf("没有在本机进程中找到该店铺的 DevTools 端口")
}

func openProcessDebugIDs(shops []appcore.Shop, log logger) map[string]bool {
	open := map[string]bool{}
	processes := runningDebugBrowserProcesses()
	if len(processes) == 0 {
		return open
	}
	portOwners := debugPortOwners(processes)
	targetCache := map[string][]cdp.Target{}
	for _, shop := range shops {
		for _, process := range processes {
			name := strings.ToLower(fmt.Sprint(process["Name"]))
			commandLine := fmt.Sprint(process["CommandLine"])
			if !debugProcessAllowed(name, commandLine) {
				continue
			}
			portText := commandLineOption(commandLine, "remote-debugging-port")
			if !onlyDigits(portText) || !devtoolsAvailable("http://127.0.0.1:"+portText) {
				continue
			}
			webdriverURL := "http://127.0.0.1:" + portText
			matched := debugProcessMatchesShop(commandLine, shop)
			if !matched {
				if owner := portOwners[portText]; owner != "" && owner != strings.TrimSpace(shop.MallID) {
					continue
				}
				targets, ok := targetCache[webdriverURL]
				if !ok {
					var err error
					targets, err = cdp.ListTargets(webdriverURL, time.Second)
					if err != nil {
						targets = nil
					}
					targetCache[webdriverURL] = targets
				}
				matched = targetsMatchShop(targets, shop)
			}
			if !matched {
				continue
			}
			open[shop.AdapterInstance+"|"+shop.MallID] = true
			if log != nil {
				log.Append("adapter.open_status.process_debug", map[string]any{"adapter": shop.AdapterName, "shop": shop.DisplayName, "mall_id": shop.MallID, "port": portText})
			}
			break
		}
	}
	return open
}

func debugPortOwners(processes []map[string]any) map[string]string {
	owners := map[string]string{}
	for _, process := range processes {
		commandLine := fmt.Sprint(process["CommandLine"])
		portText := commandLineOption(commandLine, "remote-debugging-port")
		browserID := commandLineOption(commandLine, "browser_id")
		if !onlyDigits(portText) || strings.TrimSpace(browserID) == "" {
			continue
		}
		owners[portText] = strings.TrimSpace(browserID)
	}
	return owners
}

func processTargetsMatchShop(webdriverURL string, shop appcore.Shop, log logger) bool {
	targets, err := cdp.ListTargets(webdriverURL, time.Second)
	if err != nil {
		if log != nil {
			log.Append("adapter.attach.process_targets.failed", map[string]any{"shop": shop.DisplayName, "mall_id": shop.MallID, "webdriver_url": webdriverURL, "error": err.Error()})
		}
		return false
	}
	return targetsMatchShop(targets, shop)
}

func targetsMatchShop(targets []cdp.Target, shop appcore.Shop) bool {
	for _, target := range targets {
		lower := strings.ToLower(target.URL + " " + target.Title)
		if !strings.Contains(lower, "admin.shopify.com/store/") && !strings.Contains(lower, "inbox.shopify.com/store/") {
			continue
		}
		if cdp.TargetMatchesShop(target, shop.DisplayName) {
			return true
		}
	}
	return false
}

func runningDebugBrowserProcesses() []map[string]any {
	script := "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'remote-debugging-port' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 3"
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	winexec.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return nil
	}
	var payload any
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil
	}
	var rows []map[string]any
	switch typed := payload.(type) {
	case []any:
		for _, item := range typed {
			if row := asMap(item); len(row) > 0 {
				rows = append(rows, row)
			}
		}
	case map[string]any:
		rows = append(rows, typed)
	}
	return rows
}

func debugProcessAllowed(processName string, commandLine string) bool {
	text := strings.ToLower(processName + " " + commandLine)
	for _, token := range []string{"msedge", "edge", "brave", "vivaldi", "opera", "sunbrowser", "hubstudio"} {
		if strings.Contains(text, token) {
			return true
		}
	}
	for _, token := range []string{"zhanfu", "zhanfubrowser", "bitbrowser", "比特", "adspower", "chrome", "chromium"} {
		if strings.Contains(text, strings.ToLower(token)) {
			return true
		}
	}
	return false
}

func debugProcessMatchesShop(commandLine string, shop appcore.Shop) bool {
	id := strings.TrimSpace(shop.MallID)
	if id == "" {
		return false
	}
	text := strings.ToLower(commandLine)
	idLower := strings.ToLower(id)
	switch shop.AdapterName {
	case "zhanfu":
		return strings.Contains(text, "--browser_id="+idLower) ||
			strings.Contains(text, "browser_id="+idLower) ||
			strings.Contains(text, "\\userfile\\"+idLower+"\\")
	default:
		return strings.Contains(text, idLower)
	}
}

func processCommandLine(pid int) string {
	cmd := exec.Command("powershell", "-NoProfile", "-Command", fmt.Sprintf("Get-CimInstance Win32_Process -Filter \"ProcessId=%d\" | Select-Object -ExpandProperty CommandLine", pid))
	winexec.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func commandLineOption(commandLine string, name string) string {
	re := regexp.MustCompile(`--` + regexp.QuoteMeta(name) + `(?:=|\s+)(?:"([^"]+)"|([^"\s]+))`)
	match := re.FindStringSubmatch(commandLine)
	if len(match) == 0 {
		return ""
	}
	if match[1] != "" {
		return match[1]
	}
	return match[2]
}

func devtoolsPortFromDir(dir string) int {
	if dir == "" {
		return 0
	}
	raw, err := os.ReadFile(filepath.Join(dir, "DevToolsActivePort"))
	if err != nil {
		return 0
	}
	line := strings.TrimSpace(strings.SplitN(string(raw), "\n", 2)[0])
	port, _ := strconv.Atoi(line)
	return port
}

func devtoolsAvailable(webdriverURL string) bool {
	if ensureLocalHTTPURL(webdriverURL) != nil {
		return false
	}
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(strings.TrimRight(webdriverURL, "/") + "/json/list")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode < 400
}

func waitForDevtools(webdriverURL string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if devtoolsAvailable(webdriverURL) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(750 * time.Millisecond)
	}
}

func ensureLocalHTTPURL(rawURL string) error {
	parsed, err := neturl.Parse(rawURL)
	if err != nil {
		return err
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
	default:
		return fmt.Errorf("blocked non-http browser endpoint: %s", parsed.Scheme)
	}
	host := parsed.Hostname()
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("blocked non-local browser endpoint: %s", host)
}

func portOpen(host string, port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func flatten(value any) map[string]any {
	out := map[string]any{}
	var walk func(prefix string, item any)
	walk = func(prefix string, item any) {
		switch typed := item.(type) {
		case map[string]any:
			for key, child := range typed {
				next := key
				if prefix != "" {
					next = prefix + "." + key
				}
				walk(next, child)
			}
		default:
			out[prefix] = typed
		}
	}
	walk("", value)
	return out
}

func asMap(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func successResponse(response map[string]any) bool {
	return response["success"] == true || fmt.Sprint(response["success"]) == "true"
}

func first(row map[string]any, keys ...string) string {
	for _, key := range keys {
		value := scalarString(row[key])
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func stringValue(row map[string]any, key string, fallback string) string {
	if row == nil || row[key] == nil || scalarString(row[key]) == "" {
		return fallback
	}
	return scalarString(row[key])
}

func scalarString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		value64 := float64(typed)
		if value64 == float64(int64(value64)) {
			return strconv.FormatInt(int64(value64), 10)
		}
		return strconv.FormatFloat(value64, 'f', -1, 32)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func intValue(row map[string]any, key string, fallback int) int {
	if row == nil || row[key] == nil {
		return fallback
	}
	return intFromAny(row[key])
}

func boolValue(row map[string]any, key string, fallback bool) bool {
	if row == nil || row[key] == nil {
		return fallback
	}
	switch typed := row[key].(type) {
	case bool:
		return typed
	case string:
		value := strings.ToLower(strings.TrimSpace(typed))
		return value == "true" || value == "1" || value == "yes"
	default:
		return fmt.Sprint(typed) == "1"
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		out, _ := strconv.Atoi(typed)
		return out
	default:
		return 0
	}
}

func onlyDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func mustJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func settingCopy(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func merge(base map[string]any, override map[string]any) map[string]any {
	for key, value := range override {
		base[key] = value
	}
	return base
}
