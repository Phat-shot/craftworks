// Shared "comic map" rendering — bold outlines, flat comic-style colors for
// real building/path/vegetation footprints fetched from OpenStreetMap Overpass
// (see server/src/socket.js fetchComicMapFeatures). One place for the look,
// shared by LobbyScreen (preview) and GameScreen (in-match 'comic' view) so
// restyling it later only means editing this file.
import React, { useMemo } from 'react';
import { ShapeSource, FillLayer, LineLayer, FillExtrusionLayer } from '@maplibre/maplibre-react-native';

export interface ComicFeature {
  type: 'building' | 'road' | 'path' | 'forest' | 'water' | 'grass';
  points: { lat: number; lon: number }[];
}

const FILL_TYPES = new Set(['building', 'forest', 'water', 'grass']);
const STYLE: Record<ComicFeature['type'], { fill?: string; line: string; width: number }> = {
  building: { fill: '#e8a94c', line: '#3a2410', width: 2 },
  forest:   { fill: '#5fae52', line: '#2d5a26', width: 1.5 },
  water:    { fill: '#5ab4e0', line: '#1a5f7a', width: 1.5 },
  grass:    { fill: '#a8d66a', line: '#5d8a3a', width: 1 },
  path:     { line: '#c9a86a', width: 2 },
  road:     { line: '#707070', width: 3 },
};

export default function ComicMapLayers({ features }: { features: ComicFeature[] }) {
  const { fillsGeoJSON, linesGeoJSON } = useMemo(() => {
    const fills: any[] = [];
    const lines: any[] = [];
    for (const f of features || []) {
      const style = STYLE[f.type];
      if (!style || !f.points || f.points.length < 2) continue;
      const coords = f.points.map(p => [p.lon, p.lat]);
      if (FILL_TYPES.has(f.type)) {
        const first = coords[0]!, last = coords[coords.length - 1]!;
        const ring = (first[0] === last[0] && first[1] === last[1]) ? coords : [...coords, first];
        // No real OSM height data (not fetched) — a small deterministic
        // pseudo-random height per building (seeded from its own footprint,
        // so it's stable across re-renders) gives the pitched 3D view a
        // varied "toy city" look instead of uniform slabs.
        const seed = coords.reduce((s, [lon, lat]) => s + Math.abs(lon * 1e5 % 1) + Math.abs(lat * 1e5 % 1), 0);
        const height = f.type === 'building' ? 6 + (seed % 1) * 10 : 0;
        fills.push({
          type: 'Feature', properties: { fill: style.fill, line: style.line, width: style.width, kind: f.type, height },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      } else {
        lines.push({
          type: 'Feature', properties: { line: style.line, width: style.width },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    }
    return {
      fillsGeoJSON: { type: 'FeatureCollection' as const, features: fills },
      linesGeoJSON: { type: 'FeatureCollection' as const, features: lines },
    };
  }, [features]);

  return (
    <>
      {fillsGeoJSON.features.length > 0 && (
        <ShapeSource id="comicFills" shape={fillsGeoJSON as any}>
          <FillLayer id="comicFillLayer" style={{ fillColor: ['get', 'fill'] as any, fillOpacity: 0.85 }} />
          <LineLayer id="comicFillOutline" style={{ lineColor: ['get', 'line'] as any, lineWidth: ['get', 'width'] as any }} />
          {/* 3D pop-up for buildings only (height 0 for forest/water/grass —
              filtered out entirely so ground cover never extrudes) — needs
              the map's Camera to have a pitch to actually read as 3D. */}
          <FillExtrusionLayer id="comicBuildingExtrusion"
            filter={['==', ['get', 'kind'], 'building']}
            style={{
              fillExtrusionColor: ['get', 'fill'] as any,
              fillExtrusionHeight: ['get', 'height'] as any,
              fillExtrusionOpacity: 0.9,
            }} />
        </ShapeSource>
      )}
      {linesGeoJSON.features.length > 0 && (
        <ShapeSource id="comicLines" shape={linesGeoJSON as any}>
          <LineLayer id="comicLineLayer" style={{ lineColor: ['get', 'line'] as any, lineWidth: ['get', 'width'] as any }} />
        </ShapeSource>
      )}
    </>
  );
}
