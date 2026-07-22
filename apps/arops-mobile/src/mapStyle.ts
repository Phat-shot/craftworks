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

// Same OSM raster source, with raster paint properties applied to fake a
// "dark mode" look. There's no vendor account/API key for an actual dark
// tile provider (CartoDB Dark Matter, Stadia, …), so this darkens the stock
// light OSM tiles in-place instead of switching sources:
//   - raster-brightness-min/-max clamp the tile's rendered brightness range —
//     capping -max well below 1 is what pulls the tile's near-white/cream
//     background down into dark gray; -min stays 0 so already-dark pixels
//     (road outlines, text) don't get lifted into washed-out gray
//   - raster-hue-rotate 180° pushes what's left of the tile's warm cream/tan
//     paper color toward cool blue/navy once it's dark, which is what reads
//     as an intentional "dark map" (Google/Apple Maps night style) instead of
//     just a dimmed screenshot of the day map
//   - raster-saturation pulled down so that hue-rotated color doesn't come
//     out garish/neon on top of the darkened base
//   - raster-contrast nudged up slightly to keep roads/labels legible against
//     the now much darker background
export const OSM_STYLE_DARK = {
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
  layers: [{
    id: 'osm', type: 'raster' as const, source: 'osm',
    paint: {
      'raster-brightness-min': 0,
      'raster-brightness-max': 0.35,
      'raster-contrast': 0.15,
      'raster-saturation': -0.35,
      'raster-hue-rotate': 180,
    },
  }],
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

// Dark-theme backdrop for the comic map — same idea as OSM_STYLE_DARK, a
// "night city" paper instead of the light cream one. ComicMapLayers' own
// building/forest/water/grass/path/road colors are saturated, mid-brightness
// comic-style fills (not pale/washed), so they stay legible against a dark
// backdrop unchanged — only the background itself needs a theme-aware swap.
export const BLANK_STYLE_DARK = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#1a1a20' } }],
};
