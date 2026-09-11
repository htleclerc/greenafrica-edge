// scripts/vf-portcalls.ts
// Récupère les escales de Berbera auprès de l'API VesselFinder.
//
// POURQUOI CE SCRIPT
// La chaîne AIS gratuite ne peut pas rattraper le passé : aisstream est un flux
// temps réel, sans rejeu ("events are not durably replayed"), et `vessel_positions`
// est vide en prod. Août et septembre n'existent donc nulle part chez nous.
// L'API VesselFinder, elle, expose `PortCalls` avec une vraie plage `fromdate`/
// `todate` par `locode` — c'est le seul chemin qui reconstitue cet historique.
//
// PRUDENCE CRÉDITS
// L'essai est facturé au crédit : 2 par escale retournée, 3 par requête
// MasterData. Le mode par défaut est donc une RECONNAISSANCE volontairement
// minuscule (3 jours, limit 5) dont le seul but est de voir la forme réelle de
// la réponse et de mesurer la consommation avant de tirer sur la plage entière.
// Rien n'est écrit en base par ce script, dans aucun mode.
//
// Usage :
//   npx tsx scripts/vf-portcalls.ts
//       → reconnaissance : 3 derniers jours, limit 5, dump du JSON brut
//   npx tsx scripts/vf-portcalls.ts --full --from 2026-08-01 --to 2026-09-10
//       → plage complète, sauvegarde du JSON brut, résumé
//   npx tsx scripts/vf-portcalls.ts --full … --master
//       → ajoute MasterData (GT, DWT, FLAG, BUILT, OWNER, MANAGER) pour les IMO distincts
//
// Options : --locode <SOBBO> --limit <n> --event <arrival|departure> --out <fichier>
//
// La clé se met dans frontend/.env.local sous le nom VF_USERKEY — même
// convention d'environnement que backfill-collection-reminders.ts.

import { writeFileSync } from 'node:fs';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const USERKEY = process.env.VF_USERKEY;
if (!USERKEY) {
    console.error('❌ VF_USERKEY manquante dans frontend/.env.local');
    console.error('   Ajouter une ligne :  VF_USERKEY=<ta userkey VesselFinder>');
    process.exit(1);
}

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const WITH_MASTER = args.includes('--master');

function opt(name: string, fallback: string): string {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const LOCODE = opt('locode', 'SOBBO'); // Berbera
const EVENT = opt('event', '');

// En reconnaissance on se limite volontairement à une fenêtre étroite.
const today = new Date();
const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 3600 * 1000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const FROM = opt('from', FULL ? '2026-08-01' : iso(threeDaysAgo));
const TO = opt('to', iso(today));
const LIMIT = opt('limit', FULL ? '' : '5');

// La forme réelle n'est PAS celle que laissait entendre la doc : chaque élément
// est une enveloppe { PORTCALL: {...}, VOYAGE: {...} }, les champs ne sont pas
// à plat. Relevé sur une vraie réponse SOBBO le 2026-09-10.
type PortCall = {
    ID?: number;
    MMSI?: string | number;
    IMO?: string | number;
    LOCODE?: string;
    EVENT?: string;
    TIMESTAMP?: string;
    PORT?: string;
    COUNTRY?: string;
};

type Voyage = {
    LOCODE?: string;
    DEPARTURE?: string;
    LASTPORT?: string;
    LASTCOUNTRY?: string;
};

type Escale = PortCall & { VOYAGE?: Voyage };

/** Déplie l'enveloppe { PORTCALL, VOYAGE } et tolère un tableau nu. */
function extractRows(payload: unknown): Escale[] {
    const arr = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object'
          ? (Object.values(payload as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? []
          : [];
    return arr.map((item) => {
        if (item && typeof item === 'object' && 'PORTCALL' in item) {
            const o = item as { PORTCALL: PortCall; VOYAGE?: Voyage };
            return { ...o.PORTCALL, VOYAGE: o.VOYAGE };
        }
        return item as Escale;
    });
}

/** Fiche navire MasterData : champs documentés, tous scalaires. */
type MasterRow = {
    IMO?: string | number;
    NAME?: string;
    FLAG?: string;
    TYPE?: string;
    BUILT?: string | number;
    BUILDER?: string;
    OWNER?: string;
    MANAGER?: string;
    GT?: string | number;
    NT?: string | number;
    DWT?: string | number;
};

/** MasterData rend une enveloppe analogue. */
function extractMaster(payload: unknown): MasterRow[] {
    const arr = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object'
          ? (Object.values(payload as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? []
          : [];
    return arr.map((item) => {
        if (item && typeof item === 'object' && 'MASTERDATA' in item) {
            return (item as { MASTERDATA: MasterRow }).MASTERDATA;
        }
        return item as MasterRow;
    });
}

async function call(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams({ userkey: USERKEY as string, format: 'json', ...params });
    const url = `https://api.vesselfinder.com/${path}?${qs.toString()}`;
    // On ne journalise jamais la clé.
    console.log(`→ ${path}  ${new URLSearchParams({ ...params }).toString()}`);
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok) {
        console.error(`❌ HTTP ${res.status} — ${body.slice(0, 400)}`);
        process.exit(1);
    }
    try {
        return JSON.parse(body) as unknown;
    } catch {
        console.error(`❌ réponse non-JSON : ${body.slice(0, 400)}`);
        process.exit(1);
    }
}

/** Affiche le résumé de lot et rend les IMO distincts exploitables. */
function resume(rows: Escale[]): string[] {
    const arrivals = rows.filter((r) => String(r.EVENT).toUpperCase() === 'ARRIVAL').length;
    const departures = rows.filter((r) => String(r.EVENT).toUpperCase() === 'DEPARTURE').length;
    const anch = rows.filter((r) => (r.PORT ?? '').includes('Anch')).length;
    console.log(`arrivées ${arrivals} · départs ${departures} · dont mouillage ${anch}`);

    console.log('\n--- 10 premières escales ---');
    for (const r of rows.slice(0, 10)) {
        const from = r.VOYAGE?.LASTPORT ? `  ← ${r.VOYAGE.LASTPORT} (${r.VOYAGE.LASTCOUNTRY ?? '?'})` : '';
        console.log(
            `  ${r.TIMESTAMP ?? '?'}  ${String(r.EVENT ?? '?').padEnd(9)}  ` +
                `IMO ${String(r.IMO ?? '-').padEnd(9)}  MMSI ${String(r.MMSI ?? '-').padEnd(10)}  ${r.PORT ?? ''}${from}`,
        );
    }

    const imos = [...new Set(rows.map((r) => String(r.IMO ?? '')).filter((v) => v && v !== '0'))];
    const mmsis = [...new Set(rows.map((r) => String(r.MMSI ?? '')).filter(Boolean))];
    console.log(`\nnavires distincts : ${mmsis.length} par MMSI · ${imos.length} par IMO`);

    // Le port de provenance est le signal que toute la détection « origin port »
    // cherchait dans l'AIS sans jamais le trouver : ici il est donné directement.
    const lastPorts = new Map<string, number>();
    for (const r of rows) {
        const lp = r.VOYAGE?.LASTPORT;
        if (lp) lastPorts.set(lp, (lastPorts.get(lp) ?? 0) + 1);
    }
    if (lastPorts.size > 0) {
        console.log('\n--- ports de provenance les plus fréquents ---');
        for (const [port, n] of [...lastPorts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
            console.log(`  ${String(n).padStart(4)}  ${port}`);
        }
    }
    return imos;
}

async function main(): Promise<void> {
    console.log(FULL ? '=== PLAGE COMPLÈTE ===' : '=== RECONNAISSANCE (fenêtre réduite) ===');
    console.log(`port ${LOCODE} · du ${FROM} au ${TO}${LIMIT ? ` · limit ${LIMIT}` : ''}`);
    if (!FULL) console.log('(relancer avec --full pour la plage entière)');
    console.log();

    const params: Record<string, string> = {
        locode: LOCODE,
        fromdate: `${FROM} 00:00:00`,
        todate: `${TO} 23:59:59`,
        extradata: 'voyage',
    };
    if (LIMIT) params.limit = LIMIT;
    if (EVENT) params.event = EVENT;

    const payload = await call('portcalls', params);
    const rows = extractRows(payload);

    const outFile = opt('out', `scripts/backup/vf-portcalls-${LOCODE}-${FROM}_${TO}.json`);
    writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf-8');

    console.log(`\n${rows.length} escale(s) — JSON brut écrit dans ${outFile}`);
    console.log(`coût indicatif : ~${rows.length * 2} crédits PortCall + ~${rows.length} crédits voyage\n`);

    if (rows.length === 0) {
        console.log('Aucune escale sur la fenêtre. Vérifier le locode et les droits de la clé.');
        console.log('Le JSON brut ci-dessus dit ce que le serveur a réellement répondu.');
        return;
    }

    const imos = resume(rows);

    if (!WITH_MASTER) {
        console.log('(ajouter --master pour récupérer GT, DWT, FLAG, BUILT, OWNER, MANAGER)');
        return;
    }
    if (imos.length === 0) {
        console.log('Aucun IMO exploitable — MasterData sauté.');
        return;
    }

    const master = await call('masterdata', { imo: imos.join(',') });
    const masterFile = outFile.replace('.json', '-masterdata.json');
    writeFileSync(masterFile, JSON.stringify(master, null, 2), 'utf-8');
    const mrows = extractMaster(master);
    console.log(`\n${mrows.length} fiche(s) navire — écrites dans ${masterFile}`);
    for (const m of mrows.slice(0, 5)) {
        console.log(
            `  IMO ${String(m.IMO ?? '-').padEnd(9)} ${String(m.NAME ?? '').padEnd(24)} ` +
                `${String(m.FLAG ?? '--').padEnd(4)} GT ${String(m.GT ?? '-').padEnd(7)} DWT ${String(m.DWT ?? '-').padEnd(8)} ` +
                `mgr ${String(m.MANAGER ?? '-')}`,
        );
    }
    console.log('Rappel : OWNER et MANAGER sont des NOMS, l\'API ne rend aucune adresse e-mail.');
    console.log('Pour joindre les armateurs, l\'export d\'escales manuel reste la seule source.');
}

main().catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
