-- CONTEXTE. Le 19/08/2026, 74 mises en demeure sont parties vers les debiteurs
-- de Berbera pour 1 316 124,00 USD. Elles portent les references
-- PRO-2026-064001..064086 — deja detenues en base par les 100 pro-formas
-- maritimes du seed du 18/07, qui designent d'autres navires et d'autres
-- montants (86 collisions sur 86, aucune correspondance de navire ni de
-- montant). Decision PO du 2026-08-20 : la campagne du 19/08 fait foi.
--
-- POURQUOI CET INDEX. Les trois gardes de la mig 089 verrouillent toutes les
-- autres sorties :
--   * invoice_ref est en ecriture unique — on ne peut ni le changer ni le
--     remettre a NULL (la trappe de reprise n'ouvre que NULL -> valeur) ;
--   * DELETE et TRUNCATE sont interdits — « fiscal rows are permanent » ;
--   * seul `status` reste librement modifiable, et l'enum porte VOID.
-- Restreindre l'unicite aux lignes vivantes est donc le seul chemin qui
-- permette d'annuler sans detruire, puis de reemettre a l'identique.
--
-- CE QUE CETTE MIGRATION NE RELACHE PAS. L'immuabilite de invoice_ref reste
-- entiere : on ne renumerote pas une facture, on annule la ligne et on en
-- emet une nouvelle. Seule l'unicite devient conditionnelle.
--
-- LE MOTIF DU QR NE S'Y OPPOSE PAS. La 089 gele invoice_ref au motif que
-- « distributed PDFs carry this ref in their QR code ». Deux faits le
-- neutralisent ici : les 100 pro-formas du seed n'ont jamais ete envoyees
-- (sent_at vide sur les 100), et les 86 PDF reellement distribues le 19/08 ne
-- contiennent ni QR ni URL (verifie en decompressant les flux de
-- PRO-2026-064001-MAYAR.pdf : aucune occurrence de http, verify ou greengate).
--
-- CONSEQUENCE TRAITEE AILLEURS. /verify/[ref] resout par egalite sur
-- invoice_ref ; il doit desormais se restreindre aux lignes vivantes, sans
-- quoi la resolution devient ambigue des qu'une reference est portee par une
-- ligne annulee et une ligne due.

DROP INDEX IF EXISTS public.idx_txn_invoice_ref;

CREATE UNIQUE INDEX idx_txn_invoice_ref
  ON public.transactions (invoice_ref)
  WHERE invoice_ref IS NOT NULL AND status <> 'VOID';

COMMENT ON INDEX public.idx_txn_invoice_ref IS
  'Unicite de invoice_ref parmi les seules factures vivantes. Une ligne VOID conserve sa reference a titre de trace, mais ne la reserve plus (mig 128).';
