package platform

import (
	"context"
	"database/sql"
	"errors"
)

// Presence changes are not credential changes. The SQL revision trigger is
// explicitly installed for preparation, never an implicit production migration.
func (s *MemoryStore) ReadIdentitySnapshot(ctx context.Context, id string) (User, error) {
	return s.GetUser(ctx, id)
}

func (s *PostgresStore) ReadIdentitySnapshot(ctx context.Context, id string) (User, error) {
	return s.readIdentityRow(ctx, identitySnapshotColumns+` WHERE u.id=$1`, id)
}

// One statement sees the user and its trigger-maintained revision in the same
// MVCC snapshot. Avoid four database round trips for each credential check.
const identitySnapshotColumns = `SELECT u.id,u.email,u.display_name,u.role,u.status,u.department,u.skill_group,
 u.reception_limit,u.reception_online,u.permissions,u.permissions_customized,u.data_scopes,u.shop_scope,
 u.shop_scope_ids,u.workbench_shop_scope,u.conversation_scope,u.system_admin,u.password_hash,u.created_at,u.updated_at,r.revision
 FROM users u LEFT JOIN customer_service.identity_preparation_revisions r ON r.user_id=u.id`

func (s *PostgresStore) FindIdentitySnapshotByEmail(ctx context.Context, email string) (User, error) {
	return s.readIdentityRow(ctx, identitySnapshotColumns+` WHERE u.email=$1`, normalizeEmail(email))
}

type identityRevisionScanner struct {
	scanner
	revision *int64
}

func (s identityRevisionScanner) Scan(values ...any) error {
	return s.scanner.Scan(append(values, s.revision)...)
}
func (s *PostgresStore) readIdentityRow(ctx context.Context, query, value string) (User, error) {
	var revision int64
	u, err := scanUser(identityRevisionScanner{s.db.QueryRowContext(ctx, query, value), &revision})
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	u.IdentityRevision = revision
	return u, err
}
