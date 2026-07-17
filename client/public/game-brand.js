// game-brand.js — apply brand/workshop customizations to game renderer
'use strict';

// Global brand config applied once after game starts
window.BRAND = {
  towerSkins: {},   // {towerId: {name, description, icon, color, icon_url}}
  unitSkins:  {},   // {unitType: {name, icon, color}}
  labels: {},       // {gold:'Coins', score:'Sterne', lives:'Energie'}
  icons:  {},       // {gold:'💰', score:'🏆', lives:'❤️'}
  bgTextureUrl: null,
  pathTextureUrl: null,
  logoOverlayUrl: null,
  primaryColor: null,
};

function applyBrandConfig(wc) {
  if (!wc) return;
  
  // Tower skins (override TDB-like display data)
  if (wc.building_skins && typeof wc.building_skins === 'object') {
    Object.assign(window.BRAND.towerSkins, wc.building_skins);
  }
  if (wc.unit_skins && typeof wc.unit_skins === 'object') {
    Object.assign(window.BRAND.unitSkins, wc.unit_skins);
  }
  
  // Labels
  if (wc.label_gold)  window.BRAND.labels.gold  = wc.label_gold;
  if (wc.label_score) window.BRAND.labels.score  = wc.label_score;
  if (wc.label_lives) window.BRAND.labels.lives  = wc.label_lives;
  if (wc.icon_gold)   window.BRAND.icons.gold    = wc.icon_gold;
  if (wc.icon_score)  window.BRAND.icons.score   = wc.icon_score;
  if (wc.icon_lives)  window.BRAND.icons.lives   = wc.icon_lives;
  
  // Visual assets
  if (wc.bg_texture_url)   window.BRAND.bgTextureUrl   = wc.bg_texture_url;
  if (wc.path_texture_url) window.BRAND.pathTextureUrl = wc.path_texture_url;
  if (wc.logo_overlay_url) window.BRAND.logoOverlayUrl = wc.logo_overlay_url;
  if (wc.primary_color)    window.BRAND.primaryColor   = wc.primary_color;
  if (wc.start_icon)       window.BRAND.startIcon      = wc.start_icon;
  if (wc.goal_icon)        window.BRAND.goalIcon       = wc.goal_icon;
  
  // Apply labels to DOM
  applyBrandLabelsToDOM();
}

function applyBrandLabelsToDOM() {
  // Update any HUD label elements
  const labelMap = {
    'lbl-gold':  window.BRAND.labels.gold  || null,
    'lbl-score': window.BRAND.labels.score || null,
    'lbl-lives': window.BRAND.labels.lives || null,
  };
  Object.entries(labelMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.textContent = val;
  });
  const iconMap = {
    'ico-gold':  window.BRAND.icons.gold  || null,
    'ico-score': window.BRAND.icons.score || null,
    'ico-lives': window.BRAND.icons.lives || null,
  };
  Object.entries(iconMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.textContent = val;
  });
}

// Get display name for a tower (with brand override)
function getBrandTowerName(towerType, fallback) {
  return window.BRAND.towerSkins[towerType]?.name || fallback;
}
function getBrandTowerIcon(towerType, fallback) {
  return window.BRAND.towerSkins[towerType]?.icon || fallback;
}
function getBrandUnitName(unitType, fallback) {
  return window.BRAND.unitSkins[unitType]?.name || fallback;
}

// Load brand config from sessionStorage on page load
(function initBrand() {
  try {
    const sess = JSON.parse(sessionStorage.getItem('mp_session') || 'null');
    if (sess?.workshopConfig) {
      applyBrandConfig(sess.workshopConfig);
    }
  } catch(e) {}
})();
