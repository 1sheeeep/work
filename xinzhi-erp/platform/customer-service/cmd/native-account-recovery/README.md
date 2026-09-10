# Copied customer-service UAT account recovery

This is a one-time operator tool for the two user-approved existing accounts in
tenant `7d055c24-3a32-4d28-bac2-b512fa1423b6`. It is not a public reset endpoint,
an account-creation mechanism, or a production customer-service migration.

## Safety contract

- Only `XZDESK_ENVIRONMENT=uat`, database `customer_service_uat`, and the fixed
  `customer_service.erp_tenant_stores` row are accepted.
- Both exact existing IDs, placeholder logins, active/admin states and disabled
  SSO password markers must match. Both replacements are validated together.
- Human-supplied emails must be distinct and unused in this tenant. Passwords
  are entered personally, confirmed, 12–72 UTF-8 bytes and have no surrounding
  whitespace. Hashing uses the application's existing bcrypt dependency/cost.
- No role, scope, enterprise, user ID, historical linkage or business field is
  recreated. Unknown JSON fields and escaped NUL map keys are preserved. Only
  email/password/update timestamp, target sessions and recovery audit entries
  change. Audit entries contain no password or password hash.
- Inspection is read-only. Apply requires the inspected revision and exact
  snapshot SHA-256. One row lock and one transaction update both accounts; the
  revision increment prevents a cached service from overwriting the snapshot.
- The operator wrapper refuses apply while the copied UAT API is running. It
  does not stop services automatically. It backs up the UAT database/environment/
  Compose, verifies the dump directory and checksums, and the binary separately
  syncs and verifies a private exact snapshot backup before the update.
- A failed commit response is an unknown result: inspect first, do not blindly
  repeat or restore. Already-recovered accounts cannot be reset with this tool.

## Cutover order — owner input required

1. Confirm which independent login email belongs to each existing account.
   Do not infer identity by matching an ERP email or copy ERP passwords.
2. Finish and validate the native release artifacts; preserve unrelated Git
   changes. Have the previous images and rollback evidence available.
3. Schedule the short UAT maintenance interval. Stop only the copied UAT API
   after artifacts are ready; leave original production customer service alone.
4. The user personally runs `tools/set-native-uat-accounts.ps1` in PowerShell 7,
   supplying the inspected server tool directory. It shows the exact account
   assignments, asks for confirmation, and reads passwords without echo. The
   JSON payload exists only in process memory/private SSH stdin; do not run it
   in an agent-supplied password prompt or save the payload as a file.
5. After `RECOVERY_COMMITTED`, deploy/restart the native UAT release and verify
   both native sign-ins, unchanged roles/shop scope/data, session invalidation
   and service restart. Do not restart old SSO code for business use: it can
   rewrite legacy account fields. A rollback after recovery requires explicit
   coordination; never restore the whole tenant over newer business changes.

## Current staged helper

Server: existing ERP test/copied-CS UAT host `13.215.3.189`.
Directory: `/opt/xz-erp-customer-service-uat/tools/native-recovery-20260905T112429Z`.
The helper and wrapper were uploaded and SHA-256 matched locally/remotely;
`sh -n` and live read-only inspection passed. The two accounts remain eligible.
No account update, password entry, service stop, database write or application
release was performed. The native release is not ready to switch yet, so do
not run the password script until the cutover is prepared.

Local unit tests cover preservation, credential verification, target-session
clearing, invalid input and replay rejection. The PostgreSQL apply transaction
has not yet been exercised against the real UAT database; inspection is not
write-path or login acceptance.

Design reference: [OWASP account recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
Using a restricted operator channel avoids introducing a public recovery bypass.
# 已停用写入

2026-09-05 用户确认 ERP 与复制客服共用 ERP 账号。原生密码恢复不再执行；新构建拒绝 `--apply`。保留只读检查和历史测试，勿运行旧暂存二进制执行恢复。
