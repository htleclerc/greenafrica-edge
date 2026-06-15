import { NextResponse } from 'next/server';

// Public staff self-registration is retired — staff are created via admin
// invitation (inviteStaff, Phase 2). Operator self-service uses server actions
// (registerShipowner / registerAirOperator), not this route.
export async function POST() {
    return NextResponse.json(
        { error: 'Gone — staff registration is invite-only' },
        { status: 410 },
    );
}
