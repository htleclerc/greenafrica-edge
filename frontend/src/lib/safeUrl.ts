/**
 * Returns `url` only when it is an http(s) URL; otherwise undefined.
 * Use at every render site that puts user-supplied text into an href/src —
 * javascript:, data:, and vbscript: schemes execute or navigate dangerously.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
    } catch {
        return undefined;
    }
}
