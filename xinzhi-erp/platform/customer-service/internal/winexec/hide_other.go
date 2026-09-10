//go:build !windows

package winexec

import "os/exec"

func HideWindow(cmd *exec.Cmd) {}
