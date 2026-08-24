package main

import (
	"context"
	"database/sql"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db := testdb.Open(t)
	t.Cleanup(func() { db.Close() })
	return db
}

// Regression: `SELECT pgmq.archive($1, $2)` without casts fails with
// "function pgmq.archive(unknown, unknown) is not unique" — pgmq exposes both
// a bigint and a bigint[] overload and pgx sends untyped parameters. The
// error used to be discarded at the call site, so every message was
// redelivered forever and re-inserted a proposal on each pass.
func TestAckMessage_ArchivesInsteadOfHittingOverloadAmbiguity(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	var msgID int64
	if err := db.QueryRowContext(ctx,
		`SELECT pgmq.send($1::text, $2::jsonb)`, queueName, `{"imo":"0000000"}`,
	).Scan(&msgID); err != nil {
		t.Fatalf("send: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`SELECT pgmq.delete($1::text, $2::bigint)`, queueName, msgID)
	})

	if err := ackMessage(ctx, db, msgID); err != nil {
		t.Fatalf("ackMessage: %v", err)
	}

	var still int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM pgmq.q_scrape_queue WHERE msg_id = $1`, msgID).Scan(&still); err != nil {
		t.Fatalf("count queue: %v", err)
	}
	if still != 0 {
		t.Fatalf("msg %d still in queue after ack — it will be redelivered and duplicate proposals", msgID)
	}
}
