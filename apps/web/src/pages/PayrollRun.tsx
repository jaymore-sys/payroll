import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Calculator, CalendarCheck2, CircleAlert, Download, FileSpreadsheet, PauseCircle, Save, Search, Trash2, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, CardTitle, DataTable, Input, Modal, Skeleton, Stagger, Stat } from '../components/ui';
import { ApiError, del, download, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, inrShort } from '../lib/format';
import { useAct } from '../lib/hooks';
import { monthLabel, runTone } from './Payroll';

type Inputs = { lopDays: number; bonus: number; otherEarnings: number; otherDeductions: number; hold: boolean; note?: string | null };
function SlipModal({ item, onClose }: { item: any; onClose: () => void }) {
  const { data } = useQuery<any>({ queryKey: ['payslip', item?.payslip?.id], queryFn: () => get(`/payslips/${item.payslip.id}`), enabled: !!item?.payslip?.id });
  const p = data?.payslip;
  return (
    <Modal open={!!item} onClose={onClose} wide title={item ? `${item.name} · ${item.code}` : ''}>
      {!p ? <Skeleton className="h-72" /> : <PayslipBody p={p} />}
    </Modal>
  );
}

export function PayslipBody({ p }: { p: any }) {
  const sec = (s: string) => p.lines.filter((l: any) => l.section === s);
  const Col = ({ title, rows, total, tone }: { title: string; rows: any[]; total?: number; tone?: string }) => (
    <div className="rounded-2xl bg-surface-2/60 p-4">
      <p className="mb-2 text-xs font-bold uppercase text-muted">{title}</p>
      {rows.map((l, i) => <motion.div key={l.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex justify-between py-1 text-sm"><span title={l.ruleId}>{l.label}</span><span className="tabular-nums">{inr(l.amount)}</span></motion.div>)}
      {total !== undefined && <div className={clsx('mt-2 flex justify-between border-t border-line pt-2 text-sm font-bold', tone)}><span>Total</span><span>{inr(total)}</span></div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['Payable days', `${p.payableDays} / ${p.daysInMonth}`], ['LOP days', p.lopDays], ['Regime', p.tax.regime]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-surface-2 p-3"><p className="text-[11px] font-semibold uppercase text-muted">{l}</p><p className="font-bold capitalize">{v}</p></div>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Col title="Earnings" rows={sec('earning')} total={p.gross} />
        <Col title="Deductions" rows={sec('deduction')} total={p.deductions.total} tone="text-bad" />
      </div>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="gradient-brand flex items-center justify-between rounded-2xl p-5 text-white">
        <span className="font-semibold">Net pay</span><span className="text-3xl font-extrabold">{inr(p.net)}</span>
      </motion.div>
      <div className="grid gap-3 md:grid-cols-2">
        <Col title="Employer contributions" rows={sec('employer')} total={p.employer.total} />
        <div className="rounded-2xl bg-surface-2/60 p-4 text-sm">
          <p className="mb-2 text-xs font-bold uppercase text-muted">How TDS was calculated</p>
          <div className="flex justify-between py-1"><span>Projected taxable income</span><b>{inr(p.tax.projectedTaxable)}</b></div>
          <div className="flex justify-between py-1"><span>Tax for the year</span><b>{inr(p.tax.annualTax)}</b></div>
          <div className="flex justify-between py-1"><span>Already deducted this year</span><b>{inr(p.tax.paidSoFar)}</b></div>
          <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Deducted this month</span><span>{inr(p.tax.thisMonth)}</span></div>
        </div>
      </div>
      {p.notes?.length > 0 && <div className="rounded-xl bg-warn/10 p-3 text-sm text-warn">{p.notes.join(' · ')}</div>}
    </div>
  );
}

export default function PayrollRun() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<any>({ queryKey: ['payroll-run', id], queryFn: () => get(`/payroll-runs/${id}`) });
  const [edits, setEdits] = useState<Record<string, Inputs>>({});
  const [q, setQ] = useState('');
  const [slip, setSlip] = useState<any>(null);
  const [busy, setBusy] = useState<'calc' | 'excel' | null>(null);
  useEffect(() => setEdits({}), [data?.run?.calculatedAt]);

  const run = data?.run;
  const locked = run?.status === 'FINALISED';
  const dirty = Object.keys(edits).length;
  const items = useMemo(() => (data?.items ?? []).filter((i: any) => !q || `${i.name} ${i.code} ${i.department}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const val = (i: any): Inputs => edits[i.employeeId] ?? i.inputs;
  const set = (i: any, k: keyof Inputs, v: number | boolean) => setEdits((e) => ({ ...e, [i.employeeId]: { ...val(i), [k]: v } }));

  const save = async () => {
    if (!dirty) return;
    await put(`/payroll-runs/${id}/inputs`, { items: Object.entries(edits).map(([employeeId, v]) => ({ employeeId, ...v })) });
    setEdits({});
  };
  const calculate = async () => {
    setBusy('calc');
    try {
      await save();
      const [r] = await Promise.all([post(`/payroll-runs/${id}/calculate`), new Promise((ok) => setTimeout(ok, 900))]);
      await qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      r.errors.length ? toast.error(`${r.errors.length} employee(s) could not be calculated`) : toast.success(`Calculated ${r.totals.employees} payslips`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Calculation failed'); } finally { setBusy(null); }
  };
  const saveOnly = useAct(save, { success: 'Inputs saved — recalculate to update pay', invalidate: [['payroll-run', id]] });
  const remove = useAct(() => del(`/payroll-runs/${id}`), { success: 'Run deleted', invalidate: [['payroll-runs']], onDone: () => nav('/payroll') });
  const excel = async () => {
    setBusy('excel');
    try { await download(`/payroll-runs/${id}/export.xlsx`, `salary-${run.month}.xlsx`); toast.success('Salary sheet downloaded'); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Download failed'); } finally { setBusy(null); }
  };

  if (error) return <Card className="text-sm text-bad">{(error as Error).message}</Card>;
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  const t = run.totals;
  const num = (i: any, k: 'lopDays' | 'bonus' | 'otherEarnings' | 'otherDeductions', w = 'w-[84px]', step = 1) => (
    <Input type="number" min={0} step={step} disabled={locked} value={val(i)[k] || ''} placeholder="0" onClick={(e) => e.stopPropagation()}
      onChange={(e) => set(i, k, Math.max(0, Number(e.target.value) || 0))} className={clsx('!px-2 !py-1.5 text-right', w, edits[i.employeeId] && 'border-brand/60 bg-brand-soft/40')} />
  );

  return (
    <>
      <Link to="/payroll" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All runs</Link>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-2xl font-extrabold sm:text-3xl">{run.label}</h1><Badge tone={runTone[run.status]}>{run.status.toLowerCase()}</Badge></div>
          <p className="mt-1 text-sm text-muted">{data.items.length} employees · {locked ? 'locked — changes need a correction run' : 'edit LOP, bonus and deductions, then calculate'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('COMPANY_ADMIN') && !locked && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => window.confirm('Delete this payroll run?') && remove.mutate()}>Delete</Button>}
          {!locked && dirty > 0 && <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saveOnly.isPending} onClick={() => saveOnly.mutate()}>Save {dirty} change{dirty > 1 ? 's' : ''}</Button>}
          {!locked && <Button variant={run.status === 'CALCULATED' && !dirty ? 'secondary' : 'primary'} icon={<Calculator className="h-4 w-4" />} loading={busy === 'calc'} onClick={calculate}>{run.status === 'DRAFT' ? 'Calculate salaries' : 'Recalculate'}</Button>}
          {run.status !== 'DRAFT' && <Button icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'excel'} onClick={excel}>Download Excel</Button>}
        </div>
      </motion.div>

      <AnimatePresence>
        {busy === 'calc' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
            <div className="card p-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Calculator className="h-4 w-4 animate-pulse text-brand" />Calculating {data.items.length} payslips — proration, PF, ESI, PT, LWF and TDS…</p>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2"><motion.div className="gradient-brand h-full" initial={{ width: '5%' }} animate={{ width: '92%' }} transition={{ duration: 1.2, ease: 'easeOut' }} /></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {t && (
        <Stagger className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
          <Stat label="Employees" value={t.employees} icon={<Users className="h-5 w-5" />} hint={t.onHold ? `${t.onHold} on hold` : 'all payable'} />
          <Stat label="Gross" value={t.gross} format={inrShort} tone="info" icon={<Wallet className="h-5 w-5" />} />
          <Stat label="Deductions" value={t.deductions} format={inrShort} tone="warn" icon={<TrendingDown className="h-5 w-5" />} hint={`TDS ${inrShort(t.tds)}`} />
          <Stat label="Net pay" value={t.net} format={inrShort} tone="ok" icon={<Download className="h-5 w-5" />} hint="to bank" />
          <Stat label="Cost to company" value={t.gross + t.employerCost} format={inrShort} tone="bad" icon={<TrendingUp className="h-5 w-5" />} hint={`employer ${inrShort(t.employerCost)}`} />
        </Stagger>
      )}

      <Stagger className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {data.checklist.map((c: any) => (
          <motion.div key={c.key} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="card flex items-start gap-3 p-4">
            <span className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', { green: 'bg-ok', amber: 'bg-warn', red: 'bg-bad animate-pulse' }[c.level as string])} />
            <div className="min-w-0"><p className="text-2xl font-extrabold leading-none">{c.count}</p><p className="mt-1 text-xs text-muted">{c.label}</p>{c.names?.length > 0 && <p className="mt-1 truncate text-[11px] text-muted">{c.names.join(', ')}</p>}</div>
          </motion.div>
        ))}
      </Stagger>

      <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle sub="LOP with a ✓ comes from Attendance · click a row to see the payslip">Employees</CardTitle>
          <div className="relative sm:w-72"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-10" /></div>
        </div>
        <div className="p-2 sm:p-3">
          <DataTable rows={items} keyOf={(i: any) => i.employeeId} onRow={(i: any) => i.payslip && setSlip(i)}
            cols={[
              { h: 'Employee', cell: (i: any) => <div className="min-w-[160px]"><p className="flex items-center gap-1.5 font-semibold">{i.name}{!i.hasBank && <CircleAlert className="h-3.5 w-3.5 text-bad" aria-label="No bank details" />}{(i.joinedThisMonth || i.leavingThisMonth) && <Badge tone="blue">{i.joinedThisMonth ? 'joiner' : 'leaver'}</Badge>}</p><p className="text-xs text-muted">{i.code} · {i.department ?? '—'}</p></div> },
              { h: 'LOP days', cell: (i: any) => i.attendance
                  ? <span title={`From attendance: ${i.attendance.presentDays} present, ${i.attendance.paidLeaveDays} paid leave of ${i.attendance.workingDays} working days`} className={clsx('inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm font-semibold', i.attendance.lopDays > 0 && 'text-bad')}>{i.attendance.lopDays}<CalendarCheck2 className="h-3.5 w-3.5 text-ok" /></span>
                  : num(i, 'lopDays', 'w-16', 0.5) },
              { h: 'Bonus', cell: (i: any) => num(i, 'bonus') },
              { h: 'Other earnings', cell: (i: any) => num(i, 'otherEarnings'), hideOnMobile: true },
              { h: 'Other deductions', cell: (i: any) => num(i, 'otherDeductions'), hideOnMobile: true },
              { h: 'Hold', cell: (i: any) => <button disabled={locked} onClick={(e) => { e.stopPropagation(); set(i, 'hold', !val(i).hold); }} aria-label="Toggle hold" className={clsx('rounded-lg p-1.5', val(i).hold ? 'bg-warn/15 text-warn' : 'text-muted hover:bg-surface-2')}><PauseCircle className="h-4 w-4" /></button> },
              { h: 'Gross', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{i.payslip ? inr(i.payslip.gross) : '—'}</span> },
              { h: 'Deductions', className: 'text-right', cell: (i: any) => <span className="tabular-nums text-bad">{i.payslip ? inr(i.payslip.deductions) : '—'}</span>, hideOnMobile: true },
              { h: 'Net pay', className: 'text-right', cell: (i: any) => <b className="tabular-nums text-ok">{i.payslip ? inr(i.payslip.net) : '—'}</b> },
              { h: 'vs last month', className: 'text-right', cell: (i: any) => i.variance === null ? <span className="text-muted">—</span> : <Badge tone={Math.abs(i.variance) > 10 ? 'amber' : 'gray'}>{i.variance > 0 ? '+' : ''}{i.variance}%</Badge>, hideOnMobile: true },
            ]} />
        </div>
      </Card>

      <SlipModal item={slip} onClose={() => setSlip(null)} />
    </>
  );
}
