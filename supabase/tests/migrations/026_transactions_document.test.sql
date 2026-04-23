BEGIN;

-- document_type enum
DO $$ BEGIN
  ASSERT (SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='document_type')
         = ARRAY['PROFORMA','FINAL','COMPLEMENT','REFUND'],
    'document_type enum missing or wrong';
END $$;

-- transaction_status extended
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='transaction_status' AND enumlabel='CREDIT_NOTE_ISSUED'
  ), 'transaction_status missing CREDIT_NOTE_ISSUED';
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='transaction_status' AND enumlabel='VOID'
  ), 'transaction_status missing VOID';
END $$;

-- transactions columns
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='document_type'),
    'transactions.document_type missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='arrival_alert_id'),
    'transactions.arrival_alert_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='rate_usd_per_tco2'),
    'transactions.rate_usd_per_tco2 missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='breakdown_json'),
    'transactions.breakdown_json missing';
END $$;

-- FKs from arrival_alerts to transactions now in place
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='arrival_alerts'
       AND constraint_type='FOREIGN KEY'
       AND constraint_name='fk_arrival_alert_proforma_txn'
  ), 'FK fk_arrival_alert_proforma_txn missing';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='arrival_alerts'
       AND constraint_type='FOREIGN KEY'
       AND constraint_name='fk_arrival_alert_final_txn'
  ), 'FK fk_arrival_alert_final_txn missing';
END $$;

ROLLBACK;
