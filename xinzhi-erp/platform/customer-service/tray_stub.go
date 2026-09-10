//go:build !windows

package main

type noopTrayController struct{}

func newTrayController(_ *App) trayController {
	return noopTrayController{}
}

func (noopTrayController) Start() {}

func (noopTrayController) Stop() {}
