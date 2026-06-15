'use server';

import { cookies } from 'next/headers';
import { ACTIVE_MODE_COOKIE, normalizeActiveMode, type ActiveMode } from '@/lib/auth/activeMode';

type SetActiveModeResult = { ok: true } | { ok: false };

const VALID_MODES: ActiveMode[] = ['MARITIME', 'AIR', 'BOTH'];

/**
 * Set the active mode filter cookie (maritime / air / both).
 * Validates the value before writing — invalid values are rejected.
 * This is a display preference, not a security boundary: the real scope
 * is enforced by RLS + jurisdiction. No auth check needed.
 */
export async function setActiveMode({ mode }: { mode: string }): Promise<SetActiveModeResult> {
    if (!VALID_MODES.includes(mode as ActiveMode)) return { ok: false };

    const store = await cookies();
    store.set(ACTIVE_MODE_COOKIE, normalizeActiveMode(mode), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year — display preference
    });

    return { ok: true };
}
