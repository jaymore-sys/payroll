import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, Calculator, CalendarCheck2, Check, CircleAlert, Download, FileSpreadsheet, FileUp, PauseCircle, RotateCcw, Save, Search, Trash2, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, CardTitle, DataTable, Input, Modal, Skeleton, Stagger, Stat } from '../components/ui';
import { ApiError, del, download, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, inrShort } from '../lib/format';
import { useAct } from '../lib/hooks';
import { monthLabel, runLabel, runTone } from './Payroll';

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

const STEPS = ['Upload attendance sheet', 'Calculate & review', 'Approve & download'];

function Stepper({ at, done, onPick }: { at: number; done: number; onPick: (i: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-2">
          <button disabled={i > done} onClick={() => onPick(i)} className="flex items-center gap-2 disabled:cursor-default">
            <motion.span initial={false} animate={{ scale: i === at ? 1.12 : 1 }} className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold', i < done || (i === 2 && done === 2) ? 'bg-ok text-white' : i === at ? 'gradient-brand text-white' : 'bg-surface-2 text-muted')}>
              {i < done || (i === 2 && done === 2) ? <Check className="h-4 w-4" /> : i + 1}
            </motion.span>
            <span className={clsx('hidden text-left text-xs font-semibold md:block', i === at ? 'text-ink' : 'text-muted')}>{s}</span>
          </button>
          {i < STEPS.length - 1 && <div className="h-0.5 flex-1 overflow-hidden rounded bg-surface-2"><motion.div className="h-full bg-ok" initial={false} animate={{ width: i < done ? '100%' : '0%' }} transition={{ duration: 0.6 }} /></div>}
        </div>
      ))}
    </div>
  );
}

/** Step 1: read the month's attendance sheet (working days, present, leave, LOP per employee). */
function UploadStep({ month, items, onDone }: { month: string; items: any[]; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const entered = items.filter((i) => i.attendance).length;
  const send = async (f: { b64: string }, dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await post('/attendance/import', { month, fileBase64: f.b64, dryRun });
      setReport(r);
      if (!dryRun) { toast.success(`Attendance read for ${r.saved} employees`); onDone(); }
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not read the file'); } finally { setBusy(false); }
  };
  const pick = async (f?: File) => {
    if (!f) return;
    if (f.size > 2e6) return toast.error('File too large (max 2 MB)');
    const b64 = btoa(new Uint8Array(await f.arrayBuffer()).reduce((acc, b) => acc + String.fromCharCode(b), ''));
    setFile({ name: f.name, b64 }); setReport(null); send({ b64 }, true);
  };
  const LABEL: Record<string, string> = { name: 'Employee', code: 'Employee code', workingDays: 'Working days', presentDays: 'Present', paidLeaveDays: 'Paid leave', lopDays: 'LOP', payableDays: 'Payable days', overtimeHours: 'Overtime', note: 'Note' };
  return (
    <Card hover={false} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <CardTitle sub="Your monthly attendance sheet: one column per employee with the day-by-day status and the totals at the bottom (Total working Days, No. of Leaves). Employees and Interns sheets are both read. A sheet with one row per employee code works too.">Upload this month's attendance sheet</CardTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-brand/50 hover:bg-brand-soft/40">
          <FileUp className="h-9 w-9 text-brand" /><span className="font-semibold">{file ? file.name : 'Choose your attendance sheet (.xlsx)'}</span>
          <span className="text-xs text-muted">Nothing is saved until you click Save</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <div className="space-y-2 rounded-2xl bg-surface-2/60 p-4 text-sm">
          <p><b>{entered}</b> of {items.length} employees already have attendance for this month.</p>
          <button className="font-semibold text-brand" onClick={() => download(`/attendance/export.xlsx?month=${month}`, `attendance-${month}.xlsx`)}>Download a blank template</button>
          {entered > 0 && <Button size="sm" variant="secondary" className="w-full" onClick={onDone}>Skip — use what's already entered</Button>}
        </div>
      </div>
      {busy && !report && <Skeleton className="mt-4 h-24" />}
      {report && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">{Object.entries(report.columns ?? {}).map(([k, h]) => <Badge key={k} tone="brand">{String(h)} → {LABEL[k] ?? k}</Badge>)}</div>
          {report.errorCount > 0 && <div className="rounded-2xl bg-bad/10 p-4 text-sm"><p className="font-bold text-bad">{report.errorCount} row(s) need fixing in the sheet</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{report.report.map((r: any) => <li key={r.row}><b>Row {r.row}:</b> {r.errors.join('; ')}</li>)}</ul></div>}
          {report.unmatched?.length > 0 && <div className="rounded-2xl bg-warn/10 p-4 text-sm text-warn"><b>{report.unmatched.length} name(s) in the sheet don't match anyone in People</b> — they are skipped. Add them in People with the same name, then upload again: {report.unmatched.slice(0, 10).join(', ')}{report.unmatched.length > 10 ? '…' : ''}</div>}
          {report.missing?.length > 0 && <div className="rounded-2xl bg-warn/10 p-4 text-sm text-warn"><b>{report.missing.length} employee(s) not in the sheet</b> (their LOP stays 0): {report.missing.slice(0, 8).join(', ')}{report.missing.length > 8 ? '…' : ''}</div>}
          {report.preview?.length > 0 && <DataTable rows={report.preview} keyOf={(r: any) => r.code} cols={[
            { h: 'Employee', cell: (r: any) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">{r.code}{r.sheetName && r.sheetName !== r.name ? ` · sheet: ${r.sheetName}` : ''}</p></div> },
            { h: 'Days', className: 'text-center', cell: (r: any) => r.workingDays },
            { h: 'Paid days', className: 'text-center', cell: (r: any) => <b>{r.presentDays + r.paidLeaveDays}</b> },
            { h: 'LOP', className: 'text-center', cell: (r: any) => <b className={r.lopDays > 0 ? 'text-bad' : ''}>{r.lopDays}</b> },
            { h: 'Note', cell: (r: any) => <span className="text-xs text-muted">{r.note ?? ''}</span>, hideOnMobile: true },
          ]} />}
          <div className="flex justify-end"><Button icon={<Calculator className="h-4 w-4" />} disabled={!file || report.errorCount > 0 || !report.valid} loading={busy} onClick={() => send(file!, false)}>Save {report.valid} rows & calculate salaries</Button></div>
        </motion.div>
      )}
    </Card>
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
  const [view, setView] = useState<number | null>(null);
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
  const approve = useAct(() => post(`/payroll-runs/${id}/approve`), { success: 'Salaries approved — download the salary sheet', invalidate: [['payroll-run', id], ['payroll-runs']], onDone: () => setView(null) });
  const reopen = useAct(() => post(`/payroll-runs/${id}/reopen`), { success: 'Run reopened for changes', invalidate: [['payroll-run', id], ['payroll-runs']] });
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
  const done = run.status === 'FINALISED' ? 2 : run.status === 'CALCULATED' ? 1 : 0;
  const step = view ?? done;
  const num = (i: any, k: 'lopDays' | 'bonus' | 'otherEarnings' | 'otherDeductions', w = 'w-[84px]', step = 1) => (
    <Input type="number" min={0} step={step} disabled={locked} value={val(i)[k] || ''} placeholder="0" onClick={(e) => e.stopPropagation()}
      onChange={(e) => set(i, k, Math.max(0, Number(e.target.value) || 0))} className={clsx('!px-2 !py-1.5 text-right', w, edits[i.employeeId] && 'border-brand/60 bg-brand-soft/40')} />
  );

  return (
    <>
      <Link to="/payroll" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All runs</Link>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-2xl font-extrabold sm:text-3xl">{run.label}</h1><Badge tone={runTone[run.status]}>{runLabel[run.status]}</Badge></div>
          <p className="mt-1 text-sm text-muted">{data.items.length} employees · {locked ? 'approved — reopen to make changes' : step === 0 ? 'upload the attendance sheet to start' : 'check each employee’s breakdown, then approve'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('COMPANY_ADMIN') && !locked && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => window.confirm('Delete this payroll run?') && remove.mutate()}>Delete</Button>}
          {step === 1 && !locked && dirty > 0 && <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saveOnly.isPending} onClick={() => saveOnly.mutate()}>Save {dirty} change{dirty > 1 ? 's' : ''}</Button>}
          {step === 1 && !locked && <Button variant="secondary" icon={<Calculator className="h-4 w-4" />} loading={busy === 'calc'} onClick={calculate}>Recalculate</Button>}
          {step === 1 && run.status === 'CALCULATED' && !dirty && can('COMPANY_ADMIN') && <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} loading={approve.isPending} onClick={() => window.confirm(`Approve salaries for ${run.label}? Employees will see their payslips and attendance is locked.`) && approve.mutate()}>Approve salaries</Button>}
          {locked && can('COMPANY_ADMIN') && <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} loading={reopen.isPending} onClick={() => window.confirm('Reopen this month to change it?') && reopen.mutate()}>Reopen</Button>}
        </div>
      </motion.div>

      <Card hover={false} className="mb-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Stepper at={step} done={done} onPick={(i) => setView(locked && i < 2 ? 2 : i)} /></Card>

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

      {step === 0 && !locked && <UploadStep month={run.month} items={data.items} onDone={async () => { setView(null); await calculate(); }} />}

      {step === 2 && t && (
        <Card hover={false} className="mb-5 flex flex-col items-center gap-4 py-10 text-center" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="grid h-16 w-16 place-items-center rounded-full bg-ok text-white"><BadgeCheck className="h-8 w-8" /></motion.div>
          <div><p className="text-xl font-extrabold">Salaries approved for {run.label}</p><p className="mt-1 text-sm text-muted">{t.employees} employees · net pay {inr(t.net)} · employees can now see their payslips</p></div>
          <Button size="lg" icon={<FileSpreadsheet className="h-5 w-5" />} loading={busy === 'excel'} onClick={excel}>Download salary sheet</Button>
          <p className="text-xs text-muted">Excel with salary register, bank transfer list and statutory dues (PF, ESI, PT, TDS)</p>
        </Card>
      )}

      {step > 0 && t && (
        <Stagger className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
          <Stat label="Employees" value={t.employees} icon={<Users className="h-5 w-5" />} hint={t.onHold ? `${t.onHold} on hold` : 'all payable'} />
          <Stat label="Gross" value={t.gross} format={inrShort} tone="info" icon={<Wallet className="h-5 w-5" />} />
          <Stat label="Deductions" value={t.deductions} format={inrShort} tone="warn" icon={<TrendingDown className="h-5 w-5" />} hint={`TDS ${inrShort(t.tds)}`} />
          <Stat label="Net pay" value={t.net} format={inrShort} tone="ok" icon={<Download className="h-5 w-5" />} hint="to bank" />
          <Stat label="Cost to company" value={t.gross + t.employerCost} format={inrShort} tone="bad" icon={<TrendingUp className="h-5 w-5" />} hint={`employer ${inrShort(t.employerCost)}`} />
        </Stagger>
      )}

      {step === 1 && <Stagger className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {data.checklist.map((c: any) => (
          <motion.div key={c.key} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="card flex items-start gap-3 p-4">
            <span className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', { green: 'bg-ok', amber: 'bg-warn', red: 'bg-bad animate-pulse' }[c.level as string])} />
            <div className="min-w-0"><p className="text-2xl font-extrabold leading-none">{c.count}</p><p className="mt-1 text-xs text-muted">{c.label}</p>{c.names?.length > 0 && <p className="mt-1 truncate text-[11px] text-muted">{c.names.join(', ')}</p>}</div>
          </motion.div>
        ))}
      </Stagger>}

      {step > 0 && <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle sub="Click an employee to see the full salary and tax breakdown · LOP with ✓ comes from the attendance sheet">Salary breakdown</CardTitle>
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
              { h: 'PF', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{i.payslip ? inr(i.payslip.deductionSplit?.pf ?? 0) : '—'}</span>, hideOnMobile: true },
              { h: 'PT', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{i.payslip ? inr(i.payslip.deductionSplit?.pt ?? 0) : '—'}</span>, hideOnMobile: true },
              { h: 'TDS', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{i.payslip ? inr(i.payslip.deductionSplit?.tds ?? 0) : '—'}</span>, hideOnMobile: true },
              { h: 'Deductions', className: 'text-right', cell: (i: any) => <span className="tabular-nums text-bad">{i.payslip ? inr(i.payslip.deductions) : '—'}</span>, hideOnMobile: true },
              { h: 'Net pay', className: 'text-right', cell: (i: any) => <b className="tabular-nums text-ok">{i.payslip ? inr(i.payslip.net) : '—'}</b> },
              { h: 'vs last month', className: 'text-right', cell: (i: any) => i.variance === null ? <span className="text-muted">—</span> : <Badge tone={Math.abs(i.variance) > 10 ? 'amber' : 'gray'}>{i.variance > 0 ? '+' : ''}{i.variance}%</Badge>, hideOnMobile: true },
            ]} />
        </div>
      </Card>}

      <SlipModal item={slip} onClose={() => setSlip(null)} />
    </>
  );
}
