package migration

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPostgresSourceUsesOneReadOnlyRepeatableReadSnapshot(t *testing.T) {
	installedAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	database := &fakeSnapshotDatabase{transaction: &fakeSnapshotTransaction{rows: &fakeSnapshotRows{rows: [][]any{{
		"demo.myshopify.com", "legacy-shop", "shpat_known_legacy_token", "read_orders,write_orders",
		installedAt, installedAt.Add(time.Hour),
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	}}}}}
	result, err := ReadPostgresSnapshot(t.Context(), database, NewCredentialDecoder(""))
	if err != nil || len(result.Records) != 1 {
		t.Fatalf("ReadPostgresSnapshot mismatch: %#v err=%v", result, err)
	}
	if database.beginCalls != 1 || !database.options.ReadOnly || database.options.Isolation != SnapshotIsolationRepeatableRead {
		t.Fatalf("snapshot options mismatch: calls=%d options=%#v", database.beginCalls, database.options)
	}
	if database.transaction.commitCalls != 1 || database.transaction.rollbackCalls != 1 {
		t.Fatalf("transaction lifecycle mismatch: commit=%d rollback=%d", database.transaction.commitCalls, database.transaction.rollbackCalls)
	}
}

func TestPostgresSourceRollsBackAndReturnsSanitizedFailure(t *testing.T) {
	database := &fakeSnapshotDatabase{transaction: &fakeSnapshotTransaction{queryErr: errors.New("driver exposed shpat_secret and postgres://credentials")}}
	_, err := ReadPostgresSnapshot(t.Context(), database, NewCredentialDecoder(""))
	if !errors.Is(err, ErrLegacySnapshotUnavailable) {
		t.Fatalf("unexpected source error: %v", err)
	}
	if containsAny(err.Error(), "shpat_secret", "postgres://credentials") {
		t.Fatalf("database error leaked raw details: %v", err)
	}
	if database.transaction.commitCalls != 0 || database.transaction.rollbackCalls != 1 {
		t.Fatalf("failed transaction lifecycle mismatch: commit=%d rollback=%d", database.transaction.commitCalls, database.transaction.rollbackCalls)
	}
}

func TestPostgresSourceRejectsEmptyInstallationSet(t *testing.T) {
	database := &fakeSnapshotDatabase{transaction: &fakeSnapshotTransaction{rows: &fakeSnapshotRows{}}}
	_, err := ReadPostgresSnapshot(t.Context(), database, NewCredentialDecoder(""))
	if !errors.Is(err, ErrLegacySnapshotUnavailable) {
		t.Fatalf("empty PostgreSQL snapshot was reported as complete: %v", err)
	}
	if database.transaction.commitCalls != 0 || database.transaction.rollbackCalls != 1 {
		t.Fatalf("empty snapshot lifecycle mismatch: commit=%d rollback=%d", database.transaction.commitCalls, database.transaction.rollbackCalls)
	}
}

type fakeSnapshotDatabase struct {
	options     SnapshotOptions
	beginCalls  int
	transaction *fakeSnapshotTransaction
}

func (d *fakeSnapshotDatabase) BeginSnapshot(_ context.Context, options SnapshotOptions) (SnapshotTransaction, error) {
	d.beginCalls++
	d.options = options
	return d.transaction, nil
}

type fakeSnapshotTransaction struct {
	rows          *fakeSnapshotRows
	queryErr      error
	commitCalls   int
	rollbackCalls int
}

func (t *fakeSnapshotTransaction) Query(context.Context, string) (SnapshotRows, error) {
	if t.queryErr != nil {
		return nil, t.queryErr
	}
	return t.rows, nil
}

func (t *fakeSnapshotTransaction) Commit(context.Context) error {
	t.commitCalls++
	return nil
}

func (t *fakeSnapshotTransaction) Rollback(context.Context) error {
	t.rollbackCalls++
	return nil
}

type fakeSnapshotRows struct {
	rows  [][]any
	index int
	err   error
}

func (r *fakeSnapshotRows) Next() bool { return r.index < len(r.rows) }

func (r *fakeSnapshotRows) Scan(destinations ...any) error {
	row := r.rows[r.index]
	r.index++
	for index, value := range row {
		switch destination := destinations[index].(type) {
		case *string:
			*destination = value.(string)
		case *time.Time:
			*destination = value.(time.Time)
		}
	}
	return nil
}

func (r *fakeSnapshotRows) Err() error { return r.err }
func (r *fakeSnapshotRows) Close()     {}
