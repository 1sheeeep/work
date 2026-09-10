// One-time, operator-only recovery for the two approved copied-CS UAT accounts.
// No HTTP listener, bootstrap route, new account or production database support.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func main() {
	apply := flag.Bool("apply", false, "apply approved inputs from private stdin; default is read-only inspection")
	backupDir := flag.String("backup-dir", "", "existing private operator backup directory (required with --apply)")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := run(ctx, *apply, *backupDir, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "RECOVERY_NOT_COMPLETED: keep the current deployment; inspect account state before retrying.")
		os.Exit(1)
	}
}

func run(ctx context.Context, apply bool, backupDir string, in io.Reader, out io.Writer) error {
	// Superseded by shared ERP identity on 2026-09-05. Never convert the seats
	// into a second password database, even if an old operator command is reused.
	if apply {
		return errRecovery
	}
	if os.Getenv("XZDESK_ENVIRONMENT") != "uat" {
		return errRecovery
	}
	cfg, err := pgx.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil || cfg.Database != "customer_service_uat" {
		return errRecovery
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return errRecovery
	}
	defer conn.Close(context.Background())
	var input recoveryInput
	if apply {
		data, err := io.ReadAll(io.LimitReader(in, 8193))
		if err != nil || len(data) > 8192 {
			return errRecovery
		}
		defer clear(data)
		if json.Unmarshal(data, &input) != nil || input.Revision < 0 || len(input.SnapshotSHA256) != 64 {
			return errRecovery
		}
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return errRecovery
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	var revision int64
	query := "SELECT snapshot,revision FROM customer_service.erp_tenant_stores WHERE tenant_id=$1"
	if apply {
		query += " FOR UPDATE NOWAIT"
	}
	if err = tx.QueryRow(ctx, query, approvedTenant).Scan(&raw, &revision); err != nil {
		return errRecovery
	}
	defer clear(raw)
	digest := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(digest[:])
	if !apply {
		// Inspection emits identifiers/status only, never the snapshot or hashes of passwords.
		var root, users object
		if json.Unmarshal(raw, &root) != nil || json.Unmarshal(root["users"], &users) != nil {
			return errRecovery
		}
		items := []map[string]any{}
		for id, expected := range approvedUsers {
			var u object
			if json.Unmarshal(users[id], &u) != nil {
				return errRecovery
			}
			items = append(items, map[string]any{"userId": id, "displayName": field(u, "displayName"), "login": field(u, "email"), "eligible": field(u, "passwordHash") == disabledPassword && field(u, "email") == expected && field(u, "status") == "active" && field(u, "role") == "admin"})
		}
		return json.NewEncoder(out).Encode(map[string]any{"tenantId": approvedTenant, "revision": revision, "snapshotSHA256": fingerprint, "accounts": items, "readOnly": true})
	}
	if revision != input.Revision || fingerprint != input.SnapshotSHA256 {
		return errRecovery
	}
	updated, err := recoverSnapshot(raw, input, time.Now())
	if err != nil {
		return err
	}
	defer clear(updated)
	if err = backupSnapshot(backupDir, raw); err != nil {
		return errRecovery
	}
	command, err := tx.Exec(ctx, "UPDATE customer_service.erp_tenant_stores SET snapshot=$1,revision=revision+1,updated_at=NOW() WHERE tenant_id=$2 AND revision=$3", updated, approvedTenant, revision)
	if err != nil || command.RowsAffected() != 1 {
		return errRecovery
	}
	if err = tx.Commit(ctx); err != nil {
		return errRecovery
	}
	_, err = fmt.Fprintln(out, "RECOVERY_COMMITTED: two existing accounts updated; restart into the native-login release before business use.")
	return err
}

func backupSnapshot(dir string, raw []byte) error {
	if !filepath.IsAbs(dir) {
		return errRecovery
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil || resolved != filepath.Clean(dir) {
		return errRecovery
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return errRecovery
	}
	path := filepath.Join(dir, "native-recovery-"+uuid.NewString()+".json")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errRecovery
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return errRecovery
	}
	check, err := os.ReadFile(path)
	if err != nil {
		return errRecovery
	}
	defer clear(check)
	if sha256.Sum256(check) != sha256.Sum256(raw) {
		return errRecovery
	}
	directory, err := os.Open(dir)
	if err != nil {
		return errRecovery
	}
	syncErr = directory.Sync()
	closeErr = directory.Close()
	if syncErr != nil || closeErr != nil {
		return errRecovery
	}
	return nil
}
