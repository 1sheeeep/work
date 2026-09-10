package migration

import shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"

type Snapshot struct {
	Records []shopifyinstallations.LegacyInstallationImport
}

func (Snapshot) String() string     { return "legacySnapshot{records=[REDACTED]}" }
func (s Snapshot) GoString() string { return s.String() }

func (s *Snapshot) Destroy() {
	if s == nil {
		return
	}
	for index := range s.Records {
		s.Records[index].AccessToken = ""
		s.Records[index].Scopes = nil
	}
	s.Records = nil
}
