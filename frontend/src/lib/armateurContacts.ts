/**
 * Plafond de copies de facturation (billing_cc_emails) par armateur.
 *
 * Module neutre (pas de directive 'use server'/'use client') : consommé à la
 * fois par l'action serveur (frontend/src/actions/updateArmateurContacts.ts,
 * pour la contrainte Zod qui refuse un dépassement) et par le client
 * (frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx, pour
 * bloquer l'ajout et afficher le plafond avant l'envoi). Un fichier
 * 'use server' ne peut exporter que des fonctions async une fois importé
 * côté client — voir ALLOWED_LANGS dans frontend/src/lib/kyc/kycSchema.ts
 * pour le même motif déjà en place dans ce dépôt.
 */
export const MAX_CC_EMAILS = 10;
