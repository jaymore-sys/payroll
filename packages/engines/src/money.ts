import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value;
export const D = (v: Num) => new Decimal(v);
/** Round to the nearest rupee. */
export const rupee = (v: Num) => D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
/** Round up to the next rupee (ESI). */
export const rupeeUp = (v: Num) => D(v).toDecimalPlaces(0, Decimal.ROUND_CEIL);
export const min = (...v: Num[]) => Decimal.min(...v);
export const max = (...v: Num[]) => Decimal.max(...v);
/** Plain number for JSON output — only call at the boundary. */
export const n = (v: Num) => D(v).toNumber();
