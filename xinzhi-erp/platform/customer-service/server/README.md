# Server

The server owns shared business data and realtime events.

Current entry point:

```powershell
go run .\cmd\support-server -addr 127.0.0.1:8787
```

Storage:

- local mode without `DATABASE_URL`: explicit `DATA_FILE` or in-memory adapter
- PostgreSQL mode: fixed `customer_service` schema, separate
  `customer_service_migrator` and `customer_service_runtime` connections, and
  an independent checksum migration history
- production mode without PostgreSQL: startup failure; no file/memory fallback

The schema-role contract is currently proven only against fresh synthetic local
PostgreSQL. It does not migrate legacy `public` data and is not a production
deployment or enablement claim.

Current implementation lives in `internal/platform`.

Current API foundation:

- `GET /healthz`
- `POST /api/v1/bootstrap/admin`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET/POST /api/v1/users`
- `GET/POST /api/v1/shops`
- `GET/POST /api/v1/shops/{shopId}/sources`
- `GET/POST /api/v1/shops/{shopId}/agents`
- `DELETE /api/v1/shops/{shopId}/agents/{userId}`
- `GET/POST /api/v1/conversations`
- `GET/POST /api/v1/conversations/{conversationId}/messages`
- `GET /ws/events`

Except for health, bootstrap, login, and the current event socket, business
endpoints require bearer sessions. Admin users can manage shops, sources,
users, and assignments. Agent users only receive shops, conversations, and
messages for shops assigned to them.
