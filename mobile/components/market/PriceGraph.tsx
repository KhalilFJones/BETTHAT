import { useMemo } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Theme } from '@/lib/theme';

// Figma "Graph" component (Market / Game Setup Stock rows) — a dashed center
// reference line, a gradient area fill under the price path, and a solid
// stroke tracing the path. Color follows price direction using the exact
// row-level tokens from the Figma spec: gain #36A34C / danger #F05D5D
// (matches theme.gain / theme.danger exactly — NOT theme.up/theme.down,
// which are the older Holy Grail neon shades used elsewhere in the app).

interface Props {
  prices: number[];
  theme: Theme;
  width?: number;
  height?: number;
  direction?: 'up' | 'down' | 'flat';
}

let gradIdSeq = 0;

export function PriceGraph({ prices, theme, width = 80, height = 40 }: Props) {
  const gradId = useMemo(() => `priceGraphGrad${gradIdSeq++}`, []);
  const dir = useMemo(() => autoDirection(prices), [prices]);
  const color = dir === 'down' ? theme.danger : theme.gain; // flat reads as gain (matches Figma sample rows)
  const pathH = height * 0.636; // Figma: 25.44 / 40 ≈ 0.636 — path doesn't fill the full box height
  const path = useMemo(() => buildPath(prices, width, pathH), [prices, width, pathH]);
  const areaPath = useMemo(() => (path ? buildAreaPath(prices, width, pathH, height) : null), [path, prices, width, pathH, height]);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.4} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {/* Dashed center reference line */}
      <Path d={`M0,${height / 2} L${width},${height / 2}`} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
      {areaPath ? <Path d={areaPath} fill={`url(#${gradId})`} /> : null}
      {path ? <Path d={path} stroke={color} strokeWidth={1} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  );
}

function buildPath(prices: number[], w: number, h: number, pad = 1): string | null {
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

function buildAreaPath(prices: number[], w: number, pathH: number, boxH: number): string {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const step = w / (prices.length - 1);
  const points = prices.map((p, i) => {
    const x = i * step;
    const y = boxH - pathH + (pathH - ((p - min) / range) * pathH);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M${points[0]} L${points.join(' L')} L${w},${boxH} L0,${boxH} Z`;
}

function autoDirection(prices: number[]): 'up' | 'down' | 'flat' {
  if (!prices || prices.length < 2) return 'flat';
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (last > first * 1.001) return 'up';
  if (last < first * 0.999) return 'down';
  return 'flat';
}
