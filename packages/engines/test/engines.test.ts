import { describe, expect, it } from 'vitest';
import {
  STATUTORY_RULES as SR, TAX_RULES as TR, annualTax, compareRegimes, computeStatutory, findTaxRule, monthlyTds, noPanTds,
  gratuity, statutoryBonus, splitCtc, upfrontProration, leaveDays, yearEnd, encashmentAmount, daysWorkedAccrual, ruleAsOf,
  type GratuityParams, type BonusParams,
} from '../src';

const NEW = findTaxRule(TR, '2026-27', 'new', 'below60');
const OLD = findTaxRule(TR, '2026-27', 'old', 'below60');

describe('tax engine (spec §7)', () => {
  it('§7.4 worked example: ₹15L new regime → ₹97,500', () => {
    const t = annualTax(NEW, 1500000 - 75000);
    expect(t).toMatchObject({ slabTax: 93750, rebate: 0, cess: 3750, totalTax: 97500 });
    expect(monthlyTds(t.totalTax, 0, 1)).toBe(8125);
  });
  it('§7.4 old regime with ₹1.5L 80C ≈ ₹2,10,600; recommends new', () => {
    const r = compareRegimes(TR, { taxYear: '2026-27', ageBand: 'below60', annualSalary: 1500000, basicDaAnnual: 750000, deductions: { '80C': 150000 } });
    expect(r.old.taxableIncome).toBe(1300000);
    expect(r.old.totalTax).toBe(210600);
    expect(r.new.totalTax).toBe(97500);
    expect(r.recommended).toBe('new');
  });
  it('§7.1 87A marginal relief: ₹12,10,000 taxable → slab ₹61,500 capped at ₹10,000', () => {
    const t = annualTax(NEW, 1210000);
    expect(t.slabTax).toBe(61500);
    expect(t.totalTax).toBe(10400); // 10,000 + 4% cess
  });
  it('nil tax up to ₹12L (new) and ₹5L (old)', () => {
    expect(annualTax(NEW, 1200000).totalTax).toBe(0);
    expect(annualTax(OLD, 500000).totalTax).toBe(0);
  });
  it('surcharge marginal relief just above ₹50L', () => {
    const at = annualTax(NEW, 5000000).totalTax;
    const above = annualTax(NEW, 5010000);
    // tax+surcharge rises by at most the extra income (plus cess on it)
    expect(above.totalTax - at).toBeLessThanOrEqual(Math.round(10000 * 1.04) + 10);
    expect(above.surcharge).toBeGreaterThan(0);
  });
  it('new regime surcharge capped at 25% above ₹5Cr', () => {
    const t = annualTax(NEW, 60000000);
    const slab = t.slabTax;
    expect(t.surcharge).toBe(Math.round(slab * 0.25));
  });
  it('HRA exemption (old regime) uses least-of rule', () => {
    const r = compareRegimes(TR, { taxYear: '2026-27', ageBand: 'below60', annualSalary: 1500000, basicDaAnnual: 750000, hraReceived: 300000, rentPaid: 240000, metro: true, deductions: { '80C': 150000, '80D': 25000 } });
    const hra = r.old.lines.find((l) => l.label.startsWith('HRA'))!;
    expect(hra.amount).toBe(165000); // 240000 − 75000
  });
  it('monthly TDS never negative; no-PAN at 20% minimum', () => {
    expect(monthlyTds(10000, 20000, 6)).toBe(0);
    expect(noPanTds(1000000, 50000)).toBe(200000);
  });
});

describe('statutory engine (spec §6)', () => {
  const emp = { gender: 'M' as const, state: 'MH', age: 30, doj: '2012-04-01', pfCapMode: 'capped' as const };
  const m = { month: '2026-06', pfWage: 30000, esiGross: 60000, grossMonthly: 60000, payableDays: 30, wages: 30000 };
  it('PF capped at ₹15,000 wage', () => {
    const s = computeStatutory(emp, m, SR);
    expect(s.pf).toMatchObject({ pfWage: 15000, employee: 1800, eps: 1250, epf: 550, edli: 75 });
  });
  it('PF on actual wage when cap is off', () => {
    const s = computeStatutory({ ...emp, pfCapMode: 'actual' }, m, SR);
    expect(s.pf).toMatchObject({ employee: 3600, eps: 1250, epf: 2350 });
  });
  it('no EPS for post-Sep-2014 joiner above the ceiling', () => {
    expect(computeStatutory({ ...emp, doj: '2020-01-01' }, m, SR).pf).toMatchObject({ eps: 0, epf: 1800 });
    expect(computeStatutory({ ...emp, doj: '2020-01-01' }, { ...m, pfWage: 14000 }, SR).pf).toMatchObject({ eps: 1166 });
  });
  it('no EPS at 58 or above', () => {
    const s = computeStatutory({ ...emp, age: 58 }, m, SR);
    expect(s.pf).toMatchObject({ eps: 0, epf: 1800 });
  });
  it('ESI: covered ≤ ₹21,000, round up; employee nil at ≤ ₹176/day', () => {
    const s = computeStatutory(emp, { ...m, esiGross: 18000 }, SR);
    expect(s.esi).toMatchObject({ covered: true, employee: 135, employer: 585 });
    expect(computeStatutory(emp, m, SR).esi).toMatchObject({ covered: false, employee: 0, employer: 0 });
    expect(computeStatutory(emp, { ...m, esiGross: 5000, payableDays: 30 }, SR).esi).toMatchObject({ employee: 0, employer: 163 });
    // covered for whole period even after crossing the limit
    expect(computeStatutory({ ...emp, esiCoveredThisPeriod: true }, { ...m, esiGross: 22000 }, SR).esi).toMatchObject({ covered: true, employee: 165 });
  });
  it('Maharashtra PT incl. ₹300 in February; female threshold', () => {
    expect(computeStatutory(emp, m, SR).pt.amount).toBe(200);
    expect(computeStatutory(emp, { ...m, month: '2027-02' }, SR).pt.amount).toBe(300);
    expect(computeStatutory(emp, { ...m, grossMonthly: 9000 }, SR).pt.amount).toBe(175);
    expect(computeStatutory({ ...emp, gender: 'F' }, { ...m, grossMonthly: 24000 }, SR).pt.amount).toBe(0);
    expect(computeStatutory({ ...emp, state: 'DL' }, m, SR).pt.amount).toBe(0);
  });
  it('MH LWF only in June and December', () => {
    expect(computeStatutory(emp, m, SR).lwf).toMatchObject({ employee: 25, employer: 75 });
    expect(computeStatutory(emp, { ...m, month: '2026-07' }, SR).lwf.employee).toBe(0);
  });
  it('gratuity: 5 years, 4y240d, part year > 6 months rounds up, fixed-term 1 year', () => {
    const p = ruleAsOf<GratuityParams>(SR, 'gratuity', '2026-10-01')!.params;
    expect(gratuity(p, { doj: '2020-01-01', lastWorkingDay: '2026-08-01', lastMonthlyWages: 26000 })).toMatchObject({ eligible: true, countedYears: 7, amount: 105000 });
    expect(gratuity(p, { doj: '2022-01-01', lastWorkingDay: '2026-09-15', lastMonthlyWages: 26000 }).eligible).toBe(true);
    expect(gratuity(p, { doj: '2023-01-01', lastWorkingDay: '2026-01-01', lastMonthlyWages: 26000 }).eligible).toBe(false);
    expect(gratuity(p, { doj: '2025-01-01', lastWorkingDay: '2026-02-01', lastMonthlyWages: 26000, fixedTerm: true }).eligible).toBe(true);
  });
  it('statutory bonus', () => {
    const p = ruleAsOf<BonusParams>(SR, 'bonus', '2026-10-01')!.params;
    expect(statutoryBonus(p, { monthlyWages: 15000, workedDays: 200, months: 12, rate: 0.0833 })).toEqual({ eligible: true, amount: 6997 });
    expect(statutoryBonus(p, { monthlyWages: 25000, workedDays: 200, months: 12, rate: 0.2 }).eligible).toBe(false);
  });
});

describe('CTC split (spec §5)', () => {
  it('gross + employer costs reconcile to CTC within ₹12/yr', () => {
    const r = splitCtc({ annualCtc: 1200000, metro: true, pfCapMode: 'capped', state: 'MH' });
    expect(Math.abs(r.checkCtc - 1200000)).toBeLessThanOrEqual(12);
    const basic = r.components.find((c) => c.code === 'BASIC')!.monthly;
    expect(basic).toBe(Math.round(r.monthlyGross * 0.5));
    expect(r.components.find((c) => c.code === 'HRA')!.monthly).toBe(Math.round(basic * 0.5));
    expect(r.deemedWages).toBe(0);
  });
  it('low CTC picks up ESI; non-metro HRA 40%', () => {
    const r = splitCtc({ annualCtc: 240000, metro: false, pfCapMode: 'capped', state: 'MH' });
    expect(r.employer.esi).toBeGreaterThan(0);
    const basic = r.components.find((c) => c.code === 'BASIC')!.monthly;
    expect(r.components.find((c) => c.code === 'HRA')!.monthly).toBe(Math.round(basic * 0.4));
    expect(Math.abs(r.checkCtc - 240000)).toBeLessThanOrEqual(12);
  });
  it('50% wage rule adds deemed wages when basic is too low', () => {
    const r = splitCtc({ annualCtc: 1200000, metro: true, pfCapMode: 'actual', state: 'MH', template: [
      { code: 'BASIC', name: 'Basic', calc: 'pct_gross', value: 0.3, isWage: true, taxable: 'full' },
      { code: 'SPECIAL', name: 'Special', calc: 'balance', isWage: false, taxable: 'full' },
    ] });
    expect(Math.abs(r.deemedWages - r.monthlyGross * 0.2)).toBeLessThanOrEqual(1);
    expect(r.warnings[0]).toMatch(/50% wage rule/);
  });
});

describe('leave calculator (spec §9)', () => {
  it('§9.3 worked example', () => {
    expect(upfrontProration(18, '2026-07-10', 1)).toBe(9);
    expect(yearEnd(5, 30, true, 10)).toEqual({ carry: 5, encash: 0, lapse: 0 });
    expect(encashmentAmount(30000, 26, 5)).toBe(5769);
  });
  it('joined after the 15th excludes the joining month; April leave year', () => {
    expect(upfrontProration(18, '2026-07-20', 1)).toBe(7.5);
    expect(upfrontProration(12, '2026-04-01', 4)).toBe(12);
  });
  it('excludes weekly offs and holidays; sandwich rule counts them', () => {
    const pattern = { weeklyOffs: [0] };
    // Fri 6 Nov 2026 → Mon 9 Nov 2026, Sunday 8th off
    expect(leaveDays({ from: '2026-11-06', to: '2026-11-09', pattern })).toMatchObject({ calendarDays: 4, offsExcluded: 1, counted: 3 });
    expect(leaveDays({ from: '2026-11-06', to: '2026-11-09', pattern, sandwich: true }).counted).toBe(4);
    expect(leaveDays({ from: '2026-11-06', to: '2026-11-09', pattern, holidays: ['2026-11-09'] }).counted).toBe(2);
  });
  it('2nd/4th Saturday off and half days', () => {
    const pattern = { weeklyOffs: [0], offSaturdaysOfMonth: [2, 4] };
    expect(leaveDays({ from: '2026-11-14', to: '2026-11-14', pattern }).counted).toBe(0); // 2nd Saturday
    expect(leaveDays({ from: '2026-11-07', to: '2026-11-07', pattern }).counted).toBe(1); // 1st Saturday
    expect(leaveDays({ from: '2026-11-10', to: '2026-11-11', pattern, halfDayFrom: true }).counted).toBe(1.5);
    expect(leaveDays({ from: '2026-11-10', to: '2026-11-10', pattern, halfDayFrom: true }).counted).toBe(0.5);
  });
  it('days-worked accrual and year-end lapse/encash', () => {
    expect(daysWorkedAccrual(59)).toBe(2);
    expect(yearEnd(45, 30, true, 10)).toEqual({ carry: 30, encash: 10, lapse: 5 });
  });
});
