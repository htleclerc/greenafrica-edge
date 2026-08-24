import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_OWNER_EMAIL_PATHS } from '@/lib/routes/ownerPaths';

/**
 * Les modèles d'e-mail sont la seule surface où un chemin interne est écrit en
 * dur sans que le typage de Next ne le vérifie. Un lien mort y part en
 * production sans bruit — c'est exactement ce qui a rendu inutilisables les
 * relances du 19/08/2026 : les boutons pointaient sur /owner/invoices, route
 * supprimée lors de la convergence des portails.
 *
 * Ce test confronte chaque chemin cité à l'arborescence réelle de app/.
 */
const APP = join(process.cwd(), 'src', 'app');

function routeExists(path: string): boolean {
    const segments = path.replace(/^\//, '').split('/');
    // Next autorise les groupes de routes : /dashboard/invoices vit sous
    // app/(dashboard)/dashboard/invoices. On explore donc aussi les dossiers
    // parenthésés du premier niveau.
    const roots = [
        APP,
        ...readdirSync(APP, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name.startsWith('('))
            .map((e) => join(APP, e.name)),
    ];
    return roots.some((root) => existsSync(join(root, ...segments, 'page.tsx')));
}

describe('chemins internes cités dans les e-mails', () => {
    it('déclare au moins les factures et le portefeuille', () => {
        expect(ALL_OWNER_EMAIL_PATHS.length).toBeGreaterThanOrEqual(2);
    });

    it.each(ALL_OWNER_EMAIL_PATHS)('%s correspond à une route réelle', (path) => {
        expect(routeExists(path)).toBe(true);
    });
});
