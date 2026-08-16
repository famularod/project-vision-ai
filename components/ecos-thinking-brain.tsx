import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

type ECOSThinkingBrainMode = 'idle' | 'thinking';

const NEURON_NODES = Object.freeze([
  { left: 39, top: 69, size: 6, phase: 0 },
  { left: 63, top: 38, size: 5, phase: 1 },
  { left: 82, top: 89, size: 7, phase: 2 },
  { left: 107, top: 54, size: 5, phase: 0 },
  { left: 132, top: 30, size: 7, phase: 2 },
  { left: 151, top: 78, size: 5, phase: 1 },
  { left: 176, top: 47, size: 6, phase: 0 },
  { left: 197, top: 87, size: 7, phase: 2 },
  { left: 224, top: 38, size: 5, phase: 1 },
  { left: 246, top: 70, size: 6, phase: 0 },
  { left: 116, top: 111, size: 5, phase: 1 },
  { left: 169, top: 116, size: 5, phase: 2 },
]);

const NEURON_PATHS = Object.freeze([
  { left: 44, top: 67, width: 38, rotation: '-49deg', phase: 0 },
  { left: 67, top: 64, width: 47, rotation: '52deg', phase: 1 },
  { left: 86, top: 80, width: 48, rotation: '-39deg', phase: 2 },
  { left: 110, top: 49, width: 32, rotation: '-43deg', phase: 0 },
  { left: 134, top: 49, width: 35, rotation: '70deg', phase: 2 },
  { left: 151, top: 66, width: 35, rotation: '-43deg', phase: 1 },
  { left: 178, top: 65, width: 40, rotation: '53deg', phase: 0 },
  { left: 201, top: 65, width: 42, rotation: '-51deg', phase: 2 },
  { left: 225, top: 53, width: 35, rotation: '52deg', phase: 1 },
  { left: 113, top: 95, width: 48, rotation: '-26deg', phase: 0 },
  { left: 158, top: 96, width: 45, rotation: '28deg', phase: 2 },
]);

export function ECOSThinkingBrain({
  mode = 'idle',
  compact = false,
}: {
  mode?: ECOSThinkingBrainMode;
  compact?: boolean;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const breathe = useRef(new Animated.Value(0.35)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const firing = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      breathe.setValue(0.58);
      drift.setValue(0.46);
      firing.setValue(0.68);
      orbit.setValue(0.2);
      return undefined;
    }

    const energy = mode === 'thinking' ? 0.68 : 1;
    const animation = Animated.loop(Animated.parallel([
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1800 * energy,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1800 * energy,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 3800 * energy,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 3800 * energy,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
      Animated.sequence([
        Animated.delay(220 * energy),
        Animated.timing(firing, {
          toValue: 1,
          duration: 720 * energy,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(firing, {
          toValue: 0,
          duration: 980 * energy,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(640 * energy),
      ]),
      Animated.timing(orbit, {
        toValue: 1,
        duration: 9000 * energy,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [breathe, drift, firing, mode, orbit, reduceMotion]);

  const coreScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, mode === 'thinking' ? 1.16 : 1.08] });
  const hazeScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.18] });
  const hazeOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.2, mode === 'thinking' ? 0.58 : 0.4] });
  const driftX = drift.interpolate({ inputRange: [0, 1], outputRange: [-13, 15] });
  const driftY = drift.interpolate({ inputRange: [0, 1], outputRange: [8, -9] });
  const bright = firing.interpolate({ inputRange: [0, 1], outputRange: [0.24, 1] });
  const dim = firing.interpolate({ inputRange: [0, 1], outputRange: [0.88, 0.3] });
  const rotation = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <LinearGradient
      colors={['#031537', '#073F87', '#071B52']}
      start={{ x: 0.08, y: 0.08 }}
      end={{ x: 0.92, y: 0.95 }}
      testID="ecos-thinking-brain"
      accessible
      accessibilityRole="image"
      accessibilityLabel={mode === 'thinking' ? 'ECOS Brain actively researching' : 'ECOS Brain ready'}
      style={[styles.frame, compact && styles.frameCompact]}
    >
      <Animated.View style={[styles.atmosphere, styles.atmosphereLeft, {
        opacity: hazeOpacity,
        transform: [{ translateX: driftX }, { translateY: driftY }, { scale: hazeScale }],
      }]} />
      <Animated.View style={[styles.atmosphere, styles.atmosphereRight, {
        opacity: hazeOpacity,
        transform: [{ translateX: Animated.multiply(driftX, -1) }, { translateY: Animated.multiply(driftY, -1) }, { scale: coreScale }],
      }]} />
      <Animated.View style={[styles.atmosphere, styles.atmosphereLower, {
        opacity: hazeOpacity,
        transform: [{ translateX: Animated.multiply(driftX, 0.55) }, { scale: hazeScale }],
      }]} />

      <View style={[styles.canvas, compact && styles.canvasCompact]}>
        <Animated.View style={[styles.brainLobe, styles.brainLobeLeft, { opacity: hazeOpacity, transform: [{ scale: hazeScale }] }]} />
        <Animated.View style={[styles.brainLobe, styles.brainLobeRight, { opacity: hazeOpacity, transform: [{ scale: coreScale }] }]} />
        <Animated.View style={[styles.orbit, { transform: [{ rotate: rotation }, { scale: hazeScale }] }]}>
          <View style={styles.orbitSpark} />
        </Animated.View>

        {NEURON_PATHS.map(path => (
          <Animated.View
            key={`path-${path.left}-${path.top}`}
            style={[
              styles.path,
              {
                left: path.left,
                top: path.top,
                width: path.width,
                opacity: path.phase === 0 ? bright : path.phase === 1 ? dim : hazeOpacity,
                transform: [{ rotate: path.rotation }],
              },
            ]}
          />
        ))}

        {NEURON_NODES.map(node => (
          <Animated.View
            key={`node-${node.left}-${node.top}`}
            style={[
              styles.nodeGlow,
              {
                left: node.left - 4,
                top: node.top - 4,
                opacity: node.phase === 0 ? bright : node.phase === 1 ? dim : hazeOpacity,
                transform: [{ scale: node.phase === 2 ? hazeScale : coreScale }],
              },
            ]}
          >
            <View style={[styles.node, { width: node.size, height: node.size, borderRadius: node.size / 2 }]} />
          </Animated.View>
        ))}

        <Animated.View style={[styles.coreGlowOuter, { opacity: hazeOpacity, transform: [{ scale: hazeScale }] }]} />
        <Animated.View style={[styles.coreGlow, { opacity: bright, transform: [{ scale: coreScale }] }]} />
        <Animated.View style={[styles.core, { transform: [{ rotate: '45deg' }, { scale: coreScale }] }]}>
          <View style={styles.coreInner} />
        </Animated.View>
      </View>

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(25,196,255,0)', 'rgba(25,196,255,0.24)', 'rgba(25,196,255,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.horizon}
      />
      <View style={styles.vignette} pointerEvents="none" />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    maxWidth: 560,
    height: 174,
    alignSelf: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(89, 201, 255, 0.36)',
    position: 'relative',
    shadowColor: '#047BFF',
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 9 },
    elevation: 9,
  },
  frameCompact: { height: 142, borderRadius: 20 },
  canvas: { width: 292, height: 146, alignSelf: 'center', marginTop: 10, position: 'relative' },
  canvasCompact: { transform: [{ scale: 0.84 }], marginTop: -1 },
  atmosphere: { position: 'absolute', backgroundColor: '#12A9FF' },
  atmosphereLeft: { width: 210, height: 112, left: -18, top: 24, borderRadius: 70 },
  atmosphereRight: { width: 210, height: 124, right: -34, top: 4, borderRadius: 76, backgroundColor: '#3F4DFF' },
  atmosphereLower: { width: 270, height: 86, left: 80, bottom: -35, borderRadius: 90, backgroundColor: '#00D5FF' },
  brainLobe: { position: 'absolute', width: 116, height: 91, top: 31, borderRadius: 56, backgroundColor: '#18A8FF', borderWidth: 1, borderColor: 'rgba(159,236,255,0.34)' },
  brainLobeLeft: { left: 36 },
  brainLobeRight: { right: 36, backgroundColor: '#226DFF' },
  orbit: { position: 'absolute', width: 124, height: 124, left: 84, top: 13, borderRadius: 62, borderWidth: 1, borderColor: 'rgba(103,220,255,0.38)' },
  orbitSpark: { position: 'absolute', width: 7, height: 7, borderRadius: 4, top: -4, left: 58, backgroundColor: '#D8FBFF', shadowColor: '#55E7FF', shadowOpacity: 1, shadowRadius: 8 },
  path: { position: 'absolute', height: 1.5, borderRadius: 2, backgroundColor: '#73E5FF', shadowColor: '#16CEFF', shadowOpacity: 0.9, shadowRadius: 4 },
  nodeGlow: { position: 'absolute', width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(35,202,255,0.22)', shadowColor: '#55E7FF', shadowOpacity: 1, shadowRadius: 7 },
  node: { backgroundColor: '#E8FDFF', borderWidth: 1, borderColor: '#7DEBFF' },
  coreGlowOuter: { position: 'absolute', width: 76, height: 76, left: 108, top: 37, borderRadius: 38, backgroundColor: 'rgba(22,194,255,0.22)' },
  coreGlow: { position: 'absolute', width: 48, height: 48, left: 122, top: 51, borderRadius: 24, backgroundColor: 'rgba(38,211,255,0.34)', shadowColor: '#37DFFF', shadowOpacity: 1, shadowRadius: 20 },
  core: { position: 'absolute', width: 28, height: 28, left: 132, top: 61, borderRadius: 8, backgroundColor: '#087BFF', borderWidth: 2, borderColor: '#B8F7FF', alignItems: 'center', justifyContent: 'center', shadowColor: '#27CEFF', shadowOpacity: 1, shadowRadius: 12 },
  coreInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F1FEFF' },
  horizon: { position: 'absolute', height: 2, left: 20, right: 20, top: '53%' },
  vignette: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 24, borderWidth: 13, borderColor: 'rgba(1,12,38,0.14)' },
});
