package migration

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGXSnapshotDatabase struct {
	pool *pgxpool.Pool
}

func NewPGXSnapshotDatabase(pool *pgxpool.Pool) *PGXSnapshotDatabase {
	return &PGXSnapshotDatabase{pool: pool}
}

func (d *PGXSnapshotDatabase) BeginSnapshot(ctx context.Context, options SnapshotOptions) (SnapshotTransaction, error) {
	accessMode := pgx.ReadWrite
	if options.ReadOnly {
		accessMode = pgx.ReadOnly
	}
	isolation := pgx.Serializable
	if options.Isolation == SnapshotIsolationRepeatableRead {
		isolation = pgx.RepeatableRead
	}
	transaction, err := d.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: isolation, AccessMode: accessMode})
	if err != nil {
		return nil, err
	}
	return pgxSnapshotTransaction{transaction: transaction}, nil
}

type pgxSnapshotTransaction struct {
	transaction pgx.Tx
}

func (t pgxSnapshotTransaction) Query(ctx context.Context, query string) (SnapshotRows, error) {
	return t.transaction.Query(ctx, query)
}

func (t pgxSnapshotTransaction) Commit(ctx context.Context) error { return t.transaction.Commit(ctx) }
func (t pgxSnapshotTransaction) Rollback(ctx context.Context) error {
	return t.transaction.Rollback(ctx)
}
