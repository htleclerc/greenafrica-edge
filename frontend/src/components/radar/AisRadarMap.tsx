'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
    ComposableMap,
    Geographies,
    Geography,
    Marker,
    ZoomableGroup
} from 'react-simple-maps';
import { mockAisVessels } from '@/mock/datas/aisMock';
import { AisVessel, VesselStatus } from '@/domain/ais/aisConstants';

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function AisRadarMap({ onSelectVessel }: { onSelectVessel: (v: AisVessel | null) => void }) {
    const t = useTranslations('Radar');
    const [mounted, setMounted] = useState(false);
    const [activeVesselId, setActiveVesselId] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const getStatusColor = (status: VesselStatus) => {
        switch (status) {
            case VesselStatus.PAID: return '#10B981'; // emerald-500
            case VesselStatus.UNPAID: return '#EF4444'; // red-500
            case VesselStatus.APPROACHING: return '#F59E0B'; // amber-500
            default: return '#94A3B8'; // slate-400
        }
    };

    if (!mounted) return <div className="w-full h-full animate-pulse rounded-2xl" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}></div>;

    return (
        <div className="w-full h-full relative rounded-2xl overflow-hidden group" style={{ backgroundColor: 'var(--ais-page-bg)', border: '1px solid var(--ais-page-border)' }}>
            {/* Map Overlay Styles */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(10,17,16,0.8)_100%)] z-10" />

            <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-md text-xs font-medium" style={{ border: '1px solid var(--ais-page-border)', color: 'var(--ais-page-text-secondary)' }}>
                    Somaliland EEZ (Gulf of Aden)
                </div>
            </div>

            <ComposableMap
                projection="geoMercator"
                projectionConfig={{
                    scale: 6000,
                    center: [45.01, 11.5] // Centered near Berbera/Gulf of Aden
                }}
                className="w-full h-full"
            >
                <ZoomableGroup zoom={1} minZoom={1} maxZoom={5} center={[45.01, 11.5]}>
                    <Geographies geography={geoUrl}>
                        {({ geographies }: any) =>
                            geographies.map((geo: any) => (
                                <Geography
                                    key={geo.rsmKey}
                                    geography={geo}
                                    fill="#13231F"
                                    stroke="#1D3630"
                                    strokeWidth={0.5}
                                    style={{
                                        default: { outline: "none" },
                                        hover: { outline: "none", fill: "#1A2E29" },
                                        pressed: { outline: "none" }
                                    }}
                                />
                            ))
                        }
                    </Geographies>

                    {mockAisVessels.map((vessel) => {
                        const color = getStatusColor(vessel.status);
                        const isActive = activeVesselId === vessel.id;
                        return (
                            <Marker
                                key={vessel.id}
                                coordinates={[vessel.coordinates.lng, vessel.coordinates.lat]}
                                onClick={() => {
                                    setActiveVesselId(vessel.id);
                                    onSelectVessel(vessel);
                                }}
                                className="cursor-pointer focus:outline-none"
                            >
                                <g className="transition-transform hover:scale-125 duration-300">
                                    {/* Pulse effect for non-paid vessels */}
                                    {vessel.status !== VesselStatus.PAID && (
                                        <circle
                                            r={isActive ? 12 : 8}
                                            fill={color}
                                            opacity={isActive ? 0.4 : 0.2}
                                            className="animate-ping"
                                        />
                                    )}
                                    {/* Core vessel marker */}
                                    <circle
                                        r={isActive ? 6 : 4}
                                        fill={color}
                                        stroke="#0A1110"
                                        strokeWidth={1.5}
                                    />
                                    {/* Vessel Name Tag on hover/active */}
                                    {isActive && (
                                        <text
                                            textAnchor="middle"
                                            y={-12}
                                            style={{
                                                fontFamily: "system-ui",
                                                fill: "#FFFFFF",
                                                fontSize: "8px",
                                                fontWeight: "bold",
                                                filter: "drop-shadow(0px 1px 2px rgba(0,0,0,0.8))"
                                            }}
                                        >
                                            {vessel.name}
                                        </text>
                                    )}
                                </g>
                            </Marker>
                        );
                    })}
                </ZoomableGroup>
            </ComposableMap>

            {/* Disclaimer overlay at bottom */}
            <div className="absolute bottom-4 left-4 right-4 z-20 text-center">
                <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--ais-page-text-dim)' }}>
                    {t('map_disclaimer')}
                </p>
            </div>
        </div>
    );
}
