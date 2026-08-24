import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyEmailRedirect, redirectTarget, type Redirectable } from './emailRedirect';

const ORIGINAL = process.env.EMAIL_REDIRECT_TO;

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EMAIL_REDIRECT_TO;
    else process.env.EMAIL_REDIRECT_TO = ORIGINAL;
});

describe('redirection des e-mails hors production', () => {
    describe('quand la variable est absente — le cas de la production', () => {
        beforeEach(() => {
            delete process.env.EMAIL_REDIRECT_TO;
        });

        it('ne touche à rien', () => {
            const message = {
                to: 'armateur@exemple.com',
                cc: ['agent@exemple.com'],
                subject: 'Pro-forma PRO-2026-34-abcd',
                html: '<p>corps</p>',
                text: 'corps',
            };
            const out = applyEmailRedirect(message);

            expect(out.redirected).toBe(false);
            expect(out.message).toBe(message);
            expect(redirectTarget()).toBeNull();
        });

        it('traite une variable vide ou en espaces comme absente', () => {
            process.env.EMAIL_REDIRECT_TO = '   ';
            expect(redirectTarget()).toBeNull();
            expect(applyEmailRedirect({ to: 'a@b.c', subject: 's' }).redirected).toBe(false);
        });
    });

    describe('quand la variable est posée — la staging', () => {
        beforeEach(() => {
            process.env.EMAIL_REDIRECT_TO = 'demo@africgreen.africa';
        });

        it("n'envoie qu'à l'adresse de démonstration et supprime les copies", () => {
            const out = applyEmailRedirect({
                to: 'armateur@exemple.com',
                cc: ['agent@exemple.com', 'tresor@etat.example'],
                subject: 'Pro-forma',
                text: 'corps',
            });

            expect(out.redirected).toBe(true);
            expect(out.message.to).toEqual(['demo@africgreen.africa']);
            // Une copie redirigée resterait un envoi non sollicité.
            expect(out.message.cc).toBeUndefined();
        });

        it('nomme les destinataires réels dans l’objet', () => {
            const out = applyEmailRedirect({
                to: 'armateur@exemple.com',
                cc: ['agent@exemple.com'],
                subject: 'Relance J+7',
            });

            expect(out.message.subject).toBe(
                '[REDIRIGÉ → armateur@exemple.com, agent@exemple.com] Relance J+7',
            );
            expect(out.originalRecipients).toEqual([
                'armateur@exemple.com',
                'agent@exemple.com',
            ]);
        });

        it('ajoute une bannière au texte et au HTML, sans perdre le corps', () => {
            const out = applyEmailRedirect({
                to: 'armateur@exemple.com',
                subject: 's',
                html: '<p>montant dû</p>',
                text: 'montant dû',
            });

            expect(out.message.text).toContain('ENVOI REDIRIGÉ');
            expect(out.message.text).toContain('armateur@exemple.com');
            expect(out.message.text).toContain('montant dû');
            expect(out.message.html).toContain('Envoi redirigé');
            expect(out.message.html).toContain('<p>montant dû</p>');
        });

        it("n'invente pas de champ absent", () => {
            const message: Redirectable = { to: 'a@b.c', subject: 's', text: 'corps' };
            const out = applyEmailRedirect(message);
            expect(out.message.html).toBeUndefined();
        });

        it('échappe le HTML des adresses, qui viennent de la base', () => {
            const out = applyEmailRedirect({
                to: '<script>alert(1)</script>@exemple.com',
                subject: 's',
                html: '<p>x</p>',
            });
            expect(out.message.html).not.toContain('<script>');
            expect(out.message.html).toContain('&lt;script&gt;');
        });

        it('reste lisible quand aucun destinataire n’a été résolu', () => {
            const out = applyEmailRedirect({ to: [], subject: 's', text: 'corps' });
            expect(out.message.to).toEqual(['demo@africgreen.africa']);
            expect(out.message.subject).toContain('aucun destinataire résolu');
        });
    });
});
