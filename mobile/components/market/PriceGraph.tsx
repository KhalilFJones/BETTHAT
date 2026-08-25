import { useMemo } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Theme } from '@/lib/theme';

// Figma "Graph" component (Market / Game Setup Stock rows) — a dashed center
// reference line, a gradient area fill under the price path, and a solid
// stroke tracing the path. Color follows price direction using the exact
// row-level tokens from the Figma spec: gain #36A34C / danger #F05D5D
// (matches theme.gain / theme.danger exactly — NOT theme.up/theme.down,
// which are the older Holy Grail neon shades used elsewhere in the app).
//
// AMPLITUDE IS REAL. A sparkline has no axis, so stretching every series to
// its own min/max — the obvious implementation — makes a player who moved two
// cents look exactly as violent as one who moved eight dollars. Instead the
// path occupies a fraction of the box proportional to the series' actual swing
// as a share of its own price, measured against FULL_SCALE_SWING. Two rows
// sitting next to each other are therefore directly comparable, which is the
// only reason to show a sparkline at all.
//
// The big labelled chart on the player detail screen deliberately does NOT do
// this: it has axis labels, so fitting the data to the box is correct there.

/** Relative swing that fills the box top to bottom. Today's 6h window runs a
 *  median of 0.76% and a 95th percentile of 1.53%, so 2% keeps the busiest
 *  players just short of clipping while leaving quiet ones visibly flat. */
const FULL_SCALE_SWING = 0.02;

/** Floor so a nearly flat series still reads as a line, not a bare edge. */
const MIN_FILL = 0.14;

function fillFactor(prices: number[]): number {
  if (!prices || prices.length < 2) return MIN_FILL;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (mean <= 0) return MIN_FILL;
  const rel = (max - min) / mean;
  return Math.max(MIN_FILL, Math.min(1, rel / FULL_SCALE_SWING));
}

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
  const fill = useMemo(() => fillFactor(prices), [prices]);
  const path = useMemo(() => buildPath(prices, width, pathH, fill), [prices, width, pathH, fill]);
  const areaPath = useMemo(
    () => (path ? buildAreaPath(prices, width, pathH, height, fill) : null),
    [path, prices, width, pathH, height, fill],
  );

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

function buildPath(prices: number[], w: number, h: number, fill: number, pad = 1): string | null {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  // Occupy only `fill` of the height, centred, so amplitude stays comparable
  // between rows instead of every series being stretched to the full box.
  const band = innerH * fill;
  const top = pad + (innerH - band) / 2;
  const step = innerW / (prices.length - 1);
  return prices
    .map((p, i) => {
      const x = pad + i * step;
      const y = top + band - ((p - min) / range) * band;
      return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
    })
    .join(' ');
}

function buildAreaPath(prices: number[], w: number, pathH: number, boxH: number, fill: number): string {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const step = w / (prices.length - 1);
  const band = pathH * fill;
  const top = boxH - pathH + (pathH - band) / 2;
  const points = prices.map((p, i) => {
    const x = i * step;
    const y = top + band - ((p - min) / range) * band;
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
