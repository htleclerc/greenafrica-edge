// Provisionne un compte SUPERADMIN hors-bande, par invitation e-mail.
//
// Pourquoi un script et pas l'action inviteStaff du produit : celle-ci exclut
// volontairement SUPERADMIN de ses rôles invitables (frontend/src/actions/inviteStaff.ts),
// pour qu'une compromission de compte administrateur ne permette pas d'en fabriquer
// d'autres depuis l'interface. Le rôle le plus privilégié se provisionne donc ici.
//
// Le flux reproduit exactement celui d'inviteStaff, au rôle près :
//   1. inviteUserByEmail  → crée auth.users et envoie le lien vers /auth/setup-password
//   2. upsert profiles    → rôle SUPERADMIN, is_active = true
//   3. upsert user_jurisdictions → une ligne par juridiction
// Aucun mot de passe n'est fixé ni transmis : le destinataire choisit le sien.
//
// Idempotent : relancé, il retrouve l'utilisateur existant et réaligne profil et
// juridictions sans rien casser.
//
// Usage :
//   node scripts/invite-superadmin.mjs --email <adresse> --name "<nom>" \
//        [--env frontend/.env.local] [--jurisdictions SO,DJ] \
//        [--app-url https://greengate.africa] [--execute]
//
// Sans --execute, le script n'écrit rien et affiche ce qu'il ferait.

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const ENV_FILE = flag('env', 'frontend/.env.local');
const EMAIL = (flag('email') ?? '').trim().toLowerCase();
const FULL_NAME = flag('name');
const JURISDICTION_CODES = (flag('jurisdictions', 'SO,DJ') ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
const APP_URL = (flag('app-url', 'https://greengate.africa') ?? '').replace(/\/+$/, '');
const EXECUTE = has('execute');
const ROLE = 'SUPERADMIN';

if (!EMAIL || !FULL_NAME) {
    console.error('❌  --email et --name sont obligatoires.');
    console.error('    node scripts/invite-superadmin.mjs --email a@b.c --name "Prénom Nom" [--execute]');
    process.exit(1);
}

process.loadEnvFile(new URL(`../${ENV_FILE}`, import.meta.url));
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(`❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de ${ENV_FILE}`);
    process.exit(1);
}

const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
const h = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};

const jsonOrText = async (r) => {
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
};

async function main() {
    console.log('──────────────────────────────────────────────');
    console.log(`  projet        : ${projectRef}`);
    console.log(`  compte        : ${EMAIL}`);
    console.log(`  nom           : ${FULL_NAME}`);
    console.log(`  rôle          : ${ROLE}`);
    console.log(`  juridictions  : ${JURISDICTION_CODES.join(', ')}`);
    console.log(`  redirection   : ${APP_URL}/auth/setup-password`);
    console.log(`  mode          : ${EXECUTE ? 'ÉCRITURE' : 'simulation (--execute pour écrire)'}`);
    console.log('──────────────────────────────────────────────');

    // ── Résolution des juridictions par code (les UUID diffèrent d'un projet à l'autre)
    const jr = await fetch(`${SUPABASE_URL}/rest/v1/jurisdictions?select=id,code,name`, { headers: h });
    const jurisdictions = await jsonOrText(jr);
    if (!Array.isArray(jurisdictions)) {
        console.error('❌  Lecture des juridictions impossible :', jurisdictions);
        process.exit(1);
    }
    const targets = [];
    for (const code of JURISDICTION_CODES) {
        const found = jurisdictions.find((j) => j.code === code);
        if (!found) {
            console.error(`❌  Juridiction « ${code} » absente de ce projet. Disponibles : ${jurisdictions.map((j) => j.code).join(', ')}`);
            process.exit(1);
        }
        targets.push(found);
    }
    targets.forEach((j) => console.log(`  ✓ juridiction ${j.code} — ${j.name}`));

    // ── État actuel du compte
    const lr = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(EMAIL)}`,
        { headers: h },
    );
    const existing = ((await jsonOrText(lr)).users ?? []).find(
        (u) => u.email?.toLowerCase() === EMAIL,
    );
    console.log(existing
        ? `  ℹ️  utilisateur déjà présent (${existing.id}) — profil et juridictions seront réalignés`
        : '  ℹ️  utilisateur inexistant — une invitation sera envoyée');

    if (!EXECUTE) {
        console.log('\n  Simulation terminée. Relance avec --execute pour appliquer.');
        return;
    }

    // ── 1. Invitation (ou récupération de l'utilisateur existant)
    let userId;
    if (existing) {
        userId = existing.id;
    } else {
        const ir = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({
                email: EMAIL,
                data: { full_name: FULL_NAME, role: ROLE },
                redirect_to: `${APP_URL}/auth/setup-password`,
            }),
        });
        const invited = await jsonOrText(ir);
        if (!ir.ok || !invited?.id) {
            console.error('❌  Invitation refusée :', invited);
            process.exit(1);
        }
        userId = invited.id;
        console.log(`  ✓ invitation envoyée à ${EMAIL} (${userId})`);
    }

    // ── 2. Profil
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{
            id: userId,
            email: EMAIL,
            full_name: FULL_NAME,
            role: ROLE,
            is_active: true,
        }]),
    });
    const profile = await jsonOrText(pr);
    if (!pr.ok) {
        console.error('❌  Écriture du profil refusée :', profile);
        process.exit(1);
    }
    console.log(`  ✓ profil ${ROLE} actif`);

    // ── 3. Juridictions
    const ur = await fetch(`${SUPABASE_URL}/rest/v1/user_jurisdictions?on_conflict=user_id,jurisdiction_id`, {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(targets.map((j) => ({ user_id: userId, jurisdiction_id: j.id }))),
    });
    const links = await jsonOrText(ur);
    if (!ur.ok) {
        console.error('❌  Rattachement aux juridictions refusé :', links);
        process.exit(1);
    }
    console.log(`  ✓ rattaché à ${targets.length} juridiction(s)`);

    console.log('\n✅  Terminé.');
    if (!existing) {
        console.log(`    ${EMAIL} doit ouvrir le lien reçu par e-mail et définir son mot de passe.`);
        console.log(`    La redirection ${APP_URL}/auth/setup-password doit figurer dans les`);
        console.log('    « Redirect URLs » de la configuration Auth du projet, sinon Supabase');
        console.log('    retombera sur la Site URL.');
    } else {
        console.log(`    Le compte existait déjà : aucun e-mail envoyé, seuls le rôle et les`);
        console.log('    juridictions ont été réalignés.');
    }
}

main().catch((e) => {
    console.error('❌  Échec :', e);
    process.exit(1);
});
