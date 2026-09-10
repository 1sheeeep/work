# Customer-service source provenance

This directory is an isolated source import of the existing Xzdesk
customer-service project.

- Source repository: `C:\Users\新知科技\Documents\客服助手`
- Source code commit: `2aa8cf4`
- Initial import date: `2026-07-29`
- Latest selective committed-source sync: `2026-08-21`
- Latest selectively imported source feature commit: `da4d85c`
- Latest source-difference audit: `2026-08-23` against source `18c1cc0`
- Target role: independently restartable customer-service bounded service inside
  the XZ ERP product repository

The import and subsequent sync intentionally exclude:

- the source repository's `.git` directory;
- `.env` and other ignored local configuration;
- the tracked real `shopify.app.toml`, environment examples and production
  deployment templates;
- logs, databases, runtime state, caches, attachments and generated release
  artifacts that were not part of the selected commit;
- all uncommitted source checkout changes;
- source build output during the latest sync; the ERP copy rebuilds its own
  embedded frontend assets from the imported source.

The 2026-08-21 sync selected the maintained production source changes for email
reliability, standard IMAP/SMTP mailboxes, asynchronous email outbox and export
jobs, operational conversation queries, Shopify order synchronization queues,
resource-efficient real-time updates, and their tests. Source migrations
`047`-`058` were imported as ERP-copy migrations `048`-`059` because this copy
already owns `047_visitor_scheme_widget_settings.sql`.

The 2026-08-23 source-difference audit found two maintained feature slices after
the selected sync point: workbench paste-to-send images (`21e3b79`) and email
statistics attachment archives (`da4d85c`). Both feature slices have been
independently reviewed, selectively imported and rebuilt without production data
or runtime state. Their production release-note commits remain evidence rather
than code to copy. This audit also restored the production Theme App Extension's
merchant-facing appearance and featured-product settings after an ERP-only
centralization had removed them. ERP tenant routing remains an intentional local
adaptation, while customer-service visitor schemes no longer duplicate theme
appearance settings.

No production database connection, dump, volume, row, attachment, runtime state
or other production data was read, copied or migrated. Database validation uses
only a fresh disposable local PostgreSQL container with synthetic credentials
and an in-memory data directory.

The ERP copy keeps its own tenant isolation, one-time ERP entry, WebSocket
ticket, `customer_service` schema and bounded roles, unified public Shopify App,
Connector ownership, exact ten-scope review boundary and metadata-only dispute
workflow when those differ from the source repository. It intentionally does
not import the source project's separate Shopify App deployment/credential
ownership. The source repository is a reference only and is not an upstream
runtime, database or deployment.

The original repository and production system remain unchanged. Changes in this
directory apply only to the imported ERP copy. Production credentials, data,
deployment and traffic cutover require separate explicit authorization.

The tracked `frontend/dist` directory from the selected commit is included
because the Go entry point embeds it at compile time. It is treated as a
reproducible release asset and must be rebuilt from the imported frontend before
future release commits.
