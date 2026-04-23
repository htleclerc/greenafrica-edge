BEGIN;

-- transactions escalation columns
DO $$
DECLARE required_cols TEXT[] := ARRAY[
  'owner_escalation_due_at',
  'escalated_to_owner_at',
  'escalated_to_owner_email',
  'escalated_by'
];
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY required_cols LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='transactions' AND column_name = c),
      format('transactions.%s missing', c);
  END LOOP;
END $$;

-- Partial index for staging
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_txn_unpaid_escalation_due'
  ), 'idx_txn_unpaid_escalation_due missing';
END $$;

-- vessels detention columns (dormant)
DO $$
DECLARE required_cols TEXT[] := ARRAY[
  'detain_on_next_call','detain_reason','detain_set_by','detain_set_at'
];
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY required_cols LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='vessels' AND column_name = c),
      format('vessels.%s missing', c);
  END LOOP;
END $$;

-- Default for detain_on_next_call is FALSE
DO $$
DECLARE v_default TEXT;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_name='vessels' AND column_name='detain_on_next_call';
  ASSERT v_default = 'false', format('vessels.detain_on_next_call default is %s, expected false', v_default);
END $$;

ROLLBACK;
