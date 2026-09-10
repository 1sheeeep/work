# Customer-service Runtime Safety Boundaries

These boundaries protect real accounts, credentials and browser environments.
Product scope is governed by
[`../docs/locked-product-scope-boundaries.md`](../docs/locked-product-scope-boundaries.md).

## Browser Session Safety

- Browser-automated Shopify Inbox, email, customer, order, and source-page actions must stay inside the user-selected browser session.
- Shopify Admin API access belongs to the shared XZ ERP connector. The customer-service service must not own or receive Shopify access tokens.
- The backend must not make direct HTTP requests to Shopify Inbox, Gmail, Outlook, Fastmo, customer pages, order pages, tracking pages, or any other business page outside an explicitly implemented and authorized server-side API channel.
- DevTools/CDP connections are allowed only through local loopback endpoints: `127.0.0.1`, `localhost`, or `::1`.
- Local browser control APIs for Zhanfu, BitBrowser, and AdsPower are allowed only through loopback endpoints.
- If a configured DevTools or browser API endpoint is not local loopback, the software must fail closed and show an actionable error.
- The software must not read cookies, call Shopify APIs from the frontend or browser automation, change browser identity parameters, proxy settings, user agents, extensions, or login state.
- The software must not auto-login. Users must open and authenticate browser sessions themselves.
- Background execution must preserve the same browser environment. It may automate only the matched local browser session.
- Opening or foregrounding a source page must match the shop, URL, customer, and email when available. If the match is unstable, fail instead of raising a wrong window.
- Sending must validate the current page, customer, latest message, recipient, and editable target before any final send action.

## AI Boundary

- AI provider requests are separate from browser automation and may use the configured AI endpoint.
- AI requests must not include browser cookies, browser identity data, proxy details, local DevTools URLs, or private browser session state.
- AI API keys must come from the local user configuration or environment variables, never from packaged defaults.
