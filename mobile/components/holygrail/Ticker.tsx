import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, Pressable } from 'react-native';
import { HG, FONT, fmtPrice } from '@/lib/holygrail';

export interface TickerEntry {
  ticker: string;
  price: number;
  pctChange: number;
}

interface Props {
  entries: TickerEntry[];
  /** Pixels per second. Holy Grail spec: 30–40px/sec, constant velocity. */
  speed?: number;
  /** Total content width (computed via onLayout in real use; explicit for headless test). */
  forceWidth?: number;
}

// Holy Grail Live Ticker: continuous left-to-right scroll, no easing,
// pauses on press-and-hold. Content is duplicated and shifted by half the
// total width to create a seamless loop.
export function Ticker({ entries, speed = 32 }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  function startScroll() {
    if (widthRef.current <= 0) return;
    const half = widthRef.current / 2;
    if (half <= 0) return;
    const duration = (half / speed) * 1000;
    translateX.setValue(0);
    animRef.current = Animated.loop(
      Animated.timing(translateX, {
        toValue: -half,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animRef.current.start();
  }

  function stopScroll() {
    animRef.current?.stop();
  }

  useEffect(() => {
    startScroll();
    return () => stopScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, speed]);

  if (entries.length === 0) {
    return (
      <View
        style={{
          height: 36,
          backgroundColor: HG.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: HG.hairline,
        }}
      />
    );
  }

  // Doubled list for seamless loop
  const doubled = [...entries, ...entries];

  return (
    <Pressable
      onPressIn={stopScroll}
      onPressOut={startScroll}
      style={{
        height: 36,
        backgroundColor: HG.surface,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: HG.hairline,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          startScroll();
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: '100%',
          paddingHorizontal: 24,
          gap: 36,
          transform: [{ translateX }],
        }}
      >
        {doubled.map((t, i) => {
          const dir = t.pctChange >= 0 ? 'up' : 'down';
          const arrow = dir === 'up' ? '↑' : '↓';
          const color = dir === 'up' ? HG.up : HG.down;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.sky, letterSpacing: 0.4 }}>
                {t.ticker}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color: HG.ink }}>
                {fmtPrice(t.price)}
              </Text>
              <Text style={{ fontFamily: FONT.monoMedium, fontSize: 12, color }}>
                {arrow}
                {Math.abs(t.pctChange).toFixed(1)}%
              </Text>
            </View>
          );
        })}
      </Animated.View>
    </Pressable>
  );
}
