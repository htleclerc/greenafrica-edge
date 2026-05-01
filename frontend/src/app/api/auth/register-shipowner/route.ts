import { NextRequest, NextResponse } from 'next/server';
import { registerShipowner } from '@/actions/registerShipowner';

function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
        ?? req.headers.get('x-real-ip')
        ?? '127.0.0.1';
}

export async function POST(req: NextRequest) {
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 }); }

    const ip = getClientIp(req);
    const result = await registerShipowner(body as never, ip);
    const status = result.ok
        ? 200
        : (result.message.startsWith('Too many') ? 429 : 400);
    return NextResponse.json(result, { status });
}
