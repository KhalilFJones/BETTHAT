// =============================================================================
// SwipeToConfirm — Holy Grail V2 swipe-to-place gesture, reusable.
// Used by Place Order (Screen 06) and Sidebet Accept (Screen 09).
//
// CRITICAL: trackWidth must be a useSharedValue, not a useRef. Worklet
// callbacks (Gesture.Pan().onUpdate / .onEnd) run on the UI thread and cannot
// read `.current` from a JS-thread ref. Using a ref here is what kept the
// gesture from firing in the original Place Order cut.
// =============================================================================

import { useRef } from 'react';
import { View, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { HG, FONT } from '@/lib/holygrail';

const TRACK_HEIGHT = 56;
const THUMB_SIZE = 48;

interface Props {
  label: string;
  enabled: boolean;
  onConfirm: () => void;
}

export function SwipeToConfirm({ label, enabled, onConfirm }: Props) {
  const translateX = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const triggered = useRef(false);

  function fire() {
    if (triggered.current) return;
    triggered.current = true;
    onConfirm();
  }

  const pan = Gesture.Pan()
    .activeOffsetX(8)
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      'worklet';
      const max = trackWidth.value - THUMB_SIZE - 8;
      if (max <= 0) return;
      translateX.value = Math.min(Math.max(0, e.translationX), max);
    })
    .onEnd(() => {
      'worklet';
      const max = trackWidth.value - THUMB_SIZE - 8;
      if (max > 0 && translateX.value >= max * 0.88) {
        translateX.value = withTiming(max, { duration: 120 });
        runOnJS(fire)();
      } else {
        translateX.value = withTiming(0, { duration: 220 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => {
    const tw = trackWidth.value || 1;
    return {
      width: translateX.value + THUMB_SIZE,
      opacity: 0.22 + Math.min(0.55, translateX.value / tw),
    };
  });

  return (
    <View
      onLayout={(e) => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
      style={{
        height: TRACK_HEIGHT,
        borderRadius: 999,
        backgroundColor: HG.surface,
        borderWidth: 1,
        borderColor: enabled ? HG.skyEdge : HG.hairline,
        overflow: 'hidden',
        justifyContent: 'center',
        position: 'relative',
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: HG.sky },
          fillStyle,
        ]}
      />
      <Text
        pointerEvents="none"
        style={{
          fontFamily: FONT.monoBold,
          fontSize: 12,
          color: HG.ink,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
      <GestureDetector gesture={pan}>
        <Animated.View
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            {
              position: 'absolute',
              left: 4,
              top: 4,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: 999,
              backgroundColor: HG.sky,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: HG.sky,
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 0 },
            },
            thumbStyle,
          ]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={HG.jet} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12h14M13 6l6 6-6 6" />
          </Svg>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
