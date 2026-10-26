import { describe, expect, it } from 'vitest';
import { STATUTORY_RULES as SR, TAX_RULES as TR, annualTax, computePayslip, daysInMonth, findTaxRule, fyMonth, periodDays, splitCtc, taxYearOf, type PayslipInput } from '../src';

const s = splitCtc({ annualCtc: 1800000, employerCostInCtc: true, metro: true, pfCapMode: 'capped', state: 'MH' });
const emp = { gender: 'M' as const, state: 'MH', age: 30, doj: '2020-01-01', pfCapMode: 'capped' as const, regime: 'new' as const, ageBand: 'below60' as const, metro: true, hasPan: true };
const base = (o: Partial<PayslipInput> = {}): PayslipInput => ({ month: '2026-04', components: s.components, employee: emp, ...o });

describe('payroll helpers', () => {
  it('FY month, tax year, days', () => {
    expect(fyMonth('2026-04')).toBe(1);
    expect(fyMonth('2027-03')).toBe(12);
    expect(taxYearOf('2027-02')).toBe('2026-27');
    expect(daysInMonth('2028-02')).toBe(29);
    expect(periodDays('2026-07', '2026-07-16')).toBe(16);
    expect(periodDays('2026-07', '2020-01-01', '2026-07-10')).toBe(10);
    expect(periodDays('2026-07', '2026-08-01')).toBe(0);
  });
});

describe('computePayslip (spec §10.2)', () => {
  it('full month: gross = structure, TDS spreads the projected annual tax over 12 months', () => {
    const p = computePayslip(base(), SR, TR);
    expect(p.gross).toBe(s.monthlyGross);
    expect(p.payableDays).toBe(30);
    const expected = annualTax(findTaxRule(TR, '2026-27', 'new', 'below60'), s.monthlyGross * 12 - 75000).totalTax;
    expect(p.tax.annualTax).toBe(expected);
    expect(p.deductions.tds).toBe(Math.round(expected / 12));
    expect(p.deductions.pf).toBe(1800);
    expect(p.deductions.pt).toBe(200);
    expect(p.net).toBe(p.gross - p.deductions.total);
  });
  it('LOP prorates every component by payable days', () => {
    const p = computePayslip(base({ month: '2026-06', lopDays: 2 }), SR, TR);
    const basic = s.components.find((c) => c.code === 'BASIC')!.monthly;
    expect(p.payableDays).toBe(28);
    expect(p.earnings.find((e) => e.code === 'BASIC')!.amount).toBe(Math.round((basic * 28) / 30));
  });
  it('mid-month joiner is paid for days on the rolls only', () => {
    const p = computePayslip(base({ month: '2026-07', employee: { ...emp, doj: '2026-07-16' } }), SR, TR);
    expect(p.periodDays).toBe(16);
    expect(Math.abs(p.gross - (s.monthlyGross * 16) / 31)).toBeLessThan(3);
  });
  it('one-time bonus: the whole extra tax is deducted this month (spec §7.3 step 10)', () => {
    const a = computePayslip(base(), SR, TR);
    const b = computePayslip(base({ bonus: 100000 }), SR, TR);
    expect(b.gross - a.gross).toBe(100000);
    expect(b.deductions.tds - a.deductions.tds).toBe(b.tax.annualTax - a.tax.annualTax);
  });
  it('TDS stays level mid-year when earlier months were paid at the same salary', () => {
    const apr = computePayslip(base(), SR, TR);
    const oct = computePayslip(base({ month: '2026-10', ytd: { taxable: apr.gross * 6, tds: apr.deductions.tds * 6, pf: 1800 * 6, pt: 1200 } }), SR, TR);
    expect(Math.abs(oct.deductions.tds - apr.deductions.tds)).toBeLessThanOrEqual(2);
  });
  it('first run mid-year without YTD: projects the full year, TDS matches a steady-state month', () => {
    const apr = computePayslip(base(), SR, TR);
    const oct = computePayslip(base({ month: '2026-10' }), SR, TR);
    expect(oct.tax.annualTax).toBe(apr.tax.annualTax);
    expect(Math.abs(oct.deductions.tds - apr.deductions.tds)).toBeLessThanOrEqual(2);
    expect(oct.notes.join(' ')).toMatch(/6 earlier month\(s\)/);
  });
  it('partial YTD: months missing from PayrollPro are still assumed', () => {
    const apr = computePayslip(base(), SR, TR);
    const oct = computePayslip(base({ month: '2026-10' }), SR, TR); // first run in October
    const nov = computePayslip(base({ month: '2026-11', ytd: { taxable: oct.gross, tds: oct.deductions.tds, pf: 1800, pt: 200, months: 1 } }), SR, TR);
    expect(nov.tax.assumedEarlierMonths).toBe(6);
    expect(nov.tax.annualTax).toBe(apr.tax.annualTax);
    expect(Math.abs(nov.deductions.tds - apr.deductions.tds)).toBeLessThanOrEqual(2);
  });
  it('mid-year joiner: only months since joining are assumed', () => {
    const p = computePayslip(base({ month: '2026-10', employee: { ...emp, doj: '2026-08-01' } }), SR, TR);
    expect(p.tax.assumedEarlierMonths).toBe(2);
    expect(p.tax.projectedTaxable).toBeLessThan(computePayslip(base({ month: '2026-10' }), SR, TR).tax.projectedTaxable);
  });
  it('other deductions are capped so net pay never goes negative; statutory never reduced', () => {
    const p = computePayslip(base({ otherDeductions: 10_000_000 }), SR, TR);
    expect(p.net).toBe(0);
    expect(p.deductions.pf).toBe(1800);
    expect(p.notes.join(' ')).toMatch(/capped/);
  });
  it('no PAN: TDS at least 20% of gross', () => {
    const p = computePayslip(base({ employee: { ...emp, hasPan: false } }), SR, TR);
    expect(p.deductions.tds).toBe(Math.round(p.gross * 0.2));
  });
  it('low earner: ESI applies and income tax is nil', () => {
    const low = splitCtc({ annualCtc: 240000, employerCostInCtc: true, metro: false, pfCapMode: 'capped', state: 'MH' });
    const p = computePayslip(base({ components: low.components, employee: { ...emp, metro: false } }), SR, TR);
    expect(p.deductions.esi).toBeGreaterThan(0);
    expect(p.employer.esi).toBeGreaterThan(0);
    expect(p.deductions.tds).toBe(0);
  });
});

describe('company payslip format (September 2026 payslips)', () => {
  const sep = (gross: number, lopDays = 0) => {
    const st = splitCtc({ annualCtc: 0, monthlyGross: gross, metro: true, pfCapMode: 'capped', state: 'MH', asOf: '2026-09' });
    return computePayslip({ month: '2026-09', components: st.components, deemedWages: st.deemedWages, lopDays, employee: { ...emp, doj: '2025-06-18', metro: true } }, SR, TR);
  };
  it('₹30,000 gross: Basic 50%, HRA 25%, LTA 10%, Special 15%; PF on gross − HRA; net 27,100', () => {
    const p = sep(30000);
    expect(p.earnings.map((e) => [e.name, e.amount])).toEqual([['Basic', 15000], ['House Rent Allowance', 7500], ['Leave & Travel Allowance', 3000], ['Special Allowance', 4500]]);
    expect(p.deductions).toMatchObject({ pf: 2700, pt: 200, tds: 0, esi: 0, total: 2900 });
    expect(p.net).toBe(27100);
  });
  it('₹37,500 gross with 3 LOP days: gross 33,751, PF capped at ₹3,000, net 30,551', () => {
    const p = sep(37500, 3);
    expect(p.earnings.map((e) => e.amount)).toEqual([16875, 8438, 3375, 5063]);
    expect(p.gross).toBe(33751);
    expect(p.deductions).toMatchObject({ pf: 3000, pt: 200, total: 3200 });
    expect(p.net).toBe(30551);
  });
});

describe('RazorpayX Master CTC Report (Valencia)', () => {
  it('CTC is gross × 12: ₹3,60,000 → Basic 15,000, HRA 7,500, LTA 3,000, Special 4,500', () => {
    const r = splitCtc({ annualCtc: 360000, metro: true, pfCapMode: 'capped', state: 'MH', asOf: '2026-10' });
    expect(r.monthlyGross).toBe(30000);
    expect(r.checkCtc).toBe(360000);
    expect(Object.fromEntries(r.components.map((c) => [c.code, c.annual]))).toEqual({ BASIC: 180000, HRA: 90000, LTA: 36000, SPECIAL: 54000 });
    expect(r.employee.pf).toBe(2700); // 12% of everything except HRA
  });
  it('PF disabled and company without ESI: no PF, no ESI', () => {
    const r = splitCtc({ annualCtc: 120000, metro: true, pfCapMode: 'capped', state: 'MH', asOf: '2026-10', pfOptOut: true, esiExempt: true });
    expect(r.employee).toMatchObject({ pf: 0, esi: 0 });
    expect(r.employer.esi).toBe(0);
  });
  it('Tax Computation Report: ₹18,02,400 new regime → ₹1,51,299 for the year', () => {
    const t = annualTax(findTaxRule(TR, '2026-27', 'new', 'below60'), 1802400 - 75000);
    expect(t.totalTax).toBe(151299);
  });
});
