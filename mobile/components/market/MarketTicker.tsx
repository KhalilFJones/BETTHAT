import { useEffect, useRef } from 'react';
import { View, Pressable, Text, Animated, Easing } from 'react-native';
import { FONT } from '@/lib/holygrail';

// Extracted from app/(tabs)/lineup.tsx (Draft Market) so the same continuous
// price ticker can run across the whole Draft Market flow — Draft Market →
// Game Setup → Order Details — instead of only appearing on the first screen.
// Dark ticker strip per the Figma spec's own exact tones, distinct from the
// light theme.ts card it sits inside. Home and Draft Market both use this one;
// the older HG-themed components/holygrail/Ticker.tsx is no longer wired up.
const TICKER_BG = '#151517';   // Greyscale/800
const TICKER_UP = '#2FAE60';   // Alert/Success/300
const TICKER_DOWN = '#D6453C'; // oxblood family, legible on the dark strip

export interface MarketTickerEntry {
  /** Full player name — the app never surfaces ticker handles. */
  name: string;
  price: number;
  pctChange: number;
}

export function MarketTicker({ entries }: { entries: MarketTickerEntry[] }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  function startScroll() {
    if (widthRef.current <= 0) return;
    const half = widthRef.current / 2;
    if (half <= 0) return;
    const duration = (half / 32) * 1000;
    translateX.setValue(0);
    animRef.current = Animated.loop(
      Animated.timing(translateX, { toValue: -half, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    animRef.current.start();
  }
  function stopScroll() { animRef.current?.stop(); }
  useEffect(() => { startScroll(); return () => stopScroll(); }, [entries.length]);

  if (entries.length === 0) {
    return <View style={{ height: 36, backgroundColor: TICKER_BG }} />;
  }
  const doubled = [...entries, ...entries];
  return (
    <Pressable onPressIn={stopScroll} onPressOut={startScroll} style={{ height: 36, backgroundColor: TICKER_BG, overflow: 'hidden' }}>
      <Animated.View
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; startScroll(); }}
        style={{ flexDirection: 'row', alignItems: 'center', height: '100%', paddingHorizontal: 20, gap: 32, transform: [{ translateX }] }}
      >
        {doubled.map((t, i) => {
          const color = t.pctChange >= 0 ? TICKER_UP : TICKER_DOWN;
          const sign = t.pctChange >= 0 ? '+' : '';
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: '#FFFFFF' }}>{t.name}</Text>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color }}>{sign}{t.pctChange.toFixed(2)}%</Text>
            </View>
          );
        })}
      </Animated.View>
    </Pressable>
  );
}
