//go:build !windows

package winexec

type BrowserOpenResult struct {
	ShopName        string
	WebDriverURL    string
	DebuggerAddress string
	OpenResponse    map[string]any
	WebDriverRaw    map[string]any
}

func BringBrowserToFront(openResult BrowserOpenResult, targetTitle string) error {
	return nil
}
