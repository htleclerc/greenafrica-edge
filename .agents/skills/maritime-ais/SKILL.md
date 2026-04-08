# Maritime AIS Specialist

## Trigger
When working on vessel tracking, AIS data, MMSI codes, EEZ detection, port operations, maps, or vessel positions.

## Context
- Types: `Vessel`, `VesselPosition`, `VesselCategory` in `frontend/src/types/secure/index.ts`
- Vessels hook: `frontend/src/hooks/useVessels.ts`
- Inspections: `frontend/src/hooks/useInspections.ts`
- Mock data: `mockSecureVessels` in `frontend/src/mock/datas/secureMock.ts`
- Map library: react-leaflet v5 + leaflet v1.9

## Key Concepts
- **MMSI**: 9-digit Maritime Mobile Service Identity (always validate length)
- **EEZ**: Exclusive Economic Zone — determines tax jurisdiction
- **AIS**: Automatic Identification System — vessel position broadcasts
- **IMO**: International Maritime Organization number

## Vessel Compliance Flow
```
APPROACHING → PROCESSING → COMPLIANT | PAYMENT_DUE → NON_COMPLIANT
```

## Rules
1. All map coordinates in WGS84 (lat/lng decimal degrees)
2. Use react-leaflet for maps (already installed)
3. Vessel icons must vary by VesselCategory
4. Status badges via OsBadge component with appropriate variant
5. MMSI codes are exactly 9 digits — validate on input
6. Position data includes heading, speed, timestamp
7. EEZ boundaries are polygon data — use point-in-polygon for jurisdiction checks
