import { D, Decimal, max, n, rupee } from './money';
import { STATUTORY_RULES, TAX_RULES, type StatutoryRule, type TaxRule } from './rules';
import { computeStatutory } from './statutory';
import { compareRegimes } from './tax';

export type CalcType = 'pct_gross' | 'pct_of' | 'fixed' | 'balance';
export interface ComponentDef {
  code: string; name: string; calc: CalcType; value?: number; base?: string;
  /** HRA uses a different % for non-metro. */
  valueNonMetro?: number;
  isWage: boolean; taxable: 'full' | 'partial' | 'none';
}

/**
 * Salary structure as % of monthly gross (Valencia Nutrition payslips): Basic 50%, HRA 25%, LTA 10%, Special 15%.
 * PF is on everything except HRA (capped at the PF ceiling), matching how those payslips deduct PF.
 */
export const DEFAULT_TEMPLATE: ComponentDef[] = [
  { code: 'BASIC', name: 'Basic', calc: 'pct_gross', value: 0.5, isWage: true, taxable: 'full' },
  { code: 'HRA', name: 'House Rent Allowance', calc: 'pct_gross', value: 0.25, isWage: false, taxable: 'partial' },
  { code: 'LTA', name: 'Leave & Travel Allowance', calc: 'pct_gross', value: 0.1, isWage: true, taxable: 'full' },
  { code: 'SPECIAL', name: 'Special Allowance', calc: 'balance', isWage: true, taxable: 'full' },
];

export interface CtcInput {
  annualCtc: number;
  /** Give the monthly gross instead of CTC: the structure is split from it directly. */
  monthlyGross?: number;
  /**
   * false (default, RazorpayX style): CTC = gross × 12 + variable; employer PF/ESI/gratuity are shown as employer cost on top.
   * true: CTC includes employer costs, so the gross is solved from it (spec §5).
   */
  employerCostInCtc?: boolean;
  pfOptOut?: boolean;
  internationalWorker?: boolean;
  esiExempt?: boolean;
  annualVariable?: number;
  metro: boolean;
  pfCapMode: 'capped' | 'actual';
  state: string;
  gender?: 'M' | 'F';
  age?: number;
  doj?: string;
  asOf?: string; // YYYY-MM
  labourCodeMode?: boolean;
  template?: ComponentDef[];
  taxYear?: string;
}

function build(gross: Decimal, i: CtcInput, tpl: ComponentDef[], rules: StatutoryRule[]) {
  const amt: Record<string, Decimal> = {};
  for (const c of tpl.filter((c) => c.calc !== 'balance')) {
    const v = i.metro || c.valueNonMetro === undefined ? c.value ?? 0 : c.valueNonMetro;
    if (c.calc === 'pct_gross') amt[c.code] = rupee(gross.times(v));
    else if (c.calc === 'fixed') amt[c.code] = D(v);
    else {
      if (!(c.base! in amt)) throw new Error(`Component ${c.code} depends on ${c.base}, which must come first`);
      amt[c.code] = rupee(amt[c.base!].times(v));
    }
  }
  const used = Object.values(amt).reduce((a, b) => a.plus(b), D(0));
  const bal = tpl.find((c) => c.calc === 'balance');
  if (bal) amt[bal.code] = gross.minus(used);

  const wages = tpl.filter((c) => c.isWage).reduce((a, c) => a.plus(amt[c.code] ?? 0), D(0));
  // 50% wage rule: if excluded components exceed half of remuneration, the excess is deemed wages.
  const deemed = rupee(max(0, gross.minus(wages).minus(gross.times(0.5))));
  const effWages = wages.plus(i.labourCodeMode === false ? 0 : deemed);
  const month = i.asOf ?? new Date().toISOString().slice(0, 7);
  const stat = computeStatutory(
    { gender: i.gender ?? 'M', state: i.state, age: i.age ?? 30, doj: i.doj ?? `${month}-01`, pfCapMode: i.pfCapMode, pfOptOut: i.pfOptOut, internationalWorker: i.internationalWorker, esiExempt: i.esiExempt },
    { month, pfWage: n(effWages), esiGross: n(gross), grossMonthly: n(gross), payableDays: 30, wages: n(effWages) },
    rules,
  );
  const erPf = D((stat.pf?.employerTotal as number) ?? 0);
  const erEsi = D((stat.esi?.employer as number) ?? 0);
  const grat = D(stat.gratuityProvision.amount);
  return { amt, wages, deemed, stat, employerCost: erPf.plus(erEsi).plus(grat), erPf, erEsi, grat };
}

/** CTC split (spec §5). By default CTC is gross × 12 + variable; with employerCostInCtc the gross is solved so gross + employer costs = monthly CTC. */
export function splitCtc(i: CtcInput, rules: StatutoryRule[] = STATUTORY_RULES, taxRules: TaxRule[] = TAX_RULES) {
  const tpl = i.template ?? DEFAULT_TEMPLATE;
  const variable = D(i.annualVariable ?? 0);
  let gross: Decimal;
  let r: ReturnType<typeof build>;
  if (i.monthlyGross) {
    gross = rupee(D(i.monthlyGross));
  } else if (!i.employerCostInCtc) {
    const monthlyCtc = D(i.annualCtc).minus(variable).dividedBy(12);
    if (monthlyCtc.lte(0)) throw new Error('CTC must exceed variable pay');
    gross = rupee(monthlyCtc);
  } else {
    const monthlyCtc = D(i.annualCtc).minus(variable).dividedBy(12);
    if (monthlyCtc.lte(0)) throw new Error('CTC must exceed variable pay');
    gross = monthlyCtc.times(0.85).toDecimalPlaces(0);
    r = build(gross, i, tpl, rules);
    for (let k = 0; k < 60; k++) {
      const diff = monthlyCtc.minus(gross.plus(r.employerCost));
      if (diff.abs().lt(1)) break;
      // Damped step: employer costs grow with gross, so move by the diff scaled to avoid oscillation at ESI/PF edges.
      gross = gross.plus(diff.times(0.9)).toDecimalPlaces(2);
      r = build(gross, i, tpl, rules);
    }
    gross = rupee(gross);
  }
  r = build(gross, i, tpl, rules);

  const balCode = tpl.find((c) => c.calc === 'balance')?.code;
  if (balCode && r.amt[balCode].lt(0)) throw new Error(`Component ${balCode} is negative: fixed components exceed gross`);

  const warnings: string[] = [];
  if (r.deemed.gt(0)) warnings.push(`50% wage rule: ₹${n(r.deemed)}/month added to wages for PF, ESI, gratuity and bonus`);

  const empPf = D((r.stat.pf?.employee as number) ?? 0);
  const empEsi = D((r.stat.esi?.employee as number) ?? 0);
  const pt = D(r.stat.pt.amount);
  const annualGross = gross.times(12).plus(variable);
  const basicDa = r.wages.times(12);
  const tax = compareRegimes(taxRules, {
    taxYear: i.taxYear ?? '2026-27', ageBand: (i.age ?? 30) >= 80 ? '80plus' : (i.age ?? 30) >= 60 ? '60to79' : 'below60',
    annualSalary: n(annualGross), basicDaAnnual: n(basicDa), hraReceived: n((r.amt.HRA ?? D(0)).times(12)), rentPaid: 0, metro: i.metro,
    professionalTax: n(pt.times(12)), deductions: { '80C': n(empPf.times(12)) },
  });
  const tdsNew = rupee(D(tax.new.totalTax).dividedBy(12));
  const tdsOld = rupee(D(tax.old.totalTax).dividedBy(12));

  return {
    components: tpl.map((c) => ({ code: c.code, name: c.name, monthly: n(r.amt[c.code] ?? 0), annual: n((r.amt[c.code] ?? D(0)).times(12)), isWage: c.isWage })),
    monthlyGross: n(gross),
    annualVariable: n(variable),
    employer: { pf: n(r.erPf), esi: n(r.erEsi), gratuity: n(r.grat), monthlyTotal: n(r.employerCost) },
    employee: { pf: n(empPf), esi: n(empEsi), pt: n(pt) },
    wages: n(r.wages), deemedWages: n(r.deemed),
    tds: { new: n(tdsNew), old: n(tdsOld), recommended: tax.recommended },
    takeHome: { new: n(gross.minus(empPf).minus(empEsi).minus(pt).minus(tdsNew)), old: n(gross.minus(empPf).minus(empEsi).minus(pt).minus(tdsOld)) },
    checkCtc: n((i.employerCostInCtc ? gross.plus(r.employerCost) : gross).times(12).plus(variable)),
    statutory: r.stat,
    warnings,
  };
}

