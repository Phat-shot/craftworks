// Central icon registry — replaces the old emoji-as-UI-icon convention with
// `@expo/vector-icons` glyphs. Swapping the whole app's icon look later means
// editing this map, not touching every screen.
import React from 'react';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

type IconSet = typeof MaterialCommunityIcons | typeof Ionicons;

const REGISTRY = {
  satellite: [MaterialCommunityIcons, 'satellite-variant'],
  radar: [MaterialCommunityIcons, 'radar'],
  target: [MaterialCommunityIcons, 'target'],
  crosshair: [MaterialCommunityIcons, 'crosshairs-gps'],
  ghost: [MaterialCommunityIcons, 'ghost'],
  flashlight: [MaterialCommunityIcons, 'flashlight'],
  magnify: [MaterialCommunityIcons, 'magnify'],
  binoculars: [MaterialCommunityIcons, 'binoculars'],
  heart: [MaterialCommunityIcons, 'heart'],
  navigation: [MaterialCommunityIcons, 'navigation'],
  closeCircle: [MaterialCommunityIcons, 'close-circle'],
  flag: [MaterialCommunityIcons, 'flag'],
  bomb: [MaterialCommunityIcons, 'bomb'],
  checkCircle: [MaterialCommunityIcons, 'check-circle'],
  checkboxBlank: [MaterialCommunityIcons, 'checkbox-blank-outline'],
  warning: [MaterialCommunityIcons, 'alert'],
  loop: [MaterialCommunityIcons, 'autorenew'],
  trash: [MaterialCommunityIcons, 'trash-can-outline'],
  undo: [MaterialCommunityIcons, 'undo'],
  people: [MaterialCommunityIcons, 'account-group'],
  rocket: [MaterialCommunityIcons, 'rocket-launch'],
  link: [MaterialCommunityIcons, 'link-variant'],
  wave: [MaterialCommunityIcons, 'hand-wave'],
  close: [MaterialCommunityIcons, 'close'],
  arrowRight: [MaterialCommunityIcons, 'arrow-right'],
  camera: [MaterialCommunityIcons, 'camera'],
  compass: [MaterialCommunityIcons, 'compass'],
  map: [MaterialCommunityIcons, 'map'],
  splitView: [MaterialCommunityIcons, 'view-split-vertical'],
  drone: [MaterialCommunityIcons, 'quadcopter'],
  mask: [MaterialCommunityIcons, 'drama-masks'],
  scare: [MaterialCommunityIcons, 'run-fast'],
  snowflake: [MaterialCommunityIcons, 'snowflake'],
  boundary: [MaterialCommunityIcons, 'sign-caution'],
  alertOctagon: [MaterialCommunityIcons, 'alert-octagon'],
  ruler: [MaterialCommunityIcons, 'ruler'],
  signalOff: [MaterialCommunityIcons, 'signal-off'],
  signal: [MaterialCommunityIcons, 'access-point'],
  windy: [MaterialCommunityIcons, 'weather-windy'],
  flagCheckered: [MaterialCommunityIcons, 'flag-checkered'],
  hourglass: [MaterialCommunityIcons, 'timer-sand'],
  circle: [MaterialCommunityIcons, 'circle'],
  handshake: [MaterialCommunityIcons, 'handshake'],
  trophy: [MaterialCommunityIcons, 'trophy'],
  skull: [MaterialCommunityIcons, 'skull'],
  shieldAccount: [MaterialCommunityIcons, 'shield-account'],
  bug: [MaterialCommunityIcons, 'bug'],
  robot: [MaterialCommunityIcons, 'robot'],
  photo: [Ionicons, 'camera'],
  play: [MaterialCommunityIcons, 'play'],
  qrcode: [MaterialCommunityIcons, 'qrcode-scan'],
  clock: [MaterialCommunityIcons, 'clock-outline'],
  palette: [MaterialCommunityIcons, 'palette'],
  settings: [MaterialCommunityIcons, 'tune-variant'],
  info: [MaterialCommunityIcons, 'information-outline'],
  watch: [MaterialCommunityIcons, 'watch-variant'],
  home: [MaterialCommunityIcons, 'home'],
  flash: [MaterialCommunityIcons, 'flash'],
  usb: [MaterialCommunityIcons, 'usb'],
  book: [MaterialCommunityIcons, 'book-open-variant'],
  chevronDown: [MaterialCommunityIcons, 'chevron-down'],
  chevronUp: [MaterialCommunityIcons, 'chevron-up'],
  trap: [MaterialCommunityIcons, 'paw'],
  teamCapture: [MaterialCommunityIcons, 'account-multiple-check'],
  pause: [MaterialCommunityIcons, 'pause-circle-outline'],
  puzzlePiece: [MaterialCommunityIcons, 'puzzle'],
  box: [MaterialCommunityIcons, 'package-variant'],
} as const satisfies Record<string, readonly [IconSet, string]>;

export type IconName = keyof typeof REGISTRY;

export default function Icon({ name, size = 16, color = '#fff', style }: {
  name: IconName; size?: number; color?: string; style?: any;
}) {
  const [Cmp, glyph] = REGISTRY[name];
  return <Cmp name={glyph as any} size={size} color={color} style={style} />;
}
