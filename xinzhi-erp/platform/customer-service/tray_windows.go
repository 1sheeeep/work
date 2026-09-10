//go:build windows

package main

import (
	"os"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

const (
	wmClose         = 0x0010
	wmCommand       = 0x0111
	wmLButtonDblClk = 0x0203
	wmRButtonUp     = 0x0205
	wmApp           = 0x8000
	wmTrayIcon      = wmApp + 88

	nimAdd     = 0x00000000
	nimDelete  = 0x00000002
	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	idiApplication = 32512

	mfString       = 0x00000000
	mfSeparator    = 0x00000800
	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100

	trayCmdShow = 1001
	trayCmdHide = 1002
	trayCmdQuit = 1003
)

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	shell32             = syscall.NewLazyDLL("shell32.dll")
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	procRegisterClassEx = user32.NewProc("RegisterClassExW")
	procCreateWindowEx  = user32.NewProc("CreateWindowExW")
	procDefWindowProc   = user32.NewProc("DefWindowProcW")
	procDestroyWindow   = user32.NewProc("DestroyWindow")
	procPostQuitMessage = user32.NewProc("PostQuitMessage")
	procGetMessage      = user32.NewProc("GetMessageW")
	procTranslateMsg    = user32.NewProc("TranslateMessage")
	procDispatchMsg     = user32.NewProc("DispatchMessageW")
	procLoadIcon        = user32.NewProc("LoadIconW")
	procCreatePopupMenu = user32.NewProc("CreatePopupMenu")
	procAppendMenu      = user32.NewProc("AppendMenuW")
	procTrackPopupMenu  = user32.NewProc("TrackPopupMenu")
	procDestroyMenu     = user32.NewProc("DestroyMenu")
	procGetCursorPos    = user32.NewProc("GetCursorPos")
	procSetForeground   = user32.NewProc("SetForegroundWindow")
	procPostMessage     = user32.NewProc("PostMessageW")
	procShellNotifyIcon = shell32.NewProc("Shell_NotifyIconW")
	procExtractIcon     = shell32.NewProc("ExtractIconW")
	procGetModuleHandle = kernel32.NewProc("GetModuleHandleW")

	trayMu     sync.Mutex
	activeTray *windowsTrayController
)

type windowsTrayController struct {
	app  *App
	hwnd uintptr
	done chan struct{}
	once sync.Once
}

type point struct {
	x int32
	y int32
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type guid struct {
	data1 uint32
	data2 uint16
	data3 uint16
	data4 [8]byte
}

type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         guid
	hBalloonIcon     uintptr
}

func newTrayController(app *App) trayController {
	return &windowsTrayController{app: app, done: make(chan struct{})}
}

func (t *windowsTrayController) Start() {
	go t.run()
}

func (t *windowsTrayController) Stop() {
	t.once.Do(func() {
		if t.hwnd != 0 {
			procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(t.notifyData(t.hwnd))))
			procPostMessage.Call(t.hwnd, wmClose, 0, 0)
			<-t.done
		}
	})
}

func (t *windowsTrayController) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(t.done)

	className := utf16Ptr("XzdeskAgentTrayWindow")
	instance, _, _ := procGetModuleHandle.Call(0)
	wndProc := syscall.NewCallback(trayWndProc)
	wc := wndClassEx{
		cbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		lpfnWndProc:   wndProc,
		hInstance:     instance,
		lpszClassName: className,
	}
	procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	hwnd, _, _ := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr("Xzdesk Agent Tray"))),
		0,
		0, 0, 0, 0,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		return
	}
	t.hwnd = hwnd
	trayMu.Lock()
	activeTray = t
	trayMu.Unlock()

	procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(t.notifyData(hwnd))))
	defer func() {
		trayMu.Lock()
		if activeTray == t {
			activeTray = nil
		}
		trayMu.Unlock()
	}()

	var m msg
	for {
		ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		procTranslateMsg.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMsg.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func (t *windowsTrayController) notifyData(hwnd uintptr) *notifyIconData {
	nid := &notifyIconData{
		cbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		hWnd:             hwnd,
		uID:              1,
		uFlags:           nifMessage | nifIcon | nifTip,
		uCallbackMessage: wmTrayIcon,
		hIcon:            loadTrayIcon(),
	}
	copy(nid.szTip[:], syscall.StringToUTF16("Xzdesk Agent - running in background"))
	return nid
}

func loadTrayIcon() uintptr {
	if exe, err := os.Executable(); err == nil {
		if icon, _, _ := procExtractIcon.Call(0, uintptr(unsafe.Pointer(utf16Ptr(exe))), 0); icon > 1 {
			return icon
		}
	}
	hIcon, _, _ := procLoadIcon.Call(0, idiApplication)
	return hIcon
}

func trayWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmTrayIcon:
		switch uint32(lParam) {
		case wmLButtonDblClk:
			withActiveTray(func(t *windowsTrayController) { t.app.ShowMainWindow() })
			return 0
		case wmRButtonUp:
			showTrayMenu(hwnd)
			return 0
		}
	case wmCommand:
		switch int(wParam & 0xffff) {
		case trayCmdShow:
			withActiveTray(func(t *windowsTrayController) { t.app.ShowMainWindow() })
		case trayCmdHide:
			withActiveTray(func(t *windowsTrayController) { t.app.HideToTray() })
		case trayCmdQuit:
			withActiveTray(func(t *windowsTrayController) { t.app.QuitApp() })
		}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case 0x0002:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

func showTrayMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	appendMenu(menu, mfString, trayCmdShow, "打开主窗口")
	appendMenu(menu, mfString, trayCmdHide, "隐藏到托盘")
	procAppendMenu.Call(menu, mfSeparator, 0, 0)
	appendMenu(menu, mfString, trayCmdQuit, "退出")
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForeground.Call(hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(menu, tpmRightButton|tpmReturnCmd, uintptr(pt.x), uintptr(pt.y), 0, hwnd, 0)
	if cmd != 0 {
		trayWndProc(hwnd, wmCommand, cmd, 0)
	}
}

func appendMenu(menu uintptr, flags uintptr, id int, text string) {
	procAppendMenu.Call(menu, flags, uintptr(id), uintptr(unsafe.Pointer(utf16Ptr(text))))
}

func withActiveTray(fn func(*windowsTrayController)) {
	trayMu.Lock()
	tray := activeTray
	trayMu.Unlock()
	if tray != nil {
		fn(tray)
	}
}

func utf16Ptr(value string) *uint16 {
	ptr, _ := syscall.UTF16PtrFromString(value)
	return ptr
}
