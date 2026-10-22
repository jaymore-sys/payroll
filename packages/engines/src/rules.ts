/**
 * Seed rules (spec §6, §7.1). Rows are dated config: a law change is a new row, never a code change.
 * Verify every value against the latest notification before go-live.
 */
export type Slab = { upTo: number | null; rate: number };
export type AgeBand = 'below60' | '60to79' | '80plus';
export type Regime = 'new' | 'old';

export interface TaxRule {
  taxYear: string;
  regime: Regime;
  ageBand: AgeBand;
  slabs: Slab[];
  stdDeduction: number;
  rebateLimit: number; // taxable income at/below which 87A applies
  rebateMax: number;
  rebateMarginalRelief: boolean;
  surcharge: { above: number; rate: number }[];
  cessRate: number;
  limits: {
    c80: number; d80Self: number; d80Parents: number; d80ParentsSenior: number;
    ccd1b: number; homeLoan: number; pt: number; employerNpsPct: number;
  };
}

const NEW_SLABS: Slab[] = [
  { upTo: 400000, rate: 0 }, { upTo: 800000, rate: 0.05 }, { upTo: 1200000, rate: 0.1 },
  { upTo: 1600000, rate: 0.15 }, { upTo: 2000000, rate: 0.2 }, { upTo: 2400000, rate: 0.25 },
  { upTo: null, rate: 0.3 },
];
const oldSlabs = (exempt: number): Slab[] => {
  const s: Slab[] = [{ upTo: exempt, rate: 0 }];
  if (exempt < 500000) s.push({ upTo: 500000, rate: 0.05 });
  s.push({ upTo: 1000000, rate: 0.2 }, { upTo: null, rate: 0.3 });
  return s;
};
const SURCHARGE_OLD = [{ above: 5000000, rate: 0.1 }, { above: 10000000, rate: 0.15 }, { above: 20000000, rate: 0.25 }, { above: 50000000, rate: 0.37 }];
const SURCHARGE_NEW = SURCHARGE_OLD.slice(0, 3);
const LIMITS_OLD = { c80: 150000, d80Self: 25000, d80Parents: 25000, d80ParentsSenior: 50000, ccd1b: 50000, homeLoan: 200000, pt: 2500, employerNpsPct: 0.1 };
const LIMITS_NEW = { ...LIMITS_OLD, c80: 0, d80Self: 0, d80Parents: 0, d80ParentsSenior: 0, ccd1b: 0, homeLoan: 0, pt: 0, employerNpsPct: 0.14 };

const newRule = (ageBand: AgeBand): TaxRule => ({
  taxYear: '2026-27', regime: 'new', ageBand, slabs: NEW_SLABS, stdDeduction: 75000,
  rebateLimit: 1200000, rebateMax: 60000, rebateMarginalRelief: true,
  surcharge: SURCHARGE_NEW, cessRate: 0.04, limits: LIMITS_NEW,
});
const oldRule = (ageBand: AgeBand, exempt: number): TaxRule => ({
  taxYear: '2026-27', regime: 'old', ageBand, slabs: oldSlabs(exempt), stdDeduction: 50000,
  rebateLimit: 500000, rebateMax: 12500, rebateMarginalRelief: false,
  surcharge: SURCHARGE_OLD, cessRate: 0.04, limits: LIMITS_OLD,
});

export const TAX_RULES: TaxRule[] = [
  newRule('below60'), newRule('60to79'), newRule('80plus'),
  oldRule('below60', 250000), oldRule('60to79', 300000), oldRule('80plus', 500000),
];

export const findTaxRule = (rules: TaxRule[], taxYear: string, regime: Regime, ageBand: AgeBand) => {
  const r = rules.find((x) => x.taxYear === taxYear && x.regime === regime && x.ageBand === ageBand);
  if (!r) throw new Error(`No tax rule for ${taxYear}/${regime}/${ageBand}`);
  return r;
};

/* ---------- Statutory ---------- */
export interface PfParams { empRate: number; erRate: number; epsRate: number; ceiling: number; epsMax: number; edliRate: number; adminRate: number; adminMin: number; epsAgeLimit: number }
export interface EsiParams { grossLimit: number; pwdGrossLimit: number; empRate: number; erRate: number; empExemptDailyWage: number }
export interface PtSlab { gender: 'M' | 'F' | 'any'; from: number; to: number | null; amount: number; febAmount?: number }
export interface PtParams { slabs: PtSlab[] }
export interface LwfParams { employee: number; employer: number; months: number[]; wageThreshold?: number }
export interface GratuityParams { minYears: number; fixedTermMinYears: number; taxExemptLimit: number; provisionRate: number }
export interface BonusParams { wageLimit: number; calcCeiling: number; minRate: number; maxRate: number }

export interface StatutoryRule<P = unknown> {
  id: string; ruleType: 'pf' | 'esi' | 'pt' | 'lwf' | 'gratuity' | 'bonus'; state: string | null;
  effectiveFrom: string; effectiveTo: string | null; params: P; sourceNote: string;
}

export const STATUTORY_RULES: StatutoryRule[] = [
  { id: 'pf-2014-09', ruleType: 'pf', state: null, effectiveFrom: '2014-09-01', effectiveTo: null, sourceNote: 'EPF Scheme 1952; ceiling ₹15,000',
    params: { empRate: 0.12, erRate: 0.12, epsRate: 0.0833, ceiling: 15000, epsMax: 1250, edliRate: 0.005, adminRate: 0.005, adminMin: 500, epsAgeLimit: 58 } satisfies PfParams },
  { id: 'esi-2019-07', ruleType: 'esi', state: null, effectiveFrom: '2019-07-01', effectiveTo: null, sourceNote: 'ESI rates 0.75% / 3.25%, ceiling ₹21,000',
    params: { grossLimit: 21000, pwdGrossLimit: 25000, empRate: 0.0075, erRate: 0.0325, empExemptDailyWage: 176 } satisfies EsiParams },
  { id: 'pt-mh-2023', ruleType: 'pt', state: 'MH', effectiveFrom: '2023-04-01', effectiveTo: null, sourceNote: 'Maharashtra PT; ₹300 in February',
    params: { slabs: [
      { gender: 'M', from: 0, to: 7500, amount: 0 },
      { gender: 'M', from: 7500.01, to: 10000, amount: 175 },
      { gender: 'M', from: 10000.01, to: null, amount: 200, febAmount: 300 },
      { gender: 'F', from: 0, to: 25000, amount: 0 },
      { gender: 'F', from: 25000.01, to: null, amount: 200, febAmount: 300 },
    ] } satisfies PtParams },
  { id: 'pt-ka-2023', ruleType: 'pt', state: 'KA', effectiveFrom: '2023-04-01', effectiveTo: null, sourceNote: 'Karnataka PT (verify)',
    params: { slabs: [{ gender: 'any', from: 0, to: 24999, amount: 0 }, { gender: 'any', from: 25000, to: null, amount: 200, febAmount: 300 }] } satisfies PtParams },
  { id: 'lwf-mh-2024', ruleType: 'lwf', state: 'MH', effectiveFrom: '2024-01-01', effectiveTo: null, sourceNote: 'Maharashtra LWF June & December (verify)',
    params: { employee: 25, employer: 75, months: [6, 12] } satisfies LwfParams },
  { id: 'gratuity-2025-11', ruleType: 'gratuity', state: null, effectiveFrom: '2025-11-21', effectiveTo: null, sourceNote: 'Code on Social Security 2020',
    params: { minYears: 5, fixedTermMinYears: 1, taxExemptLimit: 2000000, provisionRate: 0.0481 } satisfies GratuityParams },
  { id: 'bonus-2025-11', ruleType: 'bonus', state: null, effectiveFrom: '2025-11-21', effectiveTo: null, sourceNote: 'Code on Wages 2019',
    params: { wageLimit: 21000, calcCeiling: 7000, minRate: 0.0833, maxRate: 0.2 } satisfies BonusParams },
];

/** Pick the row whose dates cover `asOf` (YYYY-MM-DD). State-specific rows win; states with no row return undefined. */
export function ruleAsOf<P>(rules: StatutoryRule[], type: StatutoryRule['ruleType'], asOf: string, state: string | null = null) {
  return rules.find((r) => r.ruleType === type && r.state === state && r.effectiveFrom <= asOf && (!r.effectiveTo || r.effectiveTo >= asOf)) as StatutoryRule<P> | undefined;
}
