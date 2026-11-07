// Remise d'un mot de passe provisoire aux comptes du personnel.
//
// Usage — `--tsconfig` est OBLIGATOIRE : emailService resout ses imports par
// les alias `@/`, que tsx ne connait pas depuis scripts/.
//
//   npx tsx --tsconfig frontend/tsconfig.json scripts/reset-staff-passwords.ts
//   … --only <adresse>              → un seul compte
//   … --only <adresse> --execute     → applique sur ce compte
//   … --execute                      → TOUS les comptes staff
//
// Env : SUPABASE_URL (URL HTTPS du projet, pas la chaine postgresql://),
// SUPABASE_SERVICE_ROLE_KEY, et de quoi envoyer (RESEND_API_KEY ou EMAIL_SMTP_*)
// avec EMAIL_FROM.
//
// CE QUE FAIT CHAQUE COMPTE TRAITE
//   1. un mot de passe aleatoire est tire et pose par l'API d'administration ;
//   2. `profiles.password_set_at` repasse a NULL — la personne n'a pas choisi
//      ce mot de passe, et l'ecran de reglages ne lui reclamera donc pas
//      d'ancien pour le remplacer (mig 156) ;
//   3. le mot de passe part par courriel, avec la consigne de le changer.
//
// ⚠ LE MOT DE PASSE VOYAGE EN CLAIR. Il restera dans la boite de reception,
// ses sauvegardes et, selon le relais, ses journaux. C'est un choix assume :
// le remede sans secret en transit est le lien de reinitialisation
// (`requestPasswordReset`), a preferer partout ou le parcours le permet.
//
// L'ORDRE COMPTE : traiter un compte a la fois, en verifiant que le courriel
// arrive, avant de traiter les suivants. Un envoi muet sur les quatre comptes
// a la fois fermerait la porte a tout le personnel en meme temps.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { sendTemporaryPasswordEmail } from '../frontend/src/services/emailService';

const EXECUTE = process.argv.includes('--execute');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx > -1 ? (process.argv[onlyIx + 1] ?? '').trim().toLowerCase() : null;

const APP_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://greengate.africa';

function log(...a: unknown[]) { console.log(EXECUTE ? '[EXEC]' : '[DRY ]', ...a); }

/**
 * 18 octets tires au hasard, en base64url : ~24 caracteres, bien au-dela des
 * 12 exiges par la politique. Pas de choix « lisible » qui reduirait l'entropie
 * — le mot de passe est copie-colle depuis le courriel, pas retape de memoire.
 */
function generatePassword(): string {
    return randomBytes(18).toString('base64url');
}

/** Ne jamais imprimer un mot de passe en entier dans un journal. */
function maskPassword(p: string): string {
    return `${p.slice(0, 3)}${'•'.repeat(8)}${p.slice(-2)}`;
}

interface StaffRow {
    id: string;
    email: string;
    role: string;
    full_name: string | null;
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    const db = createClient(url, key, { auth: { persistSession: false } });

    // Le personnel, c'est tout ce qui n'est pas armateur. Les armateurs entrent
    // par lien magique : un mot de passe ne leur servirait a rien.
    let query = db.from('profiles')
        .select('id, email, role, full_name')
        .neq('role', 'SHIPOWNER')
        .eq('is_active', true);
    if (ONLY) query = query.eq('email', ONLY);

    const { data, error } = await query.order('email');
    if (error) throw new Error(`lecture des profils : ${error.message}`);

    const staff = (data ?? []) as StaffRow[];
    if (!staff.length) {
        log(ONLY ? `aucun compte actif pour ${ONLY}` : 'aucun compte de personnel actif');
        return;
    }

    log(`${staff.length} compte(s) de personnel a traiter${ONLY ? ` (filtre : ${ONLY})` : ''}`);

    let done = 0;
    for (const person of staff) {
        const password = generatePassword();
        log(`  ${person.email} (${person.role}) → ${maskPassword(password)}`);
        if (!EXECUTE) continue;

        const { error: pwErr } = await db.auth.admin.updateUserById(person.id, { password });
        if (pwErr) { console.error(`  ❌ ${person.email} : ${pwErr.message}`); continue; }

        // La personne n'a pas choisi ce mot de passe : l'ecran de reglages ne
        // doit pas lui reclamer d'ancien pour le remplacer.
        const { error: markErr } = await db.from('profiles')
            .update({ password_set_at: null })
            .eq('id', person.id);
        if (markErr) console.error(`  ! ${person.email} : marque non retiree (${markErr.message})`);

        const sent = await sendTemporaryPasswordEmail({
            to: person.email,
            password,
            role: person.role,
            link: `${APP_URL}/login`,
        });
        if (!sent.success) {
            // Le compte porte deja le nouveau mot de passe : si le courriel ne
            // part pas, la personne est dehors. On le dit fort.
            console.error(`  ❌ ENVOI ECHOUE pour ${person.email} — le compte porte un mot de passe`);
            console.error(`     que personne ne connait. Le voici, a transmettre par un autre canal :`);
            console.error(`     ${password}`);
            if (sent.error) console.error(`     cause : ${sent.error}`);
            continue;
        }
        done += 1;
        log(`  ✓ ${person.email} — courriel parti${sent.id ? ` (${sent.id})` : ''}`);
    }

    console.log('');
    log(`traites : ${done}/${staff.length}`);
    if (!EXECUTE) log('SIMULATION — relancer avec --execute pour appliquer');
}

main().catch((e) => {
    console.error('ECHEC :', e instanceof Error ? e.message : e);
    process.exit(1);
});
