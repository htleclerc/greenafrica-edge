import { describe, it, expect } from 'vitest';
import { groupManualReminders } from './groupManualReminders';

describe('groupManualReminders', () => {
    it('replie un récap consolidé en une seule entrée', () => {
        // arm-014 porte 83 pro-formas : un récap y produit 83 lignes, qui
        // noieraient la timeline si on les affichait une par une.
        const rows = Array.from({ length: 83 }, (_, i) => ({
            id: `r${i}`, tier: 'MANUAL', sent_at: '2026-08-20T10:00:00Z',
            template_used: 'manual_recap', debtor_response_type: 'SILENT', escalated_bailiff: false,
        }));
        const out = groupManualReminders(rows);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: 'group', count: 83, templateUsed: 'manual_recap' });
    });

    it('laisse les paliers automatiques intacts', () => {
        const rows = [
            { id: 'a', tier: 'J3', sent_at: '2026-08-01T10:00:00Z', template_used: 'courtesy', debtor_response_type: 'SILENT', escalated_bailiff: false },
            { id: 'b', tier: 'J7', sent_at: '2026-08-05T10:00:00Z', template_used: 'courtesy', debtor_response_type: 'SILENT', escalated_bailiff: false },
        ];
        expect(groupManualReminders(rows)).toHaveLength(2);
    });

    it('ne fusionne pas deux relances manuelles envoyées séparément', () => {
        const rows = [
            { id: 'a', tier: 'MANUAL', sent_at: '2026-08-20T10:00:00Z', template_used: 'manual_reminder', debtor_response_type: 'SILENT', escalated_bailiff: false },
            { id: 'b', tier: 'MANUAL', sent_at: '2026-08-21T10:00:00Z', template_used: 'manual_reminder', debtor_response_type: 'SILENT', escalated_bailiff: false },
        ];
        expect(groupManualReminders(rows)).toHaveLength(2);
    });
});
