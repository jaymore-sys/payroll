import { D, Decimal, max, n, rupee } from './money';
import { findTaxRule, type AgeBand, type Regime, type StatutoryRule, type TaxRule } from './rules';
import { computeStatutory, type StatEmployee } from './statutory';
import { computeRegime, noPanTds, type Line } from './tax';

/** FY month index: April = 1 … March = 12. */
export const fyMonth = (month: string) => ((Number(month.slice(5, 7)) - 4 + 12) % 12) + 1;
export const taxYearOf = (month: string) => {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Days the employee is on the rolls in `month`, clipped by joining date and last working day. */
export function periodDays(month: string, doj: string, lastWorkingDay?: string | null) {
  const dim = daysInMonth(month);
  const first = `${month}-01`, last = `${month}-${String(dim).padStart(2, '0')}`;
  if (doj > last || (lastWorkingDay && lastWorkingDay < first)) return 0;
  const from = doj > first ? Number(doj.slice(8, 10)) : 1;
  const to = lastWorkingDay && lastWorkingDay < last ? Number(lastWorkingDay.slice(8, 10)) : dim;
  return Math.max(0, to - from + 1);
}

export interface PayslipInput {
  month: string;                         // YYYY-MM
  components: { code: string; name: string; monthly: number; isWage: boolean }[]; // from the salary structure
  deemedWages?: number;                  // monthly, 50% wage rule
  employee: StatEmployee & { doj: string; lastWorkingDay?: string | null; regime: Regime; ageBand: AgeBand; metro: boolean; hasPan: boolean };
  payableDaysMethod?: 'calendar' | 'fixed30' | 'working';
  lopDays?: number;
  bonus?: number;                        // one-time, taxable, not prorated, outside ESI/PF wages
  otherEarnings?: number;                // one-time taxable earnings (incentive, arrears)
  otherDeductions?: number;              // recoveries, canteen, advances
  ytd?: { taxable: number; tds: number; pf: number; pt: number; months?: number }; // finalised payslips earlier in this FY; months = how many
  prevEmployer?: { taxable: number; tds: number };
}

/**
 * One employee, one month (spec §10.2). Pure: same inputs → same payslip; every line says how it was computed.
 */
export function computePayslip(i: PayslipInput, statRules: StatutoryRule[], taxRules: TaxRule[]) {
  const dim = daysInMonth(i.month);
  const divisor = i.payableDaysMethod === 'fixed30' ? 30 : dim; // ponytail: 'working' falls back to calendar until attendance (phase 3) supplies working days
  const period = periodDays(i.month, i.employee.doj, i.employee.lastWorkingDay);
  const lop = Math.min(Math.max(i.lopDays ?? 0, 0), period);
  const payable = period - lop;
  const ratio = D(payable).dividedBy(divisor).toDecimalPlaces(10);
  const notes: string[] = [];
  if (period < dim) notes.push(`On rolls ${period} of ${dim} days`);
  if (lop) notes.push(`${lop} LOP day(s)`);

  // 1. Earnings, prorated by payable days
  const earnings = i.components.map((c) => ({ code: c.code, name: c.name, full: c.monthly, amount: n(rupee(D(c.monthly).times(ratio))), isWage: c.isWage }));
  const regular = earnings.reduce((a, e) => a.plus(e.amount), D(0));
  const bonus = D(i.bonus ?? 0), other = D(i.otherEarnings ?? 0);
  const gross = regular.plus(bonus).plus(other);

  // 2. Statutory on prorated wages
  const wages = earnings.filter((e) => e.isWage).reduce((a, e) => a.plus(e.amount), D(0)).plus(rupee(D(i.deemedWages ?? 0).times(ratio)));
  const stat = computeStatutory(i.employee, { month: i.month, pfWage: n(wages), esiGross: n(regular.plus(other)), grossMonthly: n(gross), payableDays: Math.max(payable, 1), wages: n(wages) }, statRules);
  const pfEmp = D((stat.pf?.employee as number) ?? 0).plus((stat.pf?.vpf as number) ?? 0);
  const esiEmp = D((stat.esi?.employee as number) ?? 0);
  const pt = D(stat.pt.amount), lwf = D(stat.lwf.employee);

  // 3. TDS (spec §7.3): project the year on the current structure, spread the balance; one-time pay taxed in full this month
  const m = fyMonth(i.month);
  // Months of this FY before this one while the employee was on the rolls. If none of them were paid through
  // PayrollPro (first run mid-year, no opening YTD imported), assume they were paid at the current salary —
  // otherwise the projection covers only the remaining months and TDS is badly under-deducted.
  const fyFirst = `${taxYearOf(i.month).slice(0, 4)}-04`;
  const joinMonth = i.employee.doj.slice(0, 7);
  const earlier = Math.max(0, m - 1 - (joinMonth > fyFirst ? fyMonth(joinMonth) - 1 : 0));
  const covered = i.ytd ? (i.ytd.months ?? earlier) : 0;
  const assumed = Math.max(0, earlier - covered);
  const assumeEarlier = assumed > 0;
  const recurringFull = i.components.reduce((a, c) => a.plus(c.monthly), D(0));
  const fullPf = D((stat.pf?.employee as number) ?? 0); // this month's PF at full pay is a close proxy for earlier months
  const base = i.ytd ?? { taxable: 0, tds: 0, pf: 0, pt: 0 };
  const ytd = {
    taxable: n(D(base.taxable).plus(recurringFull.times(assumed))), tds: base.tds,
    pf: n(D(base.pf).plus(fullPf.times(assumed))), pt: base.pt + Math.min(stat.pt.amount, 200) * assumed,
  };
  if (assumeEarlier) notes.push(`${assumed} earlier month(s) this FY not paid through PayrollPro: assumed at current salary and TDS — import opening YTD for exact figures`);
  const prev = i.prevEmployer ?? { taxable: 0, tds: 0 };
  const wageFull = i.components.filter((c) => c.isWage).reduce((a, c) => a.plus(c.monthly), D(0));
  const hraFull = D(i.components.find((c) => c.code === 'HRA')?.monthly ?? 0);
  const remaining = 12 - m;
  const projected = (extra: Decimal) => {
    const salary = D(ytd.taxable).plus(regular).plus(other).plus(recurringFull.times(remaining)).plus(prev.taxable).plus(extra);
    const rule = findTaxRule(taxRules, taxYearOf(i.month), i.employee.regime, i.employee.ageBand);
    return computeRegime(rule, {
      taxYear: rule.taxYear, ageBand: i.employee.ageBand, annualSalary: n(salary),
      basicDaAnnual: n(wageFull.times(12)), hraReceived: n(hraFull.times(12)), rentPaid: 0, metro: i.employee.metro,
      professionalTax: n(D(ytd.pt).plus(pt).plus(D(Math.min(stat.pt.amount, 200)).times(remaining))),
      deductions: { '80C': n(D(ytd.pf).plus(pfEmp).plus(D((stat.pf?.employee as number) ?? 0).times(remaining))) },
    });
  };
  const withoutBonus = projected(D(0));
  const withBonus = bonus.gt(0) ? projected(bonus) : withoutBonus;
  // Assumed earlier months carry their share of the year's tax, so the rest spreads evenly.
  // Each assumed month carries its share of the year's tax (months on the rolls this FY = earlier + remaining incl. this one).
  const assumedTds = assumeEarlier ? D(withoutBonus.totalTax).times(assumed).dividedBy(earlier + 12 - m + 1) : D(0);
  const paidSoFar = D(ytd.tds).plus(prev.tds).plus(assumedTds);
  const regularTds = max(0, rupee(D(withoutBonus.totalTax).minus(paidSoFar).dividedBy(12 - m + 1)));
  let tds = regularTds.plus(max(0, D(withBonus.totalTax).minus(withoutBonus.totalTax)));
  // No PAN (s.206AA): the year's TDS is the higher of 20% or the average rate on taxable income — only when tax is
  // actually payable; no TDS is due when income is below the taxable limit.
  if (!i.employee.hasPan && withBonus.totalTax > 0) {
    const yearly = noPanTds(withBonus.taxableIncome, withBonus.totalTax);
    const floor = max(0, rupee(D(yearly).minus(paidSoFar).dividedBy(12 - m + 1)));
    if (floor.gt(tds)) { tds = floor; notes.push('No PAN: TDS at 20% of taxable income'); }
  }

  // 4. Deductions and net pay. Statutory deductions are never reduced; other deductions are capped so net ≥ 0.
  const statutory = pfEmp.plus(esiEmp).plus(pt).plus(lwf).plus(tds);
  let otherDed = D(i.otherDeductions ?? 0);
  if (gross.minus(statutory).minus(otherDed).lt(0)) {
    const capped = max(0, gross.minus(statutory));
    notes.push(`Other deductions capped at ₹${n(capped)}; ₹${n(otherDed.minus(capped))} carried forward`);
    otherDed = capped;
  }
  const totalDed = statutory.plus(otherDed);
  const net = rupee(gross.minus(totalDed));
  if (net.lt(0)) notes.push('Net pay negative after statutory deductions — review before finalising');

  // 5. Employer cost
  const erPf = D((stat.pf?.employerTotal as number) ?? 0), edli = D((stat.pf?.edli as number) ?? 0), admin = D((stat.pf?.admin as number) ?? 0);
  const erEsi = D((stat.esi?.employer as number) ?? 0), erLwf = D(stat.lwf.employer), grat = D(stat.gratuityProvision.amount);
  const employerCost = erPf.plus(edli).plus(admin).plus(erEsi).plus(erLwf).plus(grat);

  const L = (section: string, label: string, amount: Decimal | number, ruleId?: string | null) => ({ section, label, amount: n(D(amount)), ruleId: ruleId ?? undefined });
  const lines = [
    ...earnings.map((e) => L('earning', e.name, e.amount)),
    ...(bonus.gt(0) ? [L('earning', 'Bonus', bonus)] : []),
    ...(other.gt(0) ? [L('earning', 'Other earnings', other)] : []),
    L('deduction', 'Employee PF Contribution', pfEmp, stat.pf?.ruleId as string),
    L('deduction', 'ESI', esiEmp, stat.esi?.ruleId as string),
    L('deduction', 'Professional Tax', pt, stat.pt.ruleId),
    L('deduction', 'Labour welfare fund', lwf, stat.lwf.ruleId),
    L('deduction', 'Income tax (TDS)', tds, `${taxYearOf(i.month)}/${i.employee.regime}`),
    ...(otherDed.gt(0) ? [L('deduction', 'Other deductions', otherDed)] : []),
    L('employer', 'Employer PF', erPf, stat.pf?.ruleId as string), L('employer', 'EDLI', edli), L('employer', 'PF admin', admin),
    L('employer', 'Employer ESI', erEsi, stat.esi?.ruleId as string), L('employer', 'Employer LWF', erLwf), L('employer', 'Gratuity provision', grat),
  ].filter((l) => l.section === 'earning' || l.amount !== 0);

  return {
    month: i.month, daysInMonth: dim, periodDays: period, lopDays: lop, payableDays: payable,
    earnings, gross: n(gross), taxableGross: n(gross),
    deductions: { pf: n(pfEmp), esi: n(esiEmp), pt: n(pt), lwf: n(lwf), tds: n(tds), other: n(otherDed), total: n(totalDed) },
    net: n(net),
    employer: { pf: n(erPf), eps: (stat.pf?.eps as number) ?? 0, epf: (stat.pf?.epf as number) ?? 0, edli: n(edli), admin: n(admin), esi: n(erEsi), lwf: n(erLwf), gratuity: n(grat), total: n(employerCost) },
    pfWage: (stat.pf?.pfWage as number) ?? 0, esiGross: stat.esi?.covered ? n(regular.plus(other)) : 0,
    tax: { regime: i.employee.regime, annualTax: withBonus.totalTax, projectedTaxable: withBonus.taxableIncome, paidSoFar: n(rupee(paidSoFar)), assumedEarlierMonths: assumed, thisMonth: n(tds), worksheet: withBonus.lines as Line[] },
    lines, notes,
  };
}
export type Payslip = ReturnType<typeof computePayslip>;
