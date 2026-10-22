import { D, n, rupee } from './money';

const toUTC = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const roundHalf = (x: number) => Math.round(x * 2) / 2;

/** Upfront proration for a joiner (spec §9.2): includes the joining month if joined on/before the 15th; nearest 0.5. */
export function upfrontProration(quota: number, joinDate: string, leaveYearStartMonth = 1): number {
  const j = toUTC(joinDate);
  const jm = j.getUTCMonth() + 1;
  const monthsFromStart = (jm - leaveYearStartMonth + 12) % 12; // 0-based index of join month in leave year
  const remaining = 12 - monthsFromStart - (j.getUTCDate() <= 15 ? 0 : 1);
  return roundHalf((quota * remaining) / 12);
}

export const monthlyAccrual = (quota: number) => quota / 12;
/** EL by days worked: floor(days / 20). Days worked include paid leave and holidays, exclude LOP. */
export const daysWorkedAccrual = (daysWorked: number, per = 20) => Math.floor(daysWorked / per);

export interface WeekPattern {
  weeklyOffs: number[];            // 0 = Sunday … 6 = Saturday
  offSaturdaysOfMonth?: number[];  // e.g. [2, 4] for 2nd and 4th Saturday
}
export function isOff(date: string, p: WeekPattern, holidays: string[] = []): boolean {
  const d = toUTC(date);
  const dow = d.getUTCDay();
  if (holidays.includes(date) || p.weeklyOffs.includes(dow)) return true;
  return dow === 6 && !!p.offSaturdaysOfMonth?.includes(Math.ceil(d.getUTCDate() / 7));
}

export interface LeaveRequestInput {
  from: string; to: string;
  halfDayFrom?: boolean; halfDayTo?: boolean;
  pattern: WeekPattern; holidays?: string[];
  sandwich?: boolean;
}
/** Days counted = calendar days − offs/holidays (unless sandwiched) − half-day adjustments (spec §9.2). */
export function leaveDays(r: LeaveRequestInput) {
  const start = toUTC(r.from), end = toUTC(r.to);
  if (end < start) throw new RangeError('to must be on or after from');
  const days: { date: string; off: boolean }[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = iso(d);
    days.push({ date: s, off: isOff(s, r.pattern, r.holidays) });
  }
  const firstWork = days.findIndex((x) => !x.off);
  const lastWork = days.length - 1 - [...days].reverse().findIndex((x) => !x.off);
  let counted = 0, offsExcluded = 0;
  days.forEach((x, i) => {
    if (!x.off) counted++;
    else if (r.sandwich && firstWork >= 0 && i > firstWork && i < lastWork) counted++; // off-day between two leave days
    else offsExcluded++;
  });
  const first = days[0], last = days[days.length - 1];
  if (days.length === 1) { if ((r.halfDayFrom || r.halfDayTo) && !first.off) counted = 0.5; }
  else {
    if (r.halfDayFrom && !first.off) counted -= 0.5;
    if (r.halfDayTo && !last.off) counted -= 0.5;
  }
  return { calendarDays: days.length, offsExcluded, counted: Math.max(0, counted) };
}

/** Year-end processing (spec §9.2). */
export function yearEnd(balance: number, carryCap: number, encashOn: boolean, encashCap: number) {
  const carry = Math.max(0, Math.min(balance, carryCap));
  const encash = encashOn ? Math.max(0, Math.min(balance - carry, encashCap)) : 0;
  return { carry, encash, lapse: Math.max(0, balance - carry - encash) };
}

/** Encashment amount = (Basic + DA per month ÷ divisor) × days. */
export const encashmentAmount = (basicDaMonthly: number, divisor: 26 | 30, days: number) =>
  n(rupee(D(basicDaMonthly).dividedBy(divisor).times(days)));

export type LedgerKind = 'credit' | 'debit' | 'carry' | 'lapse' | 'encash' | 'adjust';
export const balanceFromLedger = (rows: { kind: LedgerKind; days: number }[]) =>
  rows.reduce((b, r) => (r.kind === 'credit' || r.kind === 'carry' || r.kind === 'adjust' ? b + r.days : b - r.days), 0);
