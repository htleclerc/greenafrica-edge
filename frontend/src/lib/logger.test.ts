import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, scopedLogger, log } from './logger';

describe('lib/logger', () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        spy.mockRestore();
    });

    function parseLastCall(): Record<string, unknown> {
        const arg = spy.mock.calls[spy.mock.calls.length - 1]?.[0];
        expect(typeof arg).toBe('string');
        return JSON.parse(arg as string);
    }

    describe('logger.info / flat API', () => {
        it('emits a single JSON line with the right fields', () => {
            logger.info('a', 'b', { foo: 1 });
            expect(spy).toHaveBeenCalledTimes(1);
            const entry = parseLastCall();
            expect(entry.level).toBe('info');
            expect(entry.scope).toBe('a');
            expect(entry.event).toBe('b');
            expect(entry.foo).toBe(1);
        });

        it('timestamp is ISO 8601', () => {
            logger.info('s', 'e');
            const entry = parseLastCall();
            expect(typeof entry.ts).toBe('string');
            // ISO 8601 like 2026-05-13T10:11:12.345Z
            expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('works with no context (warn)', () => {
            logger.warn('s', 'e');
            const entry = parseLastCall();
            expect(entry.level).toBe('warn');
            expect(entry.scope).toBe('s');
            expect(entry.event).toBe('e');
            // No accidental extra keys beyond the 4 core fields.
            expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'scope', 'ts']);
        });

        it('supports all 4 levels', () => {
            logger.debug('s', 'd');
            logger.info('s', 'i');
            logger.warn('s', 'w');
            logger.error('s', 'er');
            const levels = spy.mock.calls.map(
                (c: unknown[]) => JSON.parse(c[0] as string).level,
            );
            expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
        });
    });

    describe('scopedLogger', () => {
        it('binds scope to all calls', () => {
            const slog = scopedLogger('confirmPayment');
            slog.error('payment_rejected', { id: 'x' });
            const entry = parseLastCall();
            expect(entry.scope).toBe('confirmPayment');
            expect(entry.level).toBe('error');
            expect(entry.event).toBe('payment_rejected');
            expect(entry.id).toBe('x');
        });

        it('supports all 4 levels with bound scope', () => {
            const slog = scopedLogger('myScope');
            slog.debug('d');
            slog.info('i');
            slog.warn('w');
            slog.error('er');
            const entries = spy.mock.calls.map(
                (c: unknown[]) => JSON.parse(c[0] as string) as Record<string, unknown>,
            );
            expect(entries.every((e: Record<string, unknown>) => e.scope === 'myScope')).toBe(true);
            expect(entries.map((e: Record<string, unknown>) => e.level)).toEqual([
                'debug',
                'info',
                'warn',
                'error',
            ]);
        });
    });

    describe('isolation', () => {
        it('multiple log calls do not share mutable state', () => {
            logger.info('s', 'e1', { a: 1 });
            logger.info('s', 'e2', { b: 2 });
            const first = JSON.parse(spy.mock.calls[0][0] as string);
            const second = JSON.parse(spy.mock.calls[1][0] as string);
            expect(first.a).toBe(1);
            expect(first.b).toBeUndefined();
            expect(second.b).toBe(2);
            expect(second.a).toBeUndefined();
        });
    });

    describe('log() low-level', () => {
        it('emits with the given level + ctx', () => {
            log('error', 'cron', 'failed', { kind: 'reconcile' });
            const entry = parseLastCall();
            expect(entry.level).toBe('error');
            expect(entry.scope).toBe('cron');
            expect(entry.event).toBe('failed');
            expect(entry.kind).toBe('reconcile');
        });

        it('defaults context to {} when omitted', () => {
            log('info', 's', 'e');
            const entry = parseLastCall();
            expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'scope', 'ts']);
        });
    });
});
