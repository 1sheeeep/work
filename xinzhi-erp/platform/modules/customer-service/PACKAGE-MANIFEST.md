# Closed-loop package contents

The release archive contains two source roots:

- `customer-service-module/`: portable backend services, React frontend,
  permission manifest, tests and host-integration guide.
- `shopify-connector/`: the complete `internal/connectors/shopify` source slice
  plus its current Go module files. This is the credential-owning server-side
  adapter used by the portable module.

The archive intentionally excludes dependency folders, compiled output,
coverage, environment files, credentials and any Shopify application
configuration. It does not authorize or install an application.

Verification commands are documented in `INTEGRATION.md`. The Connector slice
can be verified from its root with:

```powershell
go test ./internal/connectors/shopify/...
```
