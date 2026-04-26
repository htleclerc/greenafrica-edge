BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='equasis_scrape_proposals' AND table_schema='public'),
    'equasis_scrape_proposals table missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='equasis_scrape_proposals' AND column_name='proposed_email'),
    'equasis_scrape_proposals.proposed_email missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='equasis_scrape_proposals' AND column_name='applied'),
    'equasis_scrape_proposals.applied missing';
END $$;

-- Round-trip
DO $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.equasis_scrape_proposals (imo_number, proposed_owner_name, proposed_email)
  VALUES ('9999999', 'Some Owner Ltd', 'ops@some-owner.com')
  RETURNING id INTO v_id;

  ASSERT EXISTS (SELECT 1 FROM public.equasis_scrape_proposals WHERE id=v_id AND applied=FALSE),
    'proposal default applied should be FALSE';
END $$;

ROLLBACK;
