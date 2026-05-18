// BETTHAT locked pricing spec — TypeScript reference implementation.
// The authoritative implementation runs server-side in the `tick_player_prices`
// SECURITY DEFINER RPC. This module exists so we can:
//   - unit-test the math (Vitest)
//   - run client-side previews / "what-if" calculations off the same constants
//
// Formula:
//   demand_force  = min(demand_this_tick * DEMAND_COEF, COLDSTART_CAP * sqrt(active_users))
//   gravity       = (base_price - current_price) * GRAVITY_COEF
//   velocity_term = velocity * VELOCITY_COEF
//   delta         = demand_force + gravity + velocity_term + noise
//   new_price     = clamp(current_price + delta, base * FLOOR, base * CEILING)

export const DEMAND_COEF = 0.35;
export const GRAVITY_COEF = 0.008;
export const VELOCITY_COEF = 0.3;
export const COLDSTART_CAP = 8;
export const PRICE_FLOOR_MULT = 0.6;
export const PRICE_CEILING_MULT = 1.8;

export interface PriceTickInput {
  currentPrice: number;
  basePrice: number;
  velocity: number;
  demandThisTick: number;
  activeUsers: number;
  noise?: number;
}

export function applyPriceTick(input: PriceTickInput): number {
  const {
    currentPrice,
    basePrice,
    velocity,
    demandThisTick,
    activeUsers,
    noise = 0,
  } = input;

  const rawDemandForce = Math.max(0, demandThisTick) * DEMAND_COEF;
  const coldStartLimit = COLDSTART_CAP * Math.sqrt(Math.max(1, activeUsers));
  const demandForce = Math.min(rawDemandForce, coldStartLimit);

  const gravity = (basePrice - currentPrice) * GRAVITY_COEF;
  const velocityTerm = velocity * VELOCITY_COEF;

  const delta = demandForce + gravity + velocityTerm + noise;
  const next = currentPrice + delta;

  const floor = basePrice * PRICE_FLOOR_MULT;
  const ceiling = basePrice * PRICE_CEILING_MULT;
  return Math.min(ceiling, Math.max(floor, next));
}
