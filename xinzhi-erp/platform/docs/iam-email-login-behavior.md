# IAM email-or-phone login behavior

## Canonical identity

V42 introduced normalized business-email identities. V75 extends the same
identity model so tenant users and platform `SYSTEM_ADMIN` accounts can use a
business email or a phone number to log in. The user-facing login forms accept
one combined email-or-phone value.

Email is trimmed and lowercased with `Locale.ROOT`. Phone input removes spaces
and hyphens; a mainland China 11-digit mobile number is normalized to `+86`,
and other numbers must already satisfy E.164 (`+` followed by 8-15 digits).

The accepted business rule is intentionally narrower than full RFC email
syntax: total length is at most 254 characters, the local part is at most 64
characters and uses letters, digits, `.`, `_`, `%`, `+`, or `-`; dots cannot
lead, trail, or repeat; the domain contains at least two DNS-style labels.
PostgreSQL constraints and Java validation apply the same rule.

Tenant-user emails and phone numbers are unique within one tenant. The same
identity may exist in different tenants. `SYSTEM_ADMIN` emails and phone
numbers are globally unique.

## Legacy compatibility

V42 safely backfills only historical `username` values that already satisfy
the business email rule. Those values become lowercase `email` and the
`username` compatibility alias is rewritten to the same canonical value.
Migration fails closed if one tenant contains case-only duplicates that would
map to the same email.

Historical non-email usernames are not changed and keep `email = null`. They
remain accepted only through the deprecated `username` login field. No email is
invented for a legacy account, and application account-creation paths reject
new non-email identifiers.

During the frontend transition, responses retain `username`:

- email-backed account: `username` is exactly equal to normalized `email`;
- legacy account: `username` contains the old login identifier and `email` is
  `null`.

Login requests use `email` for email values. The deprecated `username` wire
field carries normalized phone values and remains the fallback for historical
usernames; sending both fields is rejected. New-account services require an
email, a phone number, or both and do not create a new arbitrary username.

## Member API fields

`POST /api/v1/iam/members` accepts:

```json
{
  "email": "employee@example.com",
  "phoneNumber": "+8613800138000",
  "displayName": "Employee",
  "initialPassword": "caller-supplied-password",
  "roleIds": []
}
```

`phoneNumber` is optional when an email is present and is an alternate login
identifier. `PATCH /api/v1/iam/members/{userId}` can update `displayName` and
`phoneNumber` with the existing optimistic `version`. For an email-backed
account, an omitted phone preserves the value and a blank value clears it. For
a phone-only account, the phone is the immutable primary login identity and
the member-update endpoint rejects changing or clearing it. Historical
username-only identities also cannot be converted through the profile-update
endpoint. This keeps identity changes fail-closed until a verified replacement
flow exists. Duplicate tenant phone numbers return a conflict.

Member reads return `id`, deprecated `username`, `email`, `phoneNumber`,
`displayName`, `status`, `version`, and timestamps. Password hashes,
credentials, sessions, and authorization details are not added.

## Authentication and privacy boundary

`POST /api/v1/auth/login` and
`POST /api/v1/platform-admin/auth/login` resolve a normalized email first, a
normalized phone second, and a historical username only as the compatibility
fallback. Email lookup is case-insensitive. Phone identity does not add SMS,
verification, recovery, or MFA behavior; password, session, permission, and
one-time credential rules remain unchanged.

Audits continue to store resource identifiers, action names, and bounded
change-field metadata. They do not store full email addresses, phone numbers,
passwords, tokens, or request bodies.
