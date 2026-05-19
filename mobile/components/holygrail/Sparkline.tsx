import { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { HG } from '@/lib/holygrail';

interface Props {
  prices: number[];
  width?: number;
  height?: number;
  /** Override the auto-detected direction. Otherwise inferred from first/last price. */
  direction?: 'up' | 'down' | 'flat';
}

// Holy Grail spec: sparklines APPEAR, they don't draw in.
// Single stroke, no fill, no gridlines. Color follows price direction
// (the only place green/red are allowed in this component).
export function Sparkline({ prices, width = 56, height = 22, direction }: Props) {
  const path = useMemo(() => buildPath(prices, width, height), [prices, width, height]);
  const dir = direction ?? autoDirection(prices);
  const stroke = dir === 'up' ? HG.up : dir === 'down' ? HG.down : HG.muted;

  if (!path) {
    return <Svg width={width} height={height} />;
  }

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={path} stroke={stroke} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function buildPath(prices: number[], w: number, h: number, pad = 2): string | null {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const step = innerW / (prices.length - 1);
  return prices
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + innerH - ((p - min) / range) * innerH;
      return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
    })
    .join(' ');
}

function autoDirection(prices: number[]): 'up' | 'down' | 'flat' {
  if (!prices || prices.length < 2) return 'flat';
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (last > first * 1.005) return 'up';
  if (last < first * 0.995) return 'down';
  return 'flat';
}
