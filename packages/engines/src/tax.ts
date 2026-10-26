import { D, Decimal, max, min, n, rupee, type Num } from './money';
import { findTaxRule, type AgeBand, type Regime, type TaxRule } from './rules';

export type Line = { label: string; amount: number; ruleId?: string };

/** Slab tax on taxable income. */
export function slabTax(rule: TaxRule, taxable: Num): Decimal {
  let tax = D(0), prev = D(0);
  const t = D(taxable);
  for (const s of rule.slabs) {
    if (t.lte(prev)) break;
    const top = s.upTo === null ? t : min(t, s.upTo);
    tax = tax.plus(top.minus(prev).times(s.rate));
    if (s.upTo === null) break;
    prev = D(s.upTo);
  }
  return tax;
}

function rebate87A(rule: TaxRule, taxable: Decimal, tax: Decimal): Decimal {
  if (taxable.lte(rule.rebateLimit)) return min(tax, rule.rebateMax);
  // Marginal relief (new regime): tax cannot exceed income above the rebate limit.
  if (rule.rebateMarginalRelief) {
    const excess = taxable.minus(rule.rebateLimit);
    if (tax.gt(excess)) return tax.minus(excess);
  }
  return D(0);
}

function surcharge(rule: TaxRule, taxable: Decimal, tax: Decimal): Decimal {
  const bands = [...rule.surcharge].sort((a, b) => a.above - b.above);
  let idx = -1;
  bands.forEach((b, i) => { if (taxable.gt(b.above)) idx = i; });
  if (idx < 0) return D(0);
  const band = bands[idx];
  const raw = tax.times(band.rate);
  // Marginal relief: tax + surcharge may not exceed (tax + surcharge at the threshold) + income above it.
  const prevRate = idx > 0 ? bands[idx - 1].rate : 0;
  const atThreshold = slabTax(rule, band.above).times(1 + prevRate);
  const cap = atThreshold.plus(taxable.minus(band.above));
  return max(0, min(raw, cap.minus(tax)));
}

/** Annual tax on taxable income: slab → 87A → surcharge → cess → round to the rupee. */
export function annualTax(rule: TaxRule, taxableIn: Num) {
  const taxable = max(0, rupee(taxableIn));
  const slab = slabTax(rule, taxable);
  const reb = rebate87A(rule, taxable, slab);
  const afterRebate = slab.minus(reb);
  const sur = surcharge(rule, taxable, afterRebate);
  const cess = afterRebate.plus(sur).times(rule.cessRate);
  // Rounded to the rupee like RazorpayX's Tax Computation Report (not to ₹10 as in the return under s.288B).
  const total = afterRebate.plus(sur).plus(cess).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { taxable: n(taxable), slabTax: n(rupee(slab)), rebate: n(rupee(reb)), surcharge: n(rupee(sur)), cess: n(rupee(cess)), totalTax: n(total) };
}

export interface TaxCalcInput {
  taxYear: string;
  ageBand: AgeBand;
  annualSalary: number;      // gross taxable salary excluding employer NPS
  basicDaAnnual: number;
  hraReceived?: number;
  rentPaid?: number;
  metro?: boolean;
  professionalTax?: number;
  employerNps?: number;
  otherIncome?: number;
  deductions?: { '80C'?: number; '80D'?: number; '80DParents'?: number; parentsSenior?: boolean; '80CCD1B'?: number; homeLoanInterest?: number };
}

/** Stateless regime calculator (spec §7.5, API POST /tax/calculate). */
export function computeRegime(rule: TaxRule, i: TaxCalcInput) {
  const lines: Line[] = [];
  const add = (label: string, v: Decimal, ruleId?: string) => { lines.push({ label, amount: n(rupee(v)), ruleId }); return v; };
  const L = rule.limits, ded = i.deductions ?? {};
  const rid = `${rule.taxYear}/${rule.regime}`;

  const empNps = D(i.employerNps ?? 0);
  const gross = add('Gross salary', D(i.annualSalary).plus(empNps));
  let exemptions = D(0);
  if (rule.regime === 'old') {
    const basic = D(i.basicDaAnnual);
    const hra = max(0, min(i.hraReceived ?? 0, D(i.rentPaid ?? 0).minus(basic.times(0.1)), basic.times(i.metro ? 0.5 : 0.4)));
    exemptions = exemptions.plus(add('HRA exemption 10(13A)', hra, `${rid}/hra`));
    exemptions = exemptions.plus(add('Professional tax', min(i.professionalTax ?? 0, L.pt), `${rid}/pt`));
  }
  const std = add('Standard deduction', min(rule.stdDeduction, gross.minus(exemptions)), `${rid}/std`);
  let deductions = add('Employer NPS 80CCD(2)', min(empNps, D(i.basicDaAnnual).times(L.employerNpsPct)), `${rid}/80ccd2`);
  if (rule.regime === 'old') {
    deductions = deductions
      .plus(add('80C', min(ded['80C'] ?? 0, L.c80), `${rid}/80c`))
      .plus(add('80D', min(ded['80D'] ?? 0, L.d80Self).plus(min(ded['80DParents'] ?? 0, ded.parentsSenior ? L.d80ParentsSenior : L.d80Parents)), `${rid}/80d`))
      .plus(add('80CCD(1B) own NPS', min(ded['80CCD1B'] ?? 0, L.ccd1b), `${rid}/80ccd1b`))
      .plus(add('Home loan interest 24(b)', min(ded.homeLoanInterest ?? 0, L.homeLoan), `${rid}/24b`));
  }
  const other = add('Other income', D(i.otherIncome ?? 0));
  const taxable = max(0, gross.minus(exemptions).minus(std).minus(deductions).plus(other));
  const t = annualTax(rule, taxable);
  lines.push(
    { label: 'Taxable income', amount: t.taxable },
    { label: 'Slab tax', amount: t.slabTax, ruleId: `${rid}/slabs` },
    { label: 'Rebate 87A', amount: -t.rebate, ruleId: `${rid}/87a` },
    { label: 'Surcharge', amount: t.surcharge, ruleId: `${rid}/surcharge` },
    { label: 'Health & education cess', amount: t.cess, ruleId: `${rid}/cess` },
    { label: 'Total tax', amount: t.totalTax },
  );
  return { ...t, taxableIncome: t.taxable, lines };
}

export function compareRegimes(rules: TaxRule[], i: TaxCalcInput) {
  const nw = computeRegime(findTaxRule(rules, i.taxYear, 'new', i.ageBand), i);
  const old = computeRegime(findTaxRule(rules, i.taxYear, 'old', i.ageBand), i);
  const recommended: Regime = old.totalTax < nw.totalTax ? 'old' : 'new';
  return { new: nw, old, recommended, savings: Math.abs(nw.totalTax - old.totalTax) };
}

/** Monthly TDS for month m (April = 1 … March = 12), spec §7.3 step 9. */
export function monthlyTds(annualTaxAmount: Num, tdsDeducted: Num, month: number): number {
  if (month < 1 || month > 12) throw new RangeError('month must be 1..12');
  return n(max(0, rupee(D(annualTaxAmount).minus(tdsDeducted).dividedBy(12 - month + 1))));
}

/** No PAN: higher of 20% or the average slab rate (spec §7.3 step 11). */
export function noPanTds(taxableAnnual: Num, annualTaxAmount: Num): number {
  if (D(taxableAnnual).lte(0)) return 0;
  const avg = D(annualTaxAmount).dividedBy(taxableAnnual);
  return n(rupee(D(taxableAnnual).times(max(0.2, avg))));
}
