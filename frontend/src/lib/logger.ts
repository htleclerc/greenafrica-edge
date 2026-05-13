/**
 * Structured JSON logger for server-side observability (Plan 7H-3).
 *
 * Use at every meaningful state transition in payment / wallet / refund
 * server actions, cron routes, and webhook handlers. Emits to stdout
 * (`console.log`) which Vercel captures via its log drain.
 *
 * Format:
 *   { ts, level, scope, event, ...context }
 *
 * Conventions:
 * - Levels: 'debug' | 'info' | 'warn' | 'error'
 * - Scope:  short identifier of the call site (e.g. 'confirmPayment', 'stripe-webhook')
 * - Event:  snake_case verb describing what happened
 *           (e.g. 'payment_confirmed', 'wallet_drift_detected')
 *
 * Sensitive data: NEVER log raw IBAN, full email bodies, JWT tokens, or full
 * Stripe API responses (truncate stripe payloads to ids + status only).
 *
 * DO log: IDs (payment, transaction, shipowner), status transitions
 * (`from → to`), amount + currency + rail (not bank account numbers),
 * `Error.message` only (not the full stack — Vercel captures stacks
 * separately on uncaught errors).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    ts: string;
    level: LogLevel;
    scope: string;
    event: string;
    [key: string]: unknown;
}

function emit(entry: LogEntry): void {
    // Single-line JSON for Vercel log drains and `vercel logs` CLI.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
}

export function log(
    level: LogLevel,
    scope: string,
    event: string,
    context: Record<string, unknown> = {},
): void {
    emit({
        ts: new Date().toISOString(),
        level,
        scope,
        event,
        ...context,
    });
}

export const logger = {
    debug: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('debug', scope, event, ctx),
    info: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('info', scope, event, ctx),
    warn: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('warn', scope, event, ctx),
    error: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('error', scope, event, ctx),
};

/**
 * Bound logger that auto-fills scope on every call.
 *
 * Idiom for actions / cron routes / webhook handlers:
 *   const log = scopedLogger('confirmPayment');
 *   log.info('action_invoked', { paymentId, userId: actor.id });
 */
export function scopedLogger(scope: string) {
    return {
        debug: (event: string, ctx?: Record<string, unknown>) => log('debug', scope, event, ctx),
        info: (event: string, ctx?: Record<string, unknown>) => log('info', scope, event, ctx),
        warn: (event: string, ctx?: Record<string, unknown>) => log('warn', scope, event, ctx),
        error: (event: string, ctx?: Record<string, unknown>) => log('error', scope, event, ctx),
    };
}
