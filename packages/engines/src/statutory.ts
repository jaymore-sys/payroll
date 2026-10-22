import { D, max, min, n, rupee, rupeeUp } from './money';
import { ruleAsOf, type BonusParams, type EsiParams, type GratuityParams, type LwfParams, type PfParams, type PtParams, type StatutoryRule } from './rules';

export interface StatEmployee {
  gender: 'M' | 'F';
  state: string;             // work-location state code, e.g. MH
  age: number;
  doj: string;               // YYYY-MM-DD
  pfCapMode: 'capped' | 'actual';
  pfOptOut?: boolean;
  internationalWorker?: boolean;
  vpfRate?: number;
  disabled?: boolean;
  /** ESI covered at the start of the contribution period (Apr–Sep / Oct–Mar). Overrides the monthly test. */
  esiCoveredThisPeriod?: boolean;
}
export interface MonthInputs {
  month: string;      // YYYY-MM
  pfWage: number;     // Basic + DA (+ deemed wages), already prorated
  esiGross: number;   // ESI gross for the month
  grossMonthly: number; // for PT
  payableDays: number;
  wages: number;      // Labour Code wages for gratuity provision
}

/** computeStatutory (spec §6.7): pure, every line carries the rule ID it used. */
export function computeStatutory(e: StatEmployee, m: MonthInputs, rules: StatutoryRule[]) {
  const asOf = `${m.month}-01`;
  const monthNo = Number(m.month.slice(5, 7));
  const notes: string[] = [];

  /* PF */
  const pfR = ruleAsOf<PfParams>(rules, 'pf', asOf);
  let pf = null as null | Record<string, number | string>;
  if (pfR && !e.pfOptOut) {
    const p = pfR.params;
    const capped = e.pfCapMode === 'capped' && !e.internationalWorker;
    const base = capped ? min(m.pfWage, p.ceiling) : D(m.pfWage);
    const ceilWage = min(m.pfWage, p.ceiling);
    const epsEligible = !e.internationalWorker && e.age < p.epsAgeLimit && !(e.doj >= '2014-09-01' && D(m.pfWage).gt(p.ceiling));
    if (!epsEligible) notes.push('No EPS: age, international worker or post-Sep-2014 joiner above ceiling');
    const employee = rupee(base.times(p.empRate));
    const employerTotal = rupee(base.times(p.erRate));
    const eps = epsEligible ? rupee(min(ceilWage.times(p.epsRate), p.epsMax)) : D(0);
    pf = {
      ruleId: pfR.id, pfWage: n(base), employee: n(employee), vpf: n(rupee(base.times(e.vpfRate ?? 0))),
      eps: n(eps), epf: n(employerTotal.minus(eps)), employerTotal: n(employerTotal),
      edli: n(rupee(ceilWage.times(p.edliRate))), admin: n(rupee(base.times(p.adminRate))),
    };
  }

  /* ESI */
  const esiR = ruleAsOf<EsiParams>(rules, 'esi', asOf);
  let esi = null as null | Record<string, number | string | boolean>;
  if (esiR) {
    const p = esiR.params;
    const limit = e.disabled ? p.pwdGrossLimit : p.grossLimit;
    const covered = e.esiCoveredThisPeriod ?? D(m.esiGross).lte(limit);
    const avgDaily = m.payableDays > 0 ? D(m.esiGross).dividedBy(m.payableDays) : D(0);
    const employee = covered && avgDaily.gt(p.empExemptDailyWage) ? rupeeUp(D(m.esiGross).times(p.empRate)) : D(0);
    esi = { ruleId: esiR.id, covered, esiGross: m.esiGross, employee: n(employee), employer: covered ? n(rupeeUp(D(m.esiGross).times(p.erRate))) : 0 };
  }

  /* PT — states without a row return zero */
  const ptR = ruleAsOf<PtParams>(rules, 'pt', asOf, e.state);
  let ptAmount = 0;
  if (ptR) {
    const g = D(m.grossMonthly);
    const slab = ptR.params.slabs.find((s) => (s.gender === 'any' || s.gender === e.gender) && g.gte(s.from) && (s.to === null || g.lte(s.to)));
    if (slab) ptAmount = monthNo === 2 && slab.febAmount ? slab.febAmount : slab.amount;
  }

  /* LWF */
  const lwfR = ruleAsOf<LwfParams>(rules, 'lwf', asOf, e.state);
  const lwfDue = !!lwfR && lwfR.params.months.includes(monthNo);

  const grR = ruleAsOf<GratuityParams>(rules, 'gratuity', asOf);
  return {
    pf, esi,
    pt: { ruleId: ptR?.id ?? null, amount: ptAmount },
    lwf: { ruleId: lwfR?.id ?? null, employee: lwfDue ? lwfR!.params.employee : 0, employer: lwfDue ? lwfR!.params.employer : 0 },
    gratuityProvision: { ruleId: grR?.id ?? null, amount: grR ? n(rupee(D(m.wages).times(grR.params.provisionRate))) : 0 },
    notes,
  };
}

/** Gratuity at exit (spec §6.5). */
export function gratuity(p: GratuityParams, i: { doj: string; lastWorkingDay: string; lastMonthlyWages: number; fixedTerm?: boolean; deathOrDisability?: boolean }) {
  const start = new Date(i.doj), end = new Date(i.lastWorkingDay);
  let years = end.getFullYear() - start.getFullYear();
  const anniv = new Date(start); anniv.setFullYear(start.getFullYear() + years);
  if (anniv > end) { years--; anniv.setFullYear(anniv.getFullYear() - 1); }
  const extraDays = Math.round((end.getTime() - anniv.getTime()) / 86400000);
  const eligible = !!i.deathOrDisability || years >= p.minYears || (years === p.minYears - 1 && extraDays >= 240) || (!!i.fixedTerm && years >= p.fixedTermMinYears);
  const counted = years + (extraDays > 182 ? 1 : 0);
  const amount = eligible ? rupee(D(i.lastMonthlyWages).times(15).dividedBy(26).times(counted)) : D(0);
  return { eligible, completedYears: years, countedYears: counted, amount: n(amount), exempt: n(min(amount, p.taxExemptLimit)), taxable: n(max(0, amount.minus(p.taxExemptLimit))) };
}

/** Statutory bonus for a year (spec §6.6). */
export function statutoryBonus(p: BonusParams, i: { monthlyWages: number; workedDays: number; months: number; rate: number; stateMinWage?: number }) {
  if (D(i.monthlyWages).gt(p.wageLimit) || i.workedDays < 30) return { eligible: false, amount: 0 };
  const rate = Math.min(Math.max(i.rate, p.minRate), p.maxRate);
  const bonusWage = min(i.monthlyWages, max(p.calcCeiling, i.stateMinWage ?? 0));
  return { eligible: true, amount: n(rupee(bonusWage.times(rate).times(i.months))) };
}
