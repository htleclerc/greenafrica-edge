import { NextRequest, NextResponse } from 'next/server';
import { generateInvoicePdf, type InvoiceData } from '@/services/invoiceService';

/**
 * POST /api/simulator/estimate
 *
 * Generates a pre-estimate PDF (no DB writes, no Storage upload).
 * The simulator gives instant feedback — the user can download an
 * estimate document for sharing with stakeholders before any real
 * transaction is created.
 *
 * Body: SimulatorEstimateInput
 * Returns: PDF binary stream (application/pdf)
 */

interface SimulatorEstimateInput {
    vesselCategory: string;
    fuelType: string;
    enginePowerKw: number;
    grossTonnage: number;
    speedKnots: number;
    eezDistanceNm: number;
    portStayHours: number;
    eezEmissionsTco2: number;
    portEmissionsTco2: number;
    totalCo2Tons: number;
    eezTaxUsd: number;
    portTaxUsd: number;
    totalTaxUsd: number;
    eezRate: number;
    portRate: number;
    effectiveRate: number;
    riskLevel: 'low' | 'medium' | 'high';
}

export async function POST(request: NextRequest) {
    let body: SimulatorEstimateInput;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.totalTaxUsd && body.totalTaxUsd !== 0) {
        return NextResponse.json({ error: 'Missing totalTaxUsd' }, { status: 400 });
    }

    const now = new Date();
    const estimateRef = `EST-${now.getFullYear()}-${Math.floor(Math.random() * 999_999).toString().padStart(6, '0')}`;

    // Build InvoiceData shape — labels reflect that this is a pre-estimate
    const invoiceData: InvoiceData = {
        invoiceRef: estimateRef,
        vesselName: `${body.vesselCategory.replace('_', ' ')} (${body.enginePowerKw.toLocaleString()} kW)`,
        vesselImo: '— pre-estimate —',
        vesselMmsi: '— pre-estimate —',
        ownerName: 'Prospective Vessel Operator',
        // Neutral label — no sovereign named; simulator has no jurisdiction context.
        jurisdiction: 'Carbon tax estimate (simulation)',
        periodStart: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        periodEnd: 'Estimate only — not a binding invoice',
        emissionsTco2: body.totalCo2Tons,
        ratePerTco2: body.effectiveRate,
        subtotalUsd: body.totalTaxUsd,
        exemptionUsd: 0,
        totalUsd: body.totalTaxUsd,
        lineItems: [
            {
                zone: 'EEZ',
                days: Math.max(1, Math.round(body.eezDistanceNm / Math.max(body.speedKnots, 1) / 24)),
                emissionsTco2: body.eezEmissionsTco2,
                rate: body.eezRate,
                amount: body.eezTaxUsd,
            },
            ...(body.portTaxUsd > 0
                ? [{
                    zone: 'PORT_VICINITY',
                    days: Math.max(1, Math.round(body.portStayHours / 24)),
                    emissionsTco2: body.portEmissionsTco2,
                    rate: body.portRate,
                    amount: body.portTaxUsd,
                }]
                : []),
        ],
    };

    try {
        // Pre-estimate is always a "proforma TO PAY" by definition
        const pdfBuffer = await generateInvoicePdf({
            ...invoiceData,
            mode: 'proforma',
            badge: 'TO PAY',
        });

        // Return binary PDF directly so the browser can save it
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${estimateRef}.pdf"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        console.error('[Estimate API] Failed:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'PDF generation failed' },
            { status: 500 },
        );
    }
}
