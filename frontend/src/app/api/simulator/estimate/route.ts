import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateInvoicePdf, type InvoiceData } from '@/services/invoiceService';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';

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

const estimateSchema = z.object({
    vesselCategory: z.string().min(1).max(60),
    fuelType: z.string().min(1).max(60),
    enginePowerKw: z.number().finite().nonnegative(),
    grossTonnage: z.number().finite().nonnegative(),
    speedKnots: z.number().finite().nonnegative(),
    eezDistanceNm: z.number().finite().nonnegative(),
    portStayHours: z.number().finite().nonnegative(),
    eezEmissionsTco2: z.number().finite().nonnegative(),
    portEmissionsTco2: z.number().finite().nonnegative(),
    totalCo2Tons: z.number().finite().nonnegative(),
    eezTaxUsd: z.number().finite().nonnegative(),
    portTaxUsd: z.number().finite().nonnegative(),
    totalTaxUsd: z.number().finite().nonnegative(),
    eezRate: z.number().finite().nonnegative(),
    portRate: z.number().finite().nonnegative(),
    effectiveRate: z.number().finite().nonnegative(),
    riskLevel: z.enum(['low', 'medium', 'high']),
}).strict();
type SimulatorEstimateInput = z.infer<typeof estimateSchema>;

export async function POST(request: NextRequest) {
    const rate = await enforceRateLimit('simulator-estimate', getClientId(request.headers));
    if (!rate.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    let body: SimulatorEstimateInput;
    try {
        body = estimateSchema.parse(await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const now = new Date();
    // Préfixe SIM- (et non EST-/INV-) : la référence elle-même doit signaler
    // qu'il s'agit d'une simulation, pas d'un document opposable.
    const estimateRef = `SIM-${now.getFullYear()}-${Math.floor(Math.random() * 999_999).toString().padStart(6, '0')}`;

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
        // Simulation : filigrane + bandeau « NOT AN OFFICIAL DOCUMENT » + badge
        // SIMULATION, pour qu'aucune pré-estimation ne puisse être présentée
        // comme un pro-forma réel (lui figé et opposable).
        const pdfBuffer = await generateInvoicePdf({
            ...invoiceData,
            mode: 'proforma',
            badge: 'SIMULATION',
            simulation: true,
        });

        // `inline` : le client prévisualise le PDF dans une modale et déclenche
        // lui-même le téléchargement (plus de download automatique surprise).
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${estimateRef}.pdf"`,
                'Cache-Control': 'no-store',
                // Permet au client de nommer le fichier téléchargé sans re-parser.
                'X-Estimate-Ref': estimateRef,
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
