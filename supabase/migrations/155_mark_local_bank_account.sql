-- ============================================================================
-- 155 — Marque le compte de collecte domestique
-- ============================================================================
--
-- La mig 150 a ajoute le compte Premier Bank (Hargeisa) a la liste. Le
-- pro-forma doit maintenant l'imprimer EN PLUS du compte international, et il
-- lui faut pour cela savoir lequel est domestique.
--
-- Un drapeau explicite, et non une reconnaissance sur le libelle : le libelle
-- est une chaine d'affichage, traduite et reecrite au fil du temps. Un
-- document fiscal ne doit pas dependre de son orthographe.
--
-- Idempotent : la mise a jour ne porte que sur l'element au SWIFT PBSMSOSM.
-- ============================================================================

UPDATE public.jurisdiction_issuer_profile AS p
SET bank_accounts = (
    SELECT jsonb_agg(
        CASE WHEN acc->>'swift' = 'PBSMSOSM'
             THEN acc || '{"is_local": true}'::jsonb
             ELSE acc
        END
        ORDER BY ord
    )
    FROM jsonb_array_elements(p.bank_accounts) WITH ORDINALITY AS t(acc, ord)
)
WHERE p.bank_accounts @> '[{"swift": "PBSMSOSM"}]'::jsonb
  AND NOT (p.bank_accounts @> '[{"is_local": true}]'::jsonb);
