// Minimal MapLibre style: OSM raster tiles, no API key, no vendor account.
export const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

// Solid-color backdrop for the "comic map" view — deliberately no real tiles
// underneath, so the host-fetched building/path/vegetation shapes (see
// ComicMapLayers) read as our own generated map, not real photography peeking
// through a stylized overlay.
export const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#f3e9d2' } }],
};
