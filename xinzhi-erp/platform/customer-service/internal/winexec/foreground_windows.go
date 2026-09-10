//go:build windows

package winexec

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	swShow           = 5
	swRestore        = 9
	swpNoSize        = 0x0001
	swpNoMove        = 0x0002
	swpShowWindow    = 0x0040
	hwndTopMost      = ^uintptr(0)
	hwndNoTopMost    = ^uintptr(1)
	browserMinScore  = 35
	maxTitleRunes    = 512
	maxClassNameRune = 128
)

var (
	foregroundUser32             = syscall.NewLazyDLL("user32.dll")
	procEnumWindows              = foregroundUser32.NewProc("EnumWindows")
	procIsWindowVisible          = foregroundUser32.NewProc("IsWindowVisible")
	procIsIconic                 = foregroundUser32.NewProc("IsIconic")
	procGetWindowThreadProcessID = foregroundUser32.NewProc("GetWindowThreadProcessId")
	procGetWindowTextW           = foregroundUser32.NewProc("GetWindowTextW")
	procGetClassNameW            = foregroundUser32.NewProc("GetClassNameW")
	procShowWindow               = foregroundUser32.NewProc("ShowWindow")
	procSetForegroundWindow      = foregroundUser32.NewProc("SetForegroundWindow")
	procSetWindowPos             = foregroundUser32.NewProc("SetWindowPos")
)

type browserWindowCandidate struct {
	hwnd  uintptr
	pid   uint32
	title string
	class string
	score int
}

type BrowserOpenResult struct {
	ShopName        string
	WebDriverURL    string
	DebuggerAddress string
	OpenResponse    map[string]any
	WebDriverRaw    map[string]any
}

// BringBrowserToFront raises the browser that owns the current shop's DevTools
// endpoint, without leaving the browser permanently topmost.
func BringBrowserToFront(openResult BrowserOpenResult, targetTitle string) error {
	pids := browserPIDsForOpenResult(openResult)
	if len(pids) == 0 {
		return fmt.Errorf("无法确认当前店铺浏览器进程，已停止拉起窗口")
	}
	candidate, ok := bestBrowserWindow(pids, targetTitle, openResult.ShopName)
	if !ok {
		return fmt.Errorf("未找到当前店铺浏览器窗口，已停止拉起窗口")
	}
	if candidate.score < browserMinScore {
		return fmt.Errorf("未找到足够匹配的当前店铺浏览器窗口，已停止拉起窗口")
	}
	return raiseWindowOnce(candidate.hwnd)
}

func raiseWindowOnce(hwnd uintptr) error {
	if hwnd == 0 {
		return fmt.Errorf("浏览器窗口句柄为空，已停止拉起窗口")
	}
	if isIconic(hwnd) {
		procShowWindow.Call(hwnd, swRestore)
	} else {
		procShowWindow.Call(hwnd, swShow)
	}
	procSetForegroundWindow.Call(hwnd)
	if ok := setWindowTopmost(hwnd, hwndTopMost); !ok {
		return fmt.Errorf("浏览器窗口置顶拉起失败")
	}
	time.Sleep(80 * time.Millisecond)
	if ok := setWindowTopmost(hwnd, hwndNoTopMost); !ok {
		time.Sleep(80 * time.Millisecond)
		if retryOK := setWindowTopmost(hwnd, hwndNoTopMost); !retryOK {
			return fmt.Errorf("浏览器窗口已拉起，但取消临时置顶失败")
		}
	}
	procSetForegroundWindow.Call(hwnd)
	return nil
}

func setWindowTopmost(hwnd uintptr, insertAfter uintptr) bool {
	ret, _, _ := procSetWindowPos.Call(hwnd, insertAfter, 0, 0, 0, 0, swpNoMove|swpNoSize|swpShowWindow)
	return ret != 0
}

func bestBrowserWindow(pids map[uint32]bool, targetTitle string, shopName string) (browserWindowCandidate, bool) {
	windows := enumTopLevelWindows(pids)
	if len(windows) == 0 {
		return browserWindowCandidate{}, false
	}
	best := windows[0]
	best.score = scoreBrowserWindow(best, targetTitle, shopName)
	for _, candidate := range windows[1:] {
		candidate.score = scoreBrowserWindow(candidate, targetTitle, shopName)
		if candidate.score > best.score {
			best = candidate
		}
	}
	return best, true
}

func scoreBrowserWindow(candidate browserWindowCandidate, targetTitle string, shopName string) int {
	score := 0
	classNorm := strings.ToLower(candidate.class)
	titleNorm := normalizeText(candidate.title)
	if strings.Contains(classNorm, "chrome_widgetwin") {
		score += 40
	} else if strings.Contains(classNorm, "chrome") || strings.Contains(classNorm, "chromium") {
		score += 20
	}
	if strings.TrimSpace(candidate.title) != "" {
		score += 10
	}
	if hint := normalizeText(targetTitle); len(hint) >= 4 && strings.Contains(titleNorm, hint) {
		score += 70
	}
	if shop := normalizeText(shopName); len(shop) >= 4 && strings.Contains(titleNorm, shop) {
		score += 25
	}
	return score
}

func enumTopLevelWindows(pids map[uint32]bool) []browserWindowCandidate {
	var windows []browserWindowCandidate
	callback := syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
		if !isWindowVisible(hwnd) {
			return 1
		}
		pid := windowPID(hwnd)
		if !pids[pid] {
			return 1
		}
		windows = append(windows, browserWindowCandidate{
			hwnd:  hwnd,
			pid:   pid,
			title: windowText(hwnd),
			class: windowClass(hwnd),
		})
		return 1
	})
	procEnumWindows.Call(callback, 0)
	return windows
}

func browserPIDsForOpenResult(openResult BrowserOpenResult) map[uint32]bool {
	out := map[uint32]bool{}
	debugPort := debugPortFromOpenResult(openResult)
	collectPIDs(openResult.WebDriverRaw, out)
	collectPIDs(openResult.OpenResponse, out)
	if debugPort != "" {
		for pid := range out {
			commandLine := processCommandLineForPID(pid)
			if commandLine != "" && commandLineDebugPort(commandLine) != "" && commandLineDebugPort(commandLine) != debugPort {
				delete(out, pid)
			}
		}
		for _, pid := range processIDsForDebugPort(debugPort) {
			out[pid] = true
		}
	}
	return out
}

func collectPIDs(value any, out map[uint32]bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			keyNorm := strings.ToLower(strings.ReplaceAll(key, "_", ""))
			if keyNorm == "pid" || keyNorm == "processid" || keyNorm == "browserpid" {
				if pid := uint32FromAny(item); pid > 0 {
					out[pid] = true
				}
				continue
			}
			collectPIDs(item, out)
		}
	case []any:
		for _, item := range typed {
			collectPIDs(item, out)
		}
	}
}

func processIDsForDebugPort(debugPort string) []uint32 {
	if debugPort == "" {
		return nil
	}
	rows := runningDebugProcesses()
	var out []uint32
	for _, row := range rows {
		commandLine := fmt.Sprint(row["CommandLine"])
		if commandLineDebugPort(commandLine) != debugPort {
			continue
		}
		if pid := uint32FromAny(row["ProcessId"]); pid > 0 {
			out = append(out, pid)
		}
	}
	return out
}

func runningDebugProcesses() []map[string]any {
	script := "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'remote-debugging-port' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3"
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	HideWindow(cmd)
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
			if row, ok := item.(map[string]any); ok {
				rows = append(rows, row)
			}
		}
	case map[string]any:
		rows = append(rows, typed)
	}
	return rows
}

func processCommandLineForPID(pid uint32) string {
	if pid == 0 {
		return ""
	}
	script := fmt.Sprintf("Get-CimInstance Win32_Process -Filter \"ProcessId=%d\" | Select-Object -ExpandProperty CommandLine", pid)
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func debugPortFromOpenResult(openResult BrowserOpenResult) string {
	for _, raw := range []string{openResult.DebuggerAddress, openResult.WebDriverURL} {
		if port := debugPortFromAddress(raw); port != "" {
			return port
		}
	}
	return ""
}

func debugPortFromAddress(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	for _, prefix := range []string{"ws://", "wss://", "http://", "https://"} {
		if strings.HasPrefix(raw, prefix) {
			if parsed, err := url.Parse(raw); err == nil {
				return parsed.Port()
			}
		}
	}
	raw = strings.SplitN(raw, "/", 2)[0]
	if _, port, err := net.SplitHostPort(raw); err == nil {
		return port
	}
	if onlyDigits(raw) {
		return raw
	}
	return ""
}

func commandLineDebugPort(commandLine string) string {
	return commandLineOption(commandLine, "remote-debugging-port")
}

func commandLineOption(commandLine string, name string) string {
	re := regexp.MustCompile(`--` + regexp.QuoteMeta(name) + `(?:=|\s+)(?:"([^"]+)"|([^"\s]+))`)
	match := re.FindStringSubmatch(commandLine)
	if len(match) == 0 {
		return ""
	}
	if match[1] != "" {
		return strings.TrimSpace(match[1])
	}
	return strings.TrimSpace(match[2])
}

func isWindowVisible(hwnd uintptr) bool {
	ret, _, _ := procIsWindowVisible.Call(hwnd)
	return ret != 0
}

func isIconic(hwnd uintptr) bool {
	ret, _, _ := procIsIconic.Call(hwnd)
	return ret != 0
}

func windowPID(hwnd uintptr) uint32 {
	var pid uint32
	procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	return pid
}

func windowText(hwnd uintptr) string {
	buf := make([]uint16, maxTitleRunes)
	ret, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if ret == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:ret])
}

func windowClass(hwnd uintptr) string {
	buf := make([]uint16, maxClassNameRune)
	ret, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if ret == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:ret])
}

func uint32FromAny(value any) uint32 {
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			return uint32(typed)
		}
	case int32:
		if typed > 0 {
			return uint32(typed)
		}
	case int64:
		if typed > 0 {
			return uint32(typed)
		}
	case uint32:
		return typed
	case uint64:
		if typed > 0 {
			return uint32(typed)
		}
	case float64:
		if typed > 0 {
			return uint32(typed)
		}
	case json.Number:
		if n, err := typed.Int64(); err == nil && n > 0 {
			return uint32(n)
		}
	case string:
		if n, err := strconv.ParseUint(strings.TrimSpace(typed), 10, 32); err == nil && n > 0 {
			return uint32(n)
		}
	}
	return 0
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

func normalizeText(value string) string {
	var b strings.Builder
	for _, ch := range strings.ToLower(value) {
		if ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch >= 0x4e00 && ch <= 0x9fff {
			b.WriteRune(ch)
		}
	}
	return b.String()
}
