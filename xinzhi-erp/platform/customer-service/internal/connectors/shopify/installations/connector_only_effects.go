package installations

import "context"

// ConnectorOnlyRevocationEffects is used only when the independent connector
// is the sole owner of Shopify credentials and no customer-service Shopify
// source or cache exists in the deployment. The lifecycle still clears the
// provider credential before this acknowledgement is recorded.
type ConnectorOnlyRevocationEffects struct{}

func NewConnectorOnlyRevocationEffects() *ConnectorOnlyRevocationEffects {
	return &ConnectorOnlyRevocationEffects{}
}

func (*ConnectorOnlyRevocationEffects) ApplyRevocation(context.Context, RevocationRecord) error {
	return nil
}

var _ RevocationEffects = (*ConnectorOnlyRevocationEffects)(nil)
