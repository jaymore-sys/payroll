import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, Banknote, Building2, Calculator, CalendarCheck, CalendarDays, CalendarHeart, Clock, Coins, FileClock, IdCard, Landmark, PartyPopper, Plane, UserPlus, Users, Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { DeptCostChart, Donut, PALETTE, TrendChart } from '../components/charts';
import { Avatar, Badge, Card, CardTitle, CountUp, Item, Skeleton, Stagger, Stat } from '../components/ui';
import { get } from '../lib/api';
import { runLabel, runTone } from './Payroll';
import { useAuth } from '../lib/auth';
import { date, dateShort, dateTime, daysUntil, inr, inrShort } from '../lib/format';

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Hero({ d, name }: { d: any; name: string }) {
  const days = daysUntil(d.nextPayDate);
  return (
    <Item className="gradient-brand relative overflow-hidden rounded-3xl p-6 text-white shadow-lift sm:p-8">
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="absolute grid h-12 w-12 place-items-center rounded-full bg-white/15 text-lg font-black backdrop-blur" style={{ right: `${8 + i * 13}%`, top: `${18 + (i % 2) * 40}%` }}
          animate={{ y: [0, -14, 0], rotate: [0, 10, 0] }} transition={{ repeat: Infinity, duration: 4 + i, ease: 'easeInOut', delay: i * 0.6 }}>₹</motion.div>
      ))}
      <div className="absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div className="relative max-w-xl">
        <p className="text-sm font-medium text-white/80">{greet()},</p>
        <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{name} 👋</h1>
        <div className="mt-5 flex flex-wrap gap-3">
          <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur"><p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Next pay date</p><p className="text-lg font-bold">{date(d.nextPayDate)}</p><p className="text-xs text-white/80">{days === 0 ? 'Today' : `in ${days} day${days === 1 ? '' : 's'}`}</p></div>
          <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur"><p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Attendance cut-off</p><p className="text-lg font-bold">{date(d.cutoffDate)}</p><p className="text-xs text-white/80">in {daysUntil(d.cutoffDate)} days</p></div>
        </div>
      </div>
    </Item>
  );
}

const QuickLink = ({ to, icon, label, i }: { to: string; icon: React.ReactNode; label: string; i: number }) => (
  <Link to={to}>
    <motion.div whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.97 }} className="group flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-center transition-colors hover:border-brand/40 hover:bg-brand-soft/50">
      <span className="grid h-11 w-11 place-items-center rounded-xl text-white shadow-md transition-transform group-hover:rotate-6" style={{ background: PALETTE[i % PALETTE.length] }}>{icon}</span>
      <span className="text-xs font-semibold">{label}</span>
    </motion.div>
  </Link>
);

function AdminDash({ a, d }: { a: any; d: any }) {
  const ex = a.exceptions;
  const reminders = [
    ex.noSalary && { icon: <Wallet className="h-4 w-4" />, text: `${ex.noSalary} employee(s) without a salary structure`, to: '/employees', tone: 'bad' },
    ex.noPan && { icon: <IdCard className="h-4 w-4" />, text: `${ex.noPan} employee(s) missing PAN — TDS at 20%`, to: '/employees', tone: 'warn' },
    ex.noBank && { icon: <Landmark className="h-4 w-4" />, text: `${ex.noBank} employee(s) missing bank details`, to: '/employees', tone: 'warn' },
    a.headcount.total - a.attendanceEntered > 0 && { icon: <CalendarCheck className="h-4 w-4" />, text: `${a.headcount.total - a.attendanceEntered} employee(s) without attendance this month`, to: '/attendance', tone: 'warn' },
    a.payrollRun?.status !== 'FINALISED' && { icon: <Banknote className="h-4 w-4" />, text: !a.payrollRun ? `This month's payroll hasn't been started` : a.payrollRun.status === 'DRAFT' ? `Upload this month's attendance sheet and calculate salaries` : `This month's salaries are calculated — review and approve`, to: a.payrollRun ? `/payroll/${a.payrollRun.id}` : '/payroll', tone: 'info' },
    a.pendingChanges && { icon: <FileClock className="h-4 w-4" />, text: `${a.pendingChanges} profile change request(s) to review`, to: '/approvals', tone: 'info' },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; to: string; tone: string }[];
  const monthly = a.cost.gross + a.cost.employer;
  return (
    <>
      <Stagger className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active employees" value={a.headcount.total} icon={<Users className="h-5 w-5" />} hint={<>{a.headcount.joiners} joined this month · {a.headcount.notice} on notice</>} />
        <Stat label="Monthly payroll cost" value={monthly} format={inrShort} tone="ok" icon={<Banknote className="h-5 w-5" />} hint={<>Gross {inrShort(a.cost.gross)} + employer {inrShort(a.cost.employer)}</>} />
        <Stat label="Annual CTC" value={a.cost.ctc} format={inrShort} tone="info" icon={<Coins className="h-5 w-5" />} hint="Active salary structures" />
        <Stat label="Attendance entered" value={a.attendanceEntered} tone="warn" icon={<Clock className="h-5 w-5" />} hint={<>of {a.headcount.total} this month · <Link to="/attendance" className="font-semibold text-brand">open</Link></>} />
      </Stagger>

      <Stagger className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" hover={false}><CardTitle sub="Last 12 months">Headcount trend</CardTitle><TrendChart data={a.trend} /></Card>
        <Card className="xl:col-span-2" hover={false}><CardTitle sub="Gross + employer cost per month">Cost by department</CardTitle><DeptCostChart data={a.byDept} /></Card>
      </Stagger>

      <Stagger className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardTitle sub="Fix these before the next run">Reminders</CardTitle>
          {!reminders.length ? <p className="py-6 text-center text-sm text-muted">Nothing needs attention 🎉</p> : (
            <ul className="space-y-2">{reminders.map((r, i) => (
              <motion.li key={r.text} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.07 }}>
                <Link to={r.to} className="group flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface-2">
                  <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', { bad: 'bg-bad/12 text-bad', warn: 'bg-warn/15 text-warn', info: 'bg-info/12 text-info' }[r.tone])}>{r.icon}</span>
                  <span className="flex-1 text-sm">{r.text}</span><ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-1" />
                </Link>
              </motion.li>))}
            </ul>)}
        </Card>
        <Card>
          <CardTitle sub="Pay and file on time">Statutory due dates</CardTitle>
          <ol className="relative ml-2 space-y-4 border-l-2 border-dashed border-line pl-5">
            {d.dueDates.map((x: any, i: number) => (
              <motion.li key={x.label} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface" style={{ background: PALETTE[i] }} />
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{x.label}</p><Badge tone={daysUntil(x.date) <= 3 ? 'red' : 'gray'}>{dateShort(x.date)}</Badge></div>
                <p className="text-xs text-muted">in {daysUntil(x.date)} days</p>
              </motion.li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardTitle>Quick links</CardTitle>
          <div className="grid grid-cols-3 gap-2.5">
            <QuickLink i={0} to="/payroll" icon={<Banknote className="h-5 w-5" />} label="Run payroll" />
            <QuickLink i={1} to="/ctc" icon={<Wallet className="h-5 w-5" />} label="Salary builder" />
            <QuickLink i={2} to="/tax" icon={<Calculator className="h-5 w-5" />} label="Tax calc" />
            <QuickLink i={3} to="/approvals" icon={<CalendarCheck className="h-5 w-5" />} label="Approvals" />
            <QuickLink i={4} to="/attendance" icon={<CalendarDays className="h-5 w-5" />} label="Attendance" />
            <QuickLink i={5} to="/employees?new=1" icon={<UserPlus className="h-5 w-5" />} label="Add employee" />
          </div>
        </Card>
      </Stagger>

      <Stagger className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle>This month's payroll</CardTitle>
          <div className="flex flex-col items-center py-2 text-center">
            <motion.div animate={{ rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 4, repeatDelay: 2 }} className="gradient-brand mb-3 grid h-14 w-14 place-items-center rounded-2xl text-white"><Banknote className="h-7 w-7" /></motion.div>
            <Badge tone={!a.payrollRun ? 'amber' : runTone[a.payrollRun.status]}>{!a.payrollRun ? 'not started' : runLabel[a.payrollRun.status]}</Badge>
            <p className="mt-2 text-xs text-muted">{a.attendanceEntered} of {a.headcount.total} attendance entered</p>
            <Link to={a.payrollRun ? `/payroll/${a.payrollRun.id}` : '/payroll'} className="mt-3 text-sm font-semibold text-brand">{a.payrollRun ? 'Open run →' : 'Start payroll →'}</Link>
          </div>
        </Card>
        <Holidays list={d.holidays} />
        <Card>
          <CardTitle>Gender split</CardTitle>
          <Donut data={a.gender.map((g: any) => ({ name: g.g === 'F' ? 'Women' : g.g === 'M' ? 'Men' : 'Other', value: g.n }))} height={150} inner={42} />
          <div className="mt-1 flex justify-center gap-4 text-xs">{a.gender.map((g: any, i: number) => <span key={g.g} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i] }} />{g.g === 'F' ? 'Women' : g.g === 'M' ? 'Men' : 'Other'} · {g.n}</span>)}</div>
        </Card>
        <Card>
          <CardTitle action={<Link to="/audit" className="text-xs font-semibold text-brand">View all</Link>}>Recent activity</CardTitle>
          <ul className="space-y-2.5">{a.activity.map((x: any, i: number) => (
            <li key={i} className="flex gap-2.5 text-xs"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /><div className="min-w-0"><p className="truncate"><b className="font-semibold">{x.email ?? 'system'}</b> · {x.action.replace(/_/g, ' ')} {x.entity.replace(/_/g, ' ')}</p><p className="text-muted">{dateTime(x.at)}</p></div></li>
          ))}</ul>
        </Card>
      </Stagger>
    </>
  );
}

function Holidays({ list }: { list: any[] }) {
  return (
    <Card>
      <CardTitle>Upcoming holidays</CardTitle>
      {!list.length ? <p className="py-6 text-center text-sm text-muted">No holidays scheduled</p> :
        <ul className="space-y-2.5">{list.map((h, i) => (
          <motion.li key={h.date + h.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.06 }} className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-center leading-none text-brand-ink"><div><p className="text-[10px] font-bold uppercase">{new Date(h.date + 'T00:00').toLocaleString('en-IN', { month: 'short' })}</p><p className="text-base font-extrabold">{h.date.slice(8)}</p></div></div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{h.name}</p><p className="text-xs text-muted">{new Date(h.date + 'T00:00').toLocaleString('en-IN', { weekday: 'long' })}</p></div>
          </motion.li>))}
        </ul>}
    </Card>
  );
}

function MyDash({ d }: { d: any }) {
  const s = d.me.salary;
  const comps = s?.breakup?.components?.filter((c: any) => c.monthly > 0) ?? [];
  return (
    <Stagger className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" hover={false}>
        <CardTitle sub={s ? `Effective ${date(s.effectiveFrom)}` : undefined} action={<Link to="/profile" className="text-xs font-semibold text-brand">Details</Link>}>My salary</CardTitle>
        {!s ? <p className="py-8 text-center text-sm text-muted">Your salary structure hasn't been set up yet.</p> : (
          <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
            <div className="relative"><Donut data={comps.map((c: any) => ({ name: c.name, value: c.monthly }))} money height={200} />
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-[10px] font-semibold uppercase text-muted">Monthly gross</p><p className="text-lg font-extrabold">{inrShort(s.breakup.monthlyGross)}</p></div></div></div>
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between rounded-2xl bg-brand-soft p-4"><span className="text-sm font-semibold text-brand-ink">Annual CTC</span><span className="text-2xl font-extrabold text-brand-ink">{inr(s.annualCtc)}</span></div>
              {comps.map((c: any, i: number) => <div key={c.code} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i] }} />{c.name}</span><b>{inr(c.monthly)}</b></div>)}
              <div className="flex items-center justify-between border-t border-line pt-2.5 text-sm"><span className="text-muted">Est. take-home ({d.me.taxRegime} regime)</span><b className="text-ok">{inr(s.breakup.takeHome[d.me.taxRegime] ?? s.breakup.takeHome.new)}</b></div>
            </div>
          </div>)}
      </Card>
      <Card>
        <CardTitle action={<Link to="/payslips" className="text-xs font-semibold text-brand">All payslips</Link>}>{d.me.latestPayslip ? `${new Date(d.me.latestPayslip.month + '-01T00:00').toLocaleString('en-IN', { month: 'long', year: 'numeric' })} salary` : 'Latest payslip'}</CardTitle>
        {!d.me.latestPayslip ? <p className="py-8 text-center text-sm text-muted">Your payslip appears here once HR approves the month's salaries.</p> : (
          <div className="space-y-2.5 text-sm">
            {[['Earnings', d.me.latestPayslip.gross, ''], ['TDS', d.me.latestPayslip.tds, 'text-bad'], ['Total deductions', d.me.latestPayslip.deductions, 'text-bad']].map(([l, v, c], i) => (
              <motion.div key={l as string} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }} className="flex justify-between"><span className="text-muted">{l}</span><b className={c as string}>{inr(v as number)}</b></motion.div>))}
            <div className="gradient-brand mt-2 flex items-center justify-between rounded-2xl p-4 text-white"><span className="font-semibold">Net pay</span><span className="text-2xl font-extrabold"><CountUp value={Number(d.me.latestPayslip.net)} format={(x) => inr(x)} /></span></div>
          </div>)}
      </Card>
      <Holidays list={d.holidays} />
      <Card className="lg:col-span-2">
        <CardTitle>Quick actions</CardTitle>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          <QuickLink i={0} to="/payslips" icon={<Plane className="h-5 w-5" />} label="Payslips" />
          <QuickLink i={1} to="/tax" icon={<Calculator className="h-5 w-5" />} label="Compare regimes" />
          <QuickLink i={2} to="/profile" icon={<IdCard className="h-5 w-5" />} label="My profile" />
          <QuickLink i={3} to="/tax" icon={<CalendarHeart className="h-5 w-5" />} label="Tax deductions" />
        </div>
      </Card>
    </Stagger>
  );
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const { data: d, isLoading, error } = useQuery<any>({ queryKey: ['dashboard'], queryFn: () => get('/dashboard') });
  const name = me?.employee?.firstName ?? me?.email.split('@')[0] ?? '';
  if (error) return <Card className="text-center"><AlertTriangle className="mx-auto mb-2 h-8 w-8 text-bad" /><p className="text-sm">Couldn't load the dashboard. {(error as Error).message}</p></Card>;
  if (isLoading || !d) return (
    <div className="space-y-4"><Skeleton className="h-44 rounded-3xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><div className="grid gap-4 xl:grid-cols-5"><Skeleton className="h-72 xl:col-span-3" /><Skeleton className="h-72 xl:col-span-2" /></div></div>
  );
  return (
    <Stagger>
      <Hero d={d} name={name} />
      {d.admin && can('COMPANY_ADMIN', 'PAYROLL_MANAGER') && <AdminDash a={d.admin} d={d} />}
      {d.team && !d.admin && (
        <Stagger className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Team size" value={d.team.size} icon={<Users className="h-5 w-5" />} />
          <Stat label="Attendance entered" value={d.team.attendanceEntered} tone="ok" icon={<CalendarCheck className="h-5 w-5" />} hint={<>of {d.team.size} this month · <Link to="/attendance" className="font-semibold text-brand">enter →</Link></>} />
          <Stat label="Still to enter" value={Math.max(0, d.team.size - d.team.attendanceEntered)} tone="warn" icon={<PartyPopper className="h-5 w-5" />} hint="before the payroll cut-off" />
        </Stagger>
      )}
      {d.me && !d.admin && <MyDash d={d} />}
    </Stagger>
  );
}
