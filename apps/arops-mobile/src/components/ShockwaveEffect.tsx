// Screen-space "shot fired" feedback — an expanding, fading ring anchored at
// a fixed pixel point (default: screen center, matching GameScreen's
// ShotOverlay/own-marker convention for controlled-camera views). Pure
// Animated.View, no react-native-svg — same deliberate choice as GlowBorder
// in GameScreen.tsx. Purely visual, no gameplay meaning (the actual
// hit/miss decision and its own toast are unrelated, server-driven).
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

const SIZE_PX = 140;
const DURATION_MS = 420;

/**
 * Re-triggers the ring animation every time `triggerKey` changes (e.g. an
 * incrementing counter bumped once per shot) — mount once per screen,
 * changing `triggerKey` replays the effect instead of remounting the
 * component.
 */
export default function ShockwaveEffect({
  triggerKey, anchorPx, color = '#fff',
}: {
  triggerKey: number;
  anchorPx?: [number, number] | null;
  color?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (triggerKey === 0) return; // 0 = "never fired yet", skip the initial mount
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: DURATION_MS, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          borderColor: color,
          top: anchorPx ? anchorPx[1] - SIZE_PX / 2 : ('50%' as any),
          left: anchorPx ? anchorPx[0] - SIZE_PX / 2 : ('50%' as any),
          marginTop: anchorPx ? 0 : -SIZE_PX / 2,
          marginLeft: anchorPx ? 0 : -SIZE_PX / 2,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute', width: SIZE_PX, height: SIZE_PX, borderRadius: SIZE_PX / 2,
    borderWidth: 3,
  },
});
