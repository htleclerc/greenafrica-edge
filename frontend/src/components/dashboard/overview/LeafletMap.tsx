'use client';

import * as React from 'react';
import { SecureVessel, VesselComplianceStatus } from '@/types/secure';

// ── Somaliland EEZ boundary (approximate) ────────────────────────────────────

const EEZ_POLYGON: [number, number][] = [
    [11.45, 43.25],
    [11.35, 43.50],
    [11.30, 44.00],
    [11.15, 44.50],
    [11.05, 45.00],
    [10.90, 45.50],
    [10.95, 46.00],
    [11.05, 46.50],
    [11.10, 47.00],
    [11.20, 47.50],
    [11.30, 48.00],
    [11.50, 48.50],
    [12.50, 48.50],
    [13.00, 48.00],
    [13.20, 47.50],
    [13.30, 47.00],
    [13.20, 46.50],
    [13.00, 46.00],
    [12.80, 45.50],
    [12.60, 45.00],
    [12.40, 44.50],
    [12.30, 44.00],
    [12.20, 43.50],
    [12.10, 43.25],
];

const BERBERA: [number, number] = [10.44, 45.04];

// ── Map style overrides ──────────────────────────────────────────────────────

const MAP_STYLE = `
.leaflet-container { background: var(--os-bg, #060D1A) !important; }
.leaflet-control-zoom { display: none !important; }
.leaflet-control-attribution {
    background: rgba(6,13,26,0.8) !important;
    color: rgba(255,255,255,0.3) !important;
    font-size: 9px !important;
    padding: 2px 6px !important;
    border-radius: 4px 0 0 0 !important;
}
.leaflet-control-attribution a { color: rgba(255,255,255,0.4) !important; }
@keyframes leaflet-ping {
    75%, 100% { transform: scale(1.6); opacity: 0; }
}
.vessel-tooltip {
    background: var(--os-surface, rgba(17,28,24,0.95)) !important;
    border: 1px solid rgba(16,185,129,0.2) !important;
    border-radius: 8px !important;
    color: var(--os-text-primary, #E8EDE6) !important;
    font-size: 11px !important;
    padding: 6px 10px !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
}
.vessel-tooltip::before,
.leaflet-tooltip-top::before { border-top-color: rgba(16,185,129,0.2) !important; }
.leaflet-tooltip-bottom::before { border-bottom-color: rgba(16,185,129,0.2) !important; }
`;

// ── Main component ───────────────────────────────────────────────────────────

interface LeafletMapProps {
    vessels: SecureVessel[];
    selectedId: string | null;
    onSelectVessel: (id: string) => void;
    dotColor: Record<VesselComplianceStatus, string>;
    t: (key: string) => string;
}

export default function LeafletMap({ vessels, selectedId, onSelectVessel, dotColor, t }: LeafletMapProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const markersRef = React.useRef<L.Marker[]>([]);
    const portMarkerRef = React.useRef<L.Marker | null>(null);
    const [ready, setReady] = React.useState(false);

    // Lazy-load Leaflet (client-side only)
    const LRef = React.useRef<typeof import('leaflet') | null>(null);

    React.useEffect(() => {
        let cancelled = false;

        async function init() {
            // Dynamically import leaflet
            const L = await import('leaflet');
            // @ts-ignore - CSS import handled by bundler
            await import('leaflet/dist/leaflet.css');

            if (cancelled || !containerRef.current) return;
            LRef.current = L;

            // Create map
            const map = L.map(containerRef.current, {
                center: [11.8, 45.5],
                zoom: 7,
                zoomControl: false,
                maxBounds: [[8, 40], [16, 52]],
                minZoom: 6,
                maxZoom: 12,
            });

            mapRef.current = map;

            // Dark tiles
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
            }).addTo(map);

            // Labels on top
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
                subdomains: 'abcd',
            }).addTo(map);

            // EEZ boundary
            L.polygon(EEZ_POLYGON, {
                color: '#38BDF8',
                weight: 1.5,
                dashArray: '8, 6',
                fillColor: '#38BDF8',
                fillOpacity: 0.03,
            }).addTo(map);

            // Berbera port marker
            const portIcon = L.divIcon({
                className: '',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                html: `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;position:relative">
                    <div style="width:14px;height:14px;border-radius:50%;background:#F59E0B;border:2px solid #0A1110;box-shadow:0 0 12px rgba(245,158,11,0.5)"></div>
                    <div style="position:absolute;width:28px;height:28px;border-radius:50%;border:1.5px solid rgba(245,158,11,0.3);animation:leaflet-ping 2s cubic-bezier(0,0,0.2,1) infinite"></div>
                </div>`,
            });

            portMarkerRef.current = L.marker(BERBERA, { icon: portIcon })
                .addTo(map)
                .bindTooltip('<span style="font-weight:bold;color:#F59E0B">Berbera Port</span>', {
                    direction: 'right',
                    offset: [12, 0],
                    permanent: true,
                    className: 'vessel-tooltip',
                });

            // Force tile load after container gets final dimensions
            setTimeout(() => {
                if (!cancelled && map) {
                    map.invalidateSize();
                }
            }, 200);

            setReady(true);
        }

        init();

        return () => {
            cancelled = true;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    // ── Keep map size in sync with container ─────────────────────────────────
    React.useEffect(() => {
        const map = mapRef.current;
        const el = containerRef.current;
        if (!map || !el || !ready) return;

        const observer = new ResizeObserver(() => {
            map.invalidateSize();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ready]);

    // ── Update vessel markers when data changes ──────────────────────────────
    React.useEffect(() => {
        const map = mapRef.current;
        const L = LRef.current;
        if (!map || !L || !ready) return;

        // Clear old markers
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        // Add new markers
        vessels.forEach((v) => {
            const color = dotColor[v.complianceStatus];
            const isSelected = selectedId === v.id;
            const size = isSelected ? 28 : 20;
            const glow = isSelected ? `drop-shadow(0 0 6px ${color})` : `drop-shadow(0 0 3px ${color}80)`;

            const icon = L.divIcon({
                className: '',
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
                html: `<div style="width:${size}px;height:${size}px;filter:${glow};transform:rotate(${v.position.heading}deg);transition:all 300ms ease">
                    <svg viewBox="0 0 24 24" fill="none" width="${size}" height="${size}">
                        <path d="M12 2L6 18L12 15L18 18L12 2Z" fill="${color}" stroke="${color}" stroke-width="0.5" stroke-linejoin="round"/>
                    </svg>
                </div>`,
            });

            const marker = L.marker([v.position.lat, v.position.lng], { icon })
                .addTo(map)
                .bindTooltip(`<div><span style="font-weight:bold">${v.name}</span><br/><span style="color:${color};font-size:10px">${v.position.speedKnots} kn · ${v.position.heading}°</span></div>`, {
                    direction: 'top',
                    offset: [0, -12],
                    className: 'vessel-tooltip',
                })
                .on('click', () => onSelectVessel(v.id));

            markersRef.current.push(marker);
        });
    }, [vessels, selectedId, dotColor, onSelectVessel, ready]);

    // ── Fly to selected vessel ───────────────────────────────────────────────
    React.useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;
        const vessel = vessels.find((v) => v.id === selectedId);
        if (vessel) {
            map.flyTo([vessel.position.lat, vessel.position.lng], 9, { duration: 0.8 });
        }
    }, [selectedId, vessels, ready]);

    return (
        <div className="flex-1 relative" style={{ minHeight: 400 }}>
            <style>{MAP_STYLE}</style>
            <div ref={containerRef} className="absolute inset-0" />

            {/* Zoom controls */}
            {ready && (
                <div className="absolute top-3 right-3 flex flex-col gap-1 z-[1000]">
                    <button
                        onClick={() => mapRef.current?.zoomIn()}
                        title={t('map_zoom_in')}
                        className="w-8 h-8 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[#10B981] hover:border-[#10B981]/30 transition-colors"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                    <button
                        onClick={() => mapRef.current?.zoomOut()}
                        title={t('map_zoom_out')}
                        className="w-8 h-8 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[#10B981] hover:border-[#10B981]/30 transition-colors"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M5 12h14" /></svg>
                    </button>
                    <button
                        onClick={() => mapRef.current?.setView([11.8, 45.5], 7, { animate: true })}
                        title={t('map_reset_view')}
                        className="w-8 h-8 rounded-lg bg-[var(--os-surface)] border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[#10B981] hover:border-[#10B981]/30 transition-colors"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                    </button>
                </div>
            )}

            {/* Legend */}
            <div className="absolute bottom-3 left-3 bg-[rgba(var(--os-bg),0.9)] border border-[var(--os-border)] rounded-xl p-3 text-[10px] z-[1000] backdrop-blur-sm"
                style={{ backgroundColor: 'var(--os-surface)' }}
            >
                <p className="font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('map_vessel_status')}</p>
                {[
                    { label: t('legend_compliant'), color: '#22C55E' },
                    { label: t('legend_approaching'), color: '#F59E0B' },
                    { label: t('legend_non_compliant'), color: '#EF4444' },
                    { label: t('legend_exempt'), color: '#38BDF8' },
                ].map(({ label, color }) => (
                    <div key={label} className="flex items-center gap-2 mb-1 last:mb-0">
                        <svg viewBox="0 0 24 24" fill={color} className="w-3 h-3 flex-shrink-0" style={{ filter: `drop-shadow(0 0 3px ${color}80)` }}>
                            <path d="M12 2L6 18L12 15L18 18L12 2Z" />
                        </svg>
                        <span className="text-[var(--os-text-secondary)]">{label}</span>
                    </div>
                ))}
                <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-[var(--os-border)]">
                    <span className="w-5 border-t-[1.5px] border-dashed border-[#38BDF8] flex-shrink-0" />
                    <span className="text-[var(--os-text-secondary)]">{t('legend_eez_boundary')}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] flex-shrink-0" style={{ boxShadow: '0 0 6px rgba(245,158,11,0.5)' }} />
                    <span className="text-[var(--os-text-secondary)]">Berbera Port</span>
                </div>
            </div>
        </div>
    );
}
