'use client';

import { useMemo } from 'react';
import { useTransactions } from './useTransactions';
import { useVessels } from './useVessels';
import { useKpis } from './useKpis';
import type { Transaction, SecureVessel } from '@/types/secure';
import { TransactionStatus, JurisdictionZone } from '@/types/secure';

// ── Static trend data — will be replaced by /api/tco/analytics in V2 ────────

const COST_TREND_MONTHS = [
    { month: 'Apr', cost: 28_400 },
    { month: 'May', cost: 31_200 },
    { month: 'Jun', cost: 29_800 },
    { month: 'Jul', cost: 35_600 },
    { month: 'Aug', cost: 38_100 },
    { month: 'Sep', cost: 33_900 },
    { month: 'Oct', cost: 41_200 },
    { month: 'Nov', cost: 44_500 },
    { month: 'Dec', cost: 39_800 },
    { month: 'Jan', cost: 46_200 },
    { month: 'Feb', cost: 52_100 },
    { month: 'Mar', cost: 48_700 },
];

const REVENUE_TREND_MONTHS = [
    { month: 'Apr', revenue: 85_000 },
    { month: 'May', revenue: 102_000 },
    { month: 'Jun', revenue: 94_500 },
    { month: 'Jul', revenue: 118_000 },
    { month: 'Aug', revenue: 135_200 },
    { month: 'Sep', revenue: 121_000 },
    { month: 'Oct', revenue: 148_500 },
    { month: 'Nov', revenue: 162_000 },
    { month: 'Dec', revenue: 145_800 },
    { month: 'Jan', revenue: 178_000 },
    { month: 'Feb', revenue: 195_500 },
    { month: 'Mar', revenue: 210_000 },
];

export interface CostByVessel {
    vesselName: string;
    vesselId: string;
    emissions: number;
    taxAmount: number;
    status: string;
}

export interface CostByZone {
    zone: string;
    value: number;
}

export interface TcoData {
    // Shipping agent view
    totalTax: number;
    totalEmissions: number;
    fleetSize: number;
    avgCostPerVessel: number;
    costByVessel: CostByVessel[];
    costTrend: { month: string; cost: number }[];
    costByZone: CostByZone[];

    // Finance / admin view
    totalRevenue: number;
    avgTaxPerVessel: number;
    collectionRate: number;
    activeConfigs: number;
    revenueTrend: { month: string; revenue: number }[];
    revenueByCategory: { category: string; revenue: number }[];
    topVessels: { vesselName: string; revenue: number }[];
    revenueByZone: { zone: string; revenue: number; vessels: number }[];
}

export function useTco(): { data: TcoData; loading: boolean } {
    const { data: transactions } = useTransactions();
    const { data: vessels } = useVessels();
    const { data: kpis } = useKpis();

    const data = useMemo<TcoData>(() => {
        const txns = transactions ?? [];
        const vslList = vessels ?? [];

        // ── Shipping agent aggregations ──────────────────────────────────────

        const totalTax = txns.reduce((s, t) => s + t.taxAmountUsd, 0);
        const totalEmissions = txns.reduce((s, t) => s + t.emissionsTco2, 0);
        const fleetSize = vslList.length;
        const avgCostPerVessel = fleetSize > 0 ? totalTax / fleetSize : 0;

        // Cost by vessel — aggregate transactions per vessel
        const vesselMap = new Map<string, CostByVessel>();
        txns.forEach((t: Transaction) => {
            const existing = vesselMap.get(t.vesselId);
            if (existing) {
                existing.emissions += t.emissionsTco2;
                existing.taxAmount += t.taxAmountUsd;
            } else {
                const vessel = vslList.find((v: SecureVessel) => v.id === t.vesselId);
                vesselMap.set(t.vesselId, {
                    vesselName: t.vesselName,
                    vesselId: t.vesselId,
                    emissions: t.emissionsTco2,
                    taxAmount: t.taxAmountUsd,
                    status: vessel?.complianceStatus ?? t.status,
                });
            }
        });
        const costByVessel = Array.from(vesselMap.values()).sort((a, b) => b.taxAmount - a.taxAmount);

        // Cost by zone — derived from transaction type mapping
        const zoneMap: Record<string, number> = {
            [JurisdictionZone.EEZ]: 0,
            [JurisdictionZone.PORT_VICINITY]: 0,
            [JurisdictionZone.TRANSIT_LANE]: 0,
        };
        txns.forEach((t: Transaction) => {
            if (t.transactionType === 'ENTRY_TAX') zoneMap[JurisdictionZone.EEZ] += t.taxAmountUsd;
            else if (t.transactionType === 'PORT_STAY') zoneMap[JurisdictionZone.PORT_VICINITY] += t.taxAmountUsd;
            else if (t.transactionType === 'TRANSIT_FEE') zoneMap[JurisdictionZone.TRANSIT_LANE] += t.taxAmountUsd;
        });
        const costByZone: CostByZone[] = Object.entries(zoneMap).map(([zone, value]) => ({ zone, value }));

        // ── Finance / admin aggregations ─────────────────────────────────────

        const paidTxns = txns.filter((t: Transaction) => t.status === TransactionStatus.PAID);
        const totalRevenue = paidTxns.reduce((s, t) => s + t.taxAmountUsd, 0);
        const processedVessels = kpis?.vesselsProcessed ?? vslList.length;
        const avgTaxPerVessel = processedVessels > 0 ? totalRevenue / processedVessels : 0;
        const collectionRate = txns.length > 0 ? (paidTxns.length / txns.length) * 100 : 0;
        const activeConfigs = 4; // static — from mock tax configs

        // Revenue by vessel category
        const catMap = new Map<string, number>();
        txns.forEach((t: Transaction) => {
            const vessel = vslList.find((v: SecureVessel) => v.id === t.vesselId);
            const cat = vessel?.category ?? 'OTHER';
            catMap.set(cat, (catMap.get(cat) ?? 0) + t.taxAmountUsd);
        });
        const revenueByCategory = Array.from(catMap.entries())
            .map(([category, revenue]) => ({ category, revenue }))
            .sort((a, b) => b.revenue - a.revenue);

        // Top 10 contributing vessels
        const topVessels = costByVessel.slice(0, 10).map((v) => ({
            vesselName: v.vesselName,
            revenue: v.taxAmount,
        }));

        // Revenue by zone
        const revenueByZone = costByZone.map((z) => {
            const vesselCount = txns.filter((t: Transaction) => {
                if (z.zone === JurisdictionZone.EEZ) return t.transactionType === 'ENTRY_TAX';
                if (z.zone === JurisdictionZone.PORT_VICINITY) return t.transactionType === 'PORT_STAY';
                return t.transactionType === 'TRANSIT_FEE';
            }).length;
            return { zone: z.zone, revenue: z.value, vessels: vesselCount };
        });

        return {
            totalTax,
            totalEmissions,
            fleetSize,
            avgCostPerVessel,
            costByVessel,
            costTrend: COST_TREND_MONTHS,
            costByZone,
            totalRevenue,
            avgTaxPerVessel,
            collectionRate,
            activeConfigs,
            revenueTrend: REVENUE_TREND_MONTHS,
            revenueByCategory,
            topVessels,
            revenueByZone,
        };
    }, [transactions, vessels, kpis]);

    return { data, loading: false };
}
