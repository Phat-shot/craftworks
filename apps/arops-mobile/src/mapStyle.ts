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
      'raster-brightness-max': 0.4,
      // Was 0.15 — reported as too low-contrast to read comfortably (roads/
      // labels barely stood out from the darkened background). Pushed hard;
      // -brightness-max above still caps how bright the lightest pixel can
      // get, so this only spreads what's already there further apart, it
      // doesn't blow anything out.
      'raster-contrast': 0.5,
      'raster-saturation': -0.35,
      'raster-hue-rotate': 180,
    },
  }],
};

// Comic-map backdrop, theme-aware instead of a fixed color — takes the
// current theme's own background color so the map blends into the
// surrounding screen chrome instead of standing out as a hard-coded block
// (was a fixed cream `#f3e9d2` regardless of theme, then a fixed dark
// `#1a1a20`for dark themes — neither actually matched the live theme,
// which reads wrong wherever the comic map sits next to themed UI, e.g.
// GameScreen's split view). ComicMapLayers' own building/forest/water/
// grass/path/road colors are saturated, mid-brightness comic-style fills
// (not pale/washed), so they stay legible against any reasonable
// background color unchanged — only the backdrop itself needs to track
// the theme.
export function blankMapStyle(backgroundColor: string) {
  return {
    version: 8 as const,
    sources: {},
    layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': backgroundColor } }],
  };
}
