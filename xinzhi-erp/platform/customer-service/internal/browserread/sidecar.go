package browserread

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/cdp"
	"shopify-support-platform/internal/winexec"
)

type Logger interface {
	Append(event string, details any)
}

var ErrInterrupted = errors.New("playwright sidecar interrupted")

var activeSidecars = struct {
	sync.Mutex
	processes map[int]*os.Process
	killed    map[int]string
}{
	processes: map[int]*os.Process{},
	killed:    map[int]string{},
}

type Request struct {
	Action                   string   `json:"action"`
	CDPURL                   string   `json:"cdpUrl"`
	ShopName                 string   `json:"shopName,omitempty"`
	MailAccount              string   `json:"mailAccount,omitempty"`
	MailAccountManual        bool     `json:"mailAccountManual,omitempty"`
	ActivateTarget           bool     `json:"activateTarget"`
	ForceRefresh             bool     `json:"forceRefresh,omitempty"`
	IgnoredEmailFingerprints []string `json:"ignoredEmailFingerprints,omitempty"`
	EmailScanCutoff          string   `json:"emailScanCutoff,omitempty"`
}

type responseEnvelope struct {
	OK    bool            `json:"ok"`
	Error string          `json:"error,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
}

func ReadInbox(ctx context.Context, openResult appcore.OpenResult, shop appcore.Shop, activate bool, forceRefresh bool, log Logger) (appcore.InboxResult, error) {
	var result appcore.InboxResult
	if err := call(ctx, Request{
		Action:         "readInbox",
		CDPURL:         openResult.WebDriverURL,
		ShopName:       shop.DisplayName,
		ActivateTarget: activate,
		ForceRefresh:   forceRefresh,
	}, &result, log); err != nil {
		return appcore.InboxResult{}, err
	}
	return result, nil
}

func ProbeEmail(ctx context.Context, openResult appcore.OpenResult, mailAccount string, mailAccountManual bool, ignoredEmailFingerprints []string, emailScanCutoff string, activate bool, log Logger) (appcore.InboxResult, error) {
	var result appcore.InboxResult
	if err := call(ctx, Request{
		Action:                   "probeEmail",
		CDPURL:                   openResult.WebDriverURL,
		ShopName:                 openResult.ShopName,
		MailAccount:              mailAccount,
		MailAccountManual:        mailAccountManual,
		ActivateTarget:           activate,
		IgnoredEmailFingerprints: ignoredEmailFingerprints,
		EmailScanCutoff:          emailScanCutoff,
	}, &result, log); err != nil {
		return appcore.InboxResult{}, err
	}
	return result, nil
}

func call(ctx context.Context, req Request, out any, log Logger) error {
	if strings.TrimSpace(req.CDPURL) == "" {
		return errors.New("missing DevTools address")
	}
	if err := cdp.EnsureLoopbackEndpoint(req.CDPURL); err != nil {
		return err
	}
	nodePath, scriptPath, err := resolveRuntime()
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(req)
	cmd := exec.Command(nodePath, scriptPath)
	winexec.HideWindow(cmd)
	cmd.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.Env = append(os.Environ(),
		"PLAYWRIGHT_BROWSERS_PATH=0",
		"SHOPIFY_AI_ASSISTANT_SIDE_CAR=1",
	)
	start := time.Now()
	if log != nil {
		log.Append("browserread.sidecar.start", map[string]any{"action": req.Action, "script": scriptPath})
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	registerSidecarProcess(pid, cmd.Process)
	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()
	var runErr error
	select {
	case runErr = <-waitCh:
	case <-ctx.Done():
		killSidecarProcessTree(pid, cmd.Process, "context_cancelled")
		runErr = <-waitCh
	}
	unregisterSidecarProcess(pid)
	if runErr != nil {
		if reason := sidecarKilledReason(pid); reason != "" {
			if log != nil {
				log.Append("browserread.sidecar.failed", map[string]any{"action": req.Action, "cdp_url": req.CDPURL, "elapsed_ms": time.Since(start).Milliseconds(), "reason": reason})
			}
			return fmt.Errorf("%w: %s", ErrInterrupted, reason)
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			if log != nil {
				log.Append("browserread.sidecar.failed", map[string]any{"action": req.Action, "cdp_url": req.CDPURL, "elapsed_ms": time.Since(start).Milliseconds(), "error": ctxErr.Error()})
			}
			return ctxErr
		}
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = strings.TrimSpace(stdout.String())
		}
		if detail == "" {
			detail = runErr.Error()
		}
		if log != nil {
			log.Append("browserread.sidecar.failed", map[string]any{"action": req.Action, "cdp_url": req.CDPURL, "elapsed_ms": time.Since(start).Milliseconds(), "error": detail})
		}
		return fmt.Errorf("playwright sidecar failed: %s", detail)
	}
	var envelope responseEnvelope
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil {
		return fmt.Errorf("playwright sidecar returned invalid JSON: %w", err)
	}
	if !envelope.OK {
		if envelope.Error == "" {
			envelope.Error = "playwright sidecar failed"
		}
		if log != nil {
			log.Append("browserread.sidecar.failed", map[string]any{"action": req.Action, "cdp_url": req.CDPURL, "elapsed_ms": time.Since(start).Milliseconds(), "error": envelope.Error})
		}
		return errors.New(envelope.Error)
	}
	if out != nil {
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			return fmt.Errorf("playwright sidecar data decode failed: %w", err)
		}
	}
	if log != nil {
		log.Append("browserread.sidecar.ok", map[string]any{"action": req.Action, "elapsed_ms": time.Since(start).Milliseconds()})
	}
	return nil
}

func KillActiveSidecars(reason string) int {
	activeSidecars.Lock()
	items := make(map[int]*os.Process, len(activeSidecars.processes))
	for pid, process := range activeSidecars.processes {
		items[pid] = process
		activeSidecars.killed[pid] = reason
	}
	activeSidecars.Unlock()
	for pid, process := range items {
		killSidecarProcessTree(pid, process, reason)
	}
	return len(items)
}

func IsInterrupted(err error) bool {
	return errors.Is(err, ErrInterrupted)
}

func IsCDPConnectFailure(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "cdp_handshake_timeout") ||
		strings.Contains(message, "cdp_http_version_unavailable") ||
		strings.Contains(message, "cdp_http_list_unavailable") ||
		strings.Contains(message, "cdp_http_list_invalid") ||
		strings.Contains(message, "cdp_no_targets") {
		return true
	}
	if strings.Contains(message, "connectovercdp") ||
		strings.Contains(message, "cdp connection failed") ||
		strings.Contains(message, "browsertype.connectovercdp") {
		return true
	}
	if strings.Contains(message, "devtools") && (strings.Contains(message, "timeout") || strings.Contains(message, "unavailable") || strings.Contains(message, "connection")) {
		return true
	}
	return strings.Contains(message, "econnrefused") ||
		strings.Contains(message, "econnreset") ||
		strings.Contains(message, "econnaborted") ||
		strings.Contains(message, "etimedout") ||
		strings.Contains(message, "socket hang up")
}

func registerSidecarProcess(pid int, process *os.Process) {
	activeSidecars.Lock()
	activeSidecars.processes[pid] = process
	activeSidecars.Unlock()
}

func unregisterSidecarProcess(pid int) {
	activeSidecars.Lock()
	delete(activeSidecars.processes, pid)
	activeSidecars.Unlock()
}

func sidecarKilledReason(pid int) string {
	activeSidecars.Lock()
	defer activeSidecars.Unlock()
	reason := activeSidecars.killed[pid]
	delete(activeSidecars.killed, pid)
	return reason
}

func killSidecarProcessTree(pid int, process *os.Process, reason string) {
	if pid <= 0 {
		return
	}
	activeSidecars.Lock()
	activeSidecars.killed[pid] = reason
	activeSidecars.Unlock()
	if runtime.GOOS == "windows" {
		cmd := exec.Command("taskkill", "/PID", fmt.Sprint(pid), "/T", "/F")
		winexec.HideWindow(cmd)
		_ = cmd.Run()
		return
	}
	if process != nil {
		_ = process.Kill()
	}
}

func resolveRuntime() (string, string, error) {
	script, err := resolveScript()
	if err != nil {
		return "", "", err
	}
	node, err := resolveNode()
	if err != nil {
		return "", "", err
	}
	return node, script, nil
}

func resolveScript() (string, error) {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "sidecar", "playwright-reader", "reader.mjs"),
			filepath.Join(filepath.Dir(exeDir), "sidecar", "playwright-reader", "reader.mjs"),
		)
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "sidecar", "playwright-reader", "reader.mjs"),
			filepath.Join(filepath.Dir(cwd), "sidecar", "playwright-reader", "reader.mjs"),
		)
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("playwright sidecar script not found")
}

func resolveNode() (string, error) {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "runtime", "node", "node.exe"),
			filepath.Join(filepath.Dir(exeDir), "runtime", "node", "node.exe"),
		)
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "runtime", "node", "node.exe"),
			filepath.Join(filepath.Dir(cwd), "runtime", "node", "node.exe"),
		)
	}
	candidates = append(candidates, "node.exe", "node")
	for _, candidate := range candidates {
		if strings.Contains(candidate, string(filepath.Separator)) {
			if fileExists(candidate) {
				return candidate, nil
			}
			continue
		}
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errors.New("node runtime not found for playwright sidecar")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
