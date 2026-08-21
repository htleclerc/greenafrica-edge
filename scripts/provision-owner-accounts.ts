// Mise en service silencieuse des comptes armateurs de la campagne du 19/08/2026.
//
// Usage :
//   npx tsx scripts/provision-owner-accounts.ts            → simulation
//   npx tsx scripts/provision-owner-accounts.ts --execute   → applique, idempotent
//
// Prérequis : la rebascule du livre doit avoir tourné (les 74 armateurs
// existent, reconnaissables à leur seed_ref PRO-CONS-2026-NNN), et
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY doivent être exportés.
//
// AUCUN E-MAIL N'EST ENVOYÉ. Décision PO : l'accès passe par la relance
// suivante, dont le lien fonctionne enfin. Le 19 août, 32 mises en demeure
// sont parties vers des débiteurs dont aucun n'avait de compte — un seul
// profil existait en base pour 26 armateurs.
import { createClient } from '@supabase/supabase-js';
import { provisionOwnerAccount } from '../frontend/src/services/ownerProvisioning';
import { isContactBlocked } from '../frontend/src/domain/sanctions/contactGuard';

const EXECUTE = process.argv.includes('--execute');

function log(...a: unknown[]) { console.log(EXECUTE ? '[EXEC]' : '[DRY ]', ...a); }

interface OwnerRow {
    id: string;
    seed_ref: string;
    name: string;
    official_email: string | null;
    account_state: string;
    profile_id: string | null;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    const db = createClient(url, key);

    const { data, error } = await db
        .from('shipowners')
        .select('id, seed_ref, name, official_email, account_state, profile_id, is_ofac_sdn, is_un_prohibited')
        .like('seed_ref', 'PRO-CONS-2026-%')
        .order('seed_ref');
    if (error) throw new Error(`lecture des armateurs : ${error.message}`);

    const owners = (data ?? []) as OwnerRow[];
    log(`${owners.length} dossiers de la campagne en base`);
    if (owners.length === 0) {
        throw new Error('aucun dossier PRO-CONS-2026-* — la rebascule du livre a-t-elle tourné ?');
    }

    const sanctionnes = owners.filter((o) => isContactBlocked(o));
    const sansAdresse = owners.filter((o) => !isContactBlocked(o) && !o.official_email);
    const cibles = owners.filter((o) => !isContactBlocked(o) && o.official_email);

    log(`à mettre en service ${cibles.length} · sans adresse ${sansAdresse.length} · sous sanctions ${sanctionnes.length}`);

    for (const o of sanctionnes) {
        log(`  IGNORÉ [SANCTIONS] ${o.seed_ref} ${o.name}`);
    }
    for (const o of sansAdresse) {
        log(`  IGNORÉ [sans adresse] ${o.seed_ref} ${o.name}`);
    }

    let crees = 0;
    let repris = 0;
    let dejaActifs = 0;
    let rattaches = 0;

    // UN PROFIL NE POSSÈDE QU'UN SEUL ARMATEUR.
    //
    // Deux dossiers peuvent partager une adresse — faros@farosshipping.example
    // porte PRO-CONS-2026-008 et -021. Poser le même profile_id sur les deux
    // casse le portail : requirePrincipal fait .eq('profile_id').maybeSingle()
    // et rend PGRST116 « The result contains 2 rows », tandis que
    // current_shipowner_id(), qui porte le RLS, fait LIMIT 1 sans ORDER BY et
    // devient non déterministe.
    //
    // Le PREMIER dossier de l'ordre possède le compte ; les suivants sont
    // rattachés par owner_agent_mappings, ce qui est exactement le mécanisme
    // prévu pour un représentant.
    const profileParEmail = new Map<string, string>();

    for (const o of cibles) {
        const email = (o.official_email as string).trim().toLowerCase();

        // Idempotence : un dossier déjà rattaché et actif n'est pas retouché.
        if (o.profile_id && o.account_state === 'ACTIVE') {
            dejaActifs += 1;
            profileParEmail.set(email, o.profile_id);
            continue;
        }

        const dejaVue = profileParEmail.get(email);
        log(`  ${o.seed_ref} ${o.name} <${email}>${dejaVue ? '  [adresse déjà servie → rattachement]' : ''}`);
        if (!EXECUTE) { if (dejaVue) rattaches += 1; else crees += 1; continue; }

        const { profileId, created } = await provisionOwnerAccount(db, {
            email, fullName: o.name,
        });

        if (dejaVue) {
            // Second dossier de cette adresse : rattachement, pas possession.
            rattaches += 1;
            const { data: existing } = await db
                .from('owner_agent_mappings')
                .select('id')
                .eq('shipowner_id', o.id)
                .eq('agent_profile_id', profileId)
                .limit(1);
            if (((existing ?? []) as unknown[]).length === 0) {
                const { error } = await db.from('owner_agent_mappings').insert({
                    shipowner_id: o.id, agent_profile_id: profileId, priority: 10, active: true,
                });
                if (error) throw new Error(`rattachement ${o.seed_ref} : ${error.message}`);
            }
            continue;
        }

        if (created) crees += 1; else repris += 1;
        profileParEmail.set(email, profileId);

        const { error: upErr } = await db
            .from('shipowners')
            .update({ profile_id: profileId, account_state: 'ACTIVE' })
            .eq('id', o.id);
        if (upErr) throw new Error(`mise en service ${o.seed_ref} : ${upErr.message}`);
    }

    console.log('');
    log(`comptes créés ${crees} · comptes repris ${repris} · déjà actifs ${dejaActifs} · dossiers rattachés ${rattaches}`);
    log(`hors de portée du portail : ${sansAdresse.length} sans adresse, ${sanctionnes.length} sous sanctions`);
    if (!EXECUTE) log('SIMULATION — relancer avec --execute pour appliquer');
}

main().catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exit(1);
});
