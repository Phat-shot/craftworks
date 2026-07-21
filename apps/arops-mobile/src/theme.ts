import React, { createContext, useContext } from 'react';

// UI-CHROME tokens only — screen backgrounds, panels, borders, standard
// text, primary/secondary accent (buttons, active states, headers). Deliberately
// NOT a place for gameplay-semantic colors (team A/B, class accents, hit/
// freeze feedback, ShotOverlay fill) — those carry in-game meaning
// independent of the visual theme and stay literal at their call sites, see
// GameScreen.tsx's CLASS_COLOR etc. Re-theming them would make an
// established color code (e.g. "red = danger") inconsistent across a
// day/night switch, or wash out against a light background.
export interface ThemeTokens {
  bg: string; bg2: string; bg3: string;
  border: string; borderStrong: string;
  text: string; text2: string; text3: string;
  accent: string; accent2: string; onAccent: string;
  danger: string; success: string;
}

export type ThemeName = 'color' | 'night' | 'day';

export const THEMES: Record<ThemeName, ThemeTokens> = {
  // The app's original (and still default) look — values unchanged from
  // what every screen already hardcoded, just centralized here so it's one
  // of three selectable themes instead of the only option.
  color: {
    bg: '#0a0810', bg2: '#141020', bg3: 'rgba(40,32,64,.6)',
    border: '#2a2040', borderStrong: '#f0c840',
    text: '#e0c080', text2: '#c0a0f0', text3: '#807050',
    accent: '#f0c840', accent2: '#c0a0f0', onAccent: '#1a1000',
    danger: '#ff6040', success: '#80ff40',
  },
  night: {
    bg: '#000000', bg2: '#0d0d0d', bg3: 'rgba(255,255,255,.06)',
    border: '#2a2a2a', borderStrong: '#e8ff2a',
    text: '#d8d8d8', text2: '#a8a8a8', text3: '#707070',
    accent: '#e8ff2a', accent2: '#39ff88', onAccent: '#101000',
    danger: '#ff6040', success: '#39ff88',
  },
  day: {
    bg: '#ffffff', bg2: '#f2f4f8', bg3: '#eef1f6',
    border: '#d8dce4', borderStrong: '#1a73e8',
    text: '#1a1d29', text2: '#4a5568', text3: '#7a8494',
    accent: '#1a73e8', accent2: '#5a8fd8', onAccent: '#ffffff',
    danger: '#d32f2f', success: '#2e7d32',
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  color: 'Color', night: 'Nacht', day: 'Tag',
};

const ThemeContext = createContext<ThemeTokens>(THEMES.color);

export function ThemeProvider({ name, children }: { name: ThemeName; children: React.ReactNode }) {
  return React.createElement(ThemeContext.Provider, { value: THEMES[name] }, children);
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
