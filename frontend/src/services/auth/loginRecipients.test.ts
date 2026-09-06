import { describe, it, expect } from 'vitest';
import { listLoginRecipients, MAX_LOGIN_RECIPIENTS } from './loginRecipients';

function db(members: unknown[], reps: unknown[]) {
    const calls: { table: string; filters: [string, unknown][] }[] = [];
    return {
        calls,
        client: {
            from: (table: string) => {
                const entry = { table, filters: [] as [string, unknown][] };
                calls.push(entry);
                const rows = table === 'owner_members' ? members : reps;
                const chain: Record<string, unknown> = {};
                chain.select = () => chain;
                chain.eq = (c: string, v: unknown) => { entry.filters.push([c, v]); return chain; };
                chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
                return chain;
            },
        } as never,
    };
}

const OWNER = { id: 'own-1', officialEmail: 'Contact@Horn.example' };

describe('listLoginRecipients', () => {
    it('titulaire en premier, puis membres et représentants actifs', async () => {
        const { client, calls } = db(
            [{ profiles: { email: 'compta@horn.example' } }],
            [{ profiles: [{ email: 'agent@berbera.example' }] }],
        );
        const r = await listLoginRecipients(client, OWNER);
        expect(r).toEqual([
            { email: 'contact@horn.example', kind: 'OWNER' },
            { email: 'compta@horn.example', kind: 'MEMBER' },
            { email: 'agent@berbera.example', kind: 'REPRESENTATIVE' },
        ]);
        // Seuls les actifs du compte : les deux lectures portent le compte et active=true.
        for (const c of calls) {
            expect(c.filters).toEqual([['shipowner_id', 'own-1'], ['active', true]]);
        }
    });

    it("dédoublonne sans tenir compte de la casse — l'adresse officielle prime", async () => {
        const { client } = db([{ profiles: { email: 'CONTACT@horn.example' } }], []);
        const r = await listLoginRecipients(client, OWNER);
        expect(r).toEqual([{ email: 'contact@horn.example', kind: 'OWNER' }]);
    });

    it('ignore une appartenance sans adresse', async () => {
        const { client } = db([{ profiles: null }, { profiles: { email: '' } }], []);
        expect(await listLoginRecipients(client, OWNER)).toHaveLength(1);
    });

    it('plafonne à cinq boîtes', async () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ profiles: { email: `m${i}@horn.example` } }));
        const { client } = db(many, []);
        expect(await listLoginRecipients(client, OWNER)).toHaveLength(MAX_LOGIN_RECIPIENTS);
    });
});
