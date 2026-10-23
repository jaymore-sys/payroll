import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheck2, CheckCheck, ChevronLeft, ChevronRight, Download, FileUp, Lock, Save, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Skeleton, Stagger, Stat } from '../components/ui';
import { ApiError, download, get, post, put } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAct } from '../lib/hooks';
import { monthLabel } from './Payroll';

type Rec = { presentDays: number; paidLeaveDays: number; lopDays: number; overtimeHours: number; note?: string | null };
const shift = (m: string, by: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1)); return d.toISOString().slice(0, 7); };

function ImportModal({ month, open, onClose }: { month: string; open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [report, setReport] = useState<any>(null);
  const qc = useQueryClient();
  const run = useAct((dryRun: boolean) => post('/attendance/import', { month, fileBase64: file!.b64, dryRun }), {
    onDone: (r) => { setReport(r); if (!r.dryRun) { toast.success(`Attendance saved for ${r.saved} employees`); qc.invalidateQueries({ queryKey: ['attendance', month] }); onClose(); } },
  });
  const pick = async (f?: File) => {
    if (!f) return;
    if (f.size > 2e6) return toast.error('File too large (max 2 MB)');
    const b64 = btoa(new Uint8Array(await f.arrayBuffer()).reduce((s, b) => s + String.fromCharCode(b), ''));
    setFile({ name: f.name, b64 }); setReport(null);
  };
  return (
    <Modal open={open} onClose={() => { onClose(); setFile(null); setReport(null); }} title={`Upload attendance · ${monthLabel(month)}`} wide
      footer={<><Button variant="secondary" disabled={!file} loading={run.isPending && run.variables} onClick={() => run.mutate(true)}>Check file</Button><Button disabled={!report?.dryRun || report.errorCount > 0} loading={run.isPending && !run.variables} onClick={() => run.mutate(false)}>Save {report?.valid ?? ''} rows</Button></>}>
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li><button className="font-semibold text-brand" onClick={() => download(`/attendance/export.xlsx?month=${month}`, `attendance-${month}.xlsx`)}>Download this month's sheet</button> (or export from your leave software with the same columns).</li>
          <li>Fill <b>presentDays</b>, <b>paidLeaveDays</b>, <b>lopDays</b> (and optionally overtimeHours) per employee code.</li>
          <li>Upload it here. Nothing is saved until you click Save.</li>
        </ol>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-brand/50 hover:bg-brand-soft/40">
          <FileUp className="h-8 w-8 text-brand" /><span className="text-sm font-semibold">{file ? file.name : 'Choose the .xlsx file'}</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {report && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={clsx('rounded-2xl p-4 text-sm', report.errorCount ? 'bg-bad/10' : 'bg-ok/10')}>
            <p className="font-bold">{report.errorCount ? `${report.errorCount} row(s) need fixing` : `All ${report.valid} rows look good`}</p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{report.report.map((r: any) => <li key={r.row}><b>Row {r.row + 1}:</b> {r.errors.join('; ')}</li>)}</ul>
          </motion.div>)}
      </div>
    </Modal>
  );
}

export default function Attendance() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [edits, setEdits] = useState<Record<string, Rec>>({});
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any>({ queryKey: ['attendance', month], queryFn: () => get(`/attendance?month=${month}`) });
  useEffect(() => setEdits({}), [month, data?.items?.length]);

  const items = useMemo(() => (data?.items ?? []).filter((i: any) => !q || `${i.name} ${i.code} ${i.department}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const cur = (i: any): Rec | null => edits[i.employeeId] ?? i.record;
  const setVal = (i: any, k: keyof Rec, v: number) => setEdits((e) => {
    const base: Rec = e[i.employeeId] ?? i.record ?? { presentDays: i.workingDays, paidLeaveDays: 0, lopDays: 0, overtimeHours: 0 };
    return { ...e, [i.employeeId]: { ...base, [k]: v } }; // LOP is entered by hand, never derived
  });
  const markAllPresent = () => setEdits((e) => {
    const n = { ...e };
    for (const i of items) if (i.editable && !i.record && !e[i.employeeId]) n[i.employeeId] = { presentDays: i.workingDays, paidLeaveDays: 0, lopDays: 0, overtimeHours: 0 };
    return n;
  });
  const save = useAct(() => put('/attendance', { month, items: Object.entries(edits).map(([employeeId, r]) => ({ employeeId, ...r })) }), {
    success: 'Attendance saved', onDone: () => { setEdits({}); qc.invalidateQueries({ queryKey: ['attendance', month] }); },
  });

  const dirty = Object.keys(edits).length;
  const all = data?.items ?? [];
  const entered = all.filter((i: any) => i.record).length;
  const lopTotal = all.reduce((a: number, i: any) => a + (i.record?.lopDays ?? 0), 0);
  const editableCount = all.filter((i: any) => i.editable).length;
  const num = (i: any, k: keyof Rec, step = 0.5) => (
    <Input type="number" min={0} step={step} disabled={!i.editable} value={cur(i)?.[k] ?? ''} placeholder="—" onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(i, k, Math.max(0, Number(e.target.value) || 0))}
      className={clsx('!px-2 !py-1.5 w-20 text-right', edits[i.employeeId] && 'border-brand/60 bg-brand-soft/40', k === 'lopDays' && (cur(i)?.lopDays ?? 0) > 0 && 'text-bad font-bold')} />
  );

  return (
    <>
      <PageHeader title="Attendance" sub="Record each employee's month: present days, paid leave and loss-of-pay. Payroll uses the LOP."
        actions={<>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(`/attendance/export.xlsx?month=${month}`, `attendance-${month}.xlsx`).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Download failed'))}>Excel</Button>
          {!data?.locked && editableCount > 0 && <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => setImporting(true)}>Upload</Button>}
          {dirty > 0 && <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save {dirty}</Button>}
        </>} />

      <Card hover={false} className="mb-5 flex flex-wrap items-center justify-between gap-3 py-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <AnimatePresence mode="wait"><motion.span key={month} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="min-w-[150px] text-center text-lg font-bold">{monthLabel(month)}</motion.span></AnimatePresence>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          {data?.locked ? <Badge tone="green"><Lock className="h-3 w-3" />Payroll finalised — locked</Badge> : <Badge tone={entered === all.length && all.length ? 'green' : 'amber'}>{entered} of {all.length} entered</Badge>}
          {!data?.locked && editableCount > 0 && <Button size="sm" variant="secondary" icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={markAllPresent}>Mark the rest fully present</Button>}
        </div>
      </Card>

      {data && (
        <Stagger className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Employees" value={all.length} icon={<Users className="h-5 w-5" />} hint={`${editableCount} you can edit`} />
          <Stat label="Entered" value={entered} tone="ok" icon={<CalendarCheck2 className="h-5 w-5" />} hint={`${all.length - entered} pending`} />
          <Stat label="LOP days" value={lopTotal} tone="bad" icon={<CalendarCheck2 className="h-5 w-5" />} hint="reduce salary" />
          <Stat label="Days in month" value={data.daysInMonth} tone="info" icon={<CalendarCheck2 className="h-5 w-5" />} hint="working days exclude offs & holidays" />
        </Stagger>
      )}

      <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="border-b border-line p-4"><div className="relative sm:w-80"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee" className="pl-10" /></div></div>
        <div className="p-2 sm:p-3">
          {isLoading ? <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : (
            <DataTable rows={items} keyOf={(i: any) => i.employeeId}
              empty={<EmptyState icon={<Users className="h-7 w-7" />} title="No employees here" sub="Managers see their team; HR sees everyone on the rolls this month." />}
              cols={[
                { h: 'Employee', cell: (i: any) => <div className="min-w-[150px]"><p className="font-semibold">{i.name}</p><p className="text-xs text-muted">{i.code} · {i.department ?? '—'}</p></div> },
                { h: 'Working days', className: 'text-center', cell: (i: any) => <b>{i.workingDays}</b> },
                { h: 'Present', cell: (i: any) => num(i, 'presentDays') },
                { h: 'Paid leave', cell: (i: any) => num(i, 'paidLeaveDays') },
                { h: 'LOP', cell: (i: any) => num(i, 'lopDays') },
                { h: 'Overtime hrs', cell: (i: any) => num(i, 'overtimeHours', 1), hideOnMobile: true },
                { h: 'Status', cell: (i: any) => edits[i.employeeId] ? <Badge tone="brand">unsaved</Badge> : i.record ? <span className="text-xs text-muted" title={dateTime(i.record.updatedAt)}><Badge tone="green">entered</Badge></span> : <Badge tone="amber">pending</Badge>, hideOnMobile: true },
              ]} />)}
        </div>
      </Card>
      <ImportModal month={month} open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
