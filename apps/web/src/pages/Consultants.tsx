import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, Briefcase, Calculator, ChevronLeft, ChevronRight, FileSpreadsheet, FileUp, Pencil, Plus, RotateCcw, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, CardTitle, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Stagger, Stat, Switch, Tabs } from '../components/ui';
import { ApiError, download, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, inr, inrShort } from '../lib/format';
import { useAct } from '../lib/hooks';
import { monthLabel, runLabel, runTone } from './Payroll';

const shift = (m: string, by: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);
const lastMonth = () => shift(new Date().toISOString().slice(0, 7), -1);
const RATES: [number, string][] = [[0.1, '10% — professional fees'], [0.02, '2% — technical services'], [0.01, '1% — contract (individual)'], [0, '0% — no TDS']];

function ConsultantForm({ c, open, onClose }: { c?: any; open: boolean; onClose: () => void }) {
  const blank = { name: '', code: '', email: '', pan: '', account: '', ifsc: '', monthlyFee: '', tdsRate: 0.1, startDate: new Date().toISOString().slice(0, 10), endDate: '', active: true };
  const [v, setV] = useState<any>(blank);
  useEffect(() => setV(c ? { ...blank, ...c, pan: '', account: '', ifsc: '', monthlyFee: String(c.monthlyFee), endDate: c.endDate ?? '', code: c.code ?? '', email: c.email ?? '' } : blank), [c, open]);
  const save = useAct(() => {
    const body: any = { name: v.name, code: v.code || null, email: v.email || null, monthlyFee: Number(v.monthlyFee), tdsRate: Number(v.tdsRate), startDate: v.startDate, endDate: v.endDate || null, active: v.active };
    if (v.pan) body.pan = v.pan;
    if (v.account && v.ifsc) body.bank = { account: v.account, ifsc: v.ifsc };
    return c ? put(`/consultants/${c.id}`, body) : post('/consultants', body);
  }, { success: c ? 'Consultant updated' : 'Consultant added', invalidate: [['consultants'], ['consultant-run']], onDone: onClose });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={c ? `Edit ${c.name}` : 'Add consultant'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!v.name || !Number(v.monthlyFee)} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (as in the attendance sheet)"><Input value={v.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Code (optional)"><Input value={v.code} onChange={set('code')} /></Field>
        <Field label="Monthly fee (₹)"><Input inputMode="numeric" value={v.monthlyFee} onChange={(e) => setV({ ...v, monthlyFee: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 60000" /></Field>
        <Field label="TDS"><Select value={v.tdsRate} onChange={set('tdsRate')}>{RATES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</Select></Field>
        <Field label="PAN" hint={c?.hasPan ? `Saved: XXXXXX${c.panLast4} — leave blank to keep` : 'Without PAN, TDS is 20%'}><Input value={v.pan} onChange={(e) => setV({ ...v, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" /></Field>
        <Field label="Email (optional)"><Input value={v.email} onChange={set('email')} /></Field>
        <Field label="Bank account number" hint={c?.hasBank ? `Saved: XXXXXX${c.bankLast4} — leave blank to keep` : undefined}><Input inputMode="numeric" value={v.account} onChange={(e) => setV({ ...v, account: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="IFSC"><Input value={v.ifsc} onChange={(e) => setV({ ...v, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" /></Field>
        <Field label="Start date"><Input type="date" value={v.startDate} onChange={set('startDate')} /></Field>
        <Field label="End date (optional)"><Input type="date" value={v.endDate} onChange={set('endDate')} /></Field>
        {c && <div className="sm:col-span-2"><Switch checked={v.active} onChange={(x) => setV({ ...v, active: x })} label="Active (included in monthly payments)" /></div>}
      </div>
    </Modal>
  );
}

function ConsultantList() {
  const { data } = useQuery<any[]>({ queryKey: ['consultants'], queryFn: () => get('/consultants') });
  const [edit, setEdit] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between border-b border-line p-4"><CardTitle sub="Fixed monthly fee · TDS on professional fees · no PF, ESI or PT">All consultants</CardTitle><Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add consultant</Button></div>
      <div className="p-2 sm:p-3">
        {!data ? <Skeleton className="h-40" /> : (
          <DataTable rows={data} keyOf={(c: any) => c.id} onRow={(c: any) => setEdit(c)}
            empty={<EmptyState icon={<Briefcase className="h-7 w-7" />} title="No consultants yet" sub="Add each consultant with their monthly fee, PAN and bank account." />}
            cols={[
              { h: 'Consultant', cell: (c: any) => <div><p className="font-semibold">{c.name}</p><p className="text-xs text-muted">{c.code ?? ''}{c.email ? ` · ${c.email}` : ''}</p></div> },
              { h: 'Monthly fee', className: 'text-right', cell: (c: any) => <b className="tabular-nums">{inr(c.monthlyFee)}</b> },
              { h: 'TDS', cell: (c: any) => <Badge tone="brand">{c.hasPan ? `${Math.round(c.tdsRate * 100)}%` : '20% (no PAN)'}</Badge> },
              { h: 'PAN / bank', cell: (c: any) => <span className="text-xs text-muted">{c.hasPan ? `PAN ••${c.panLast4}` : 'No PAN'} · {c.hasBank ? `A/c ••${c.bankLast4}` : <span className="text-bad">no bank</span>}</span>, hideOnMobile: true },
              { h: 'Since', cell: (c: any) => <span className="text-xs">{date(c.startDate)}{c.endDate ? ` → ${date(c.endDate)}` : ''}</span>, hideOnMobile: true },
              { h: '', cell: (c: any) => c.active ? <Pencil className="h-4 w-4 text-muted" /> : <Badge>inactive</Badge> },
            ]} />)}
      </div>
      <ConsultantForm open={adding || !!edit} c={edit} onClose={() => { setAdding(false); setEdit(null); }} />
    </Card>
  );
}

function MonthlyPayment() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(lastMonth);
  const { data, isLoading } = useQuery<any>({ queryKey: ['consultant-run', month], queryFn: () => get(`/consultant-runs/${month}`) });
  const [inp, setInp] = useState<Record<string, { lopDays: number; adjustment: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setInp({}), [month, data?.run?.calculatedAt]);
  const run = data?.run, locked = run?.status === 'FINALISED';
  const val = (i: any) => inp[i.id] ?? { lopDays: i.lopDays, adjustment: i.adjustment };
  const dirty = Object.keys(inp).length > 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ['consultant-run', month] });

  const calculate = async () => {
    setBusy('calc');
    try {
      const r = await post(`/consultant-runs/${month}/calculate`, { items: data.items.map((i: any) => ({ consultantId: i.id, ...val(i) })) });
      toast.success(`Calculated ${r.totals.consultants} payments`); await refresh();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Calculation failed'); } finally { setBusy(null); }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy('upload');
    try {
      const b64 = btoa(new Uint8Array(await f.arrayBuffer()).reduce((a, b) => a + String.fromCharCode(b), ''));
      const r = await post(`/consultant-runs/${month}/import`, { fileBase64: b64 });
      const next = { ...inp };
      for (const x of r.found) { const i = data.items.find((y: any) => y.id === x.consultantId); next[x.consultantId] = { ...val(i), lopDays: x.lopDays }; }
      setInp(next);
      toast.success(`LOP read for ${r.found.length} consultant(s) — click Calculate`);
      if (r.notInSheet.length) toast(`Not in the sheet: ${r.notInSheet.join(', ')}`, { icon: '⚠️' });
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not read the sheet'); } finally { setBusy(null); }
  };
  const approve = useAct(() => post(`/consultant-runs/${month}/approve`), { success: 'Consultant payments approved', invalidate: [['consultant-run', month]] });
  const reopen = useAct(() => post(`/consultant-runs/${month}/reopen`), { success: 'Reopened for changes', invalidate: [['consultant-run', month]] });
  const t = run?.totals;
  const num = (i: any, k: 'lopDays' | 'adjustment', step: number) => (
    <Input type="number" step={step} min={k === 'lopDays' ? 0 : undefined} disabled={locked} value={val(i)[k] || ''} placeholder="0"
      onChange={(e) => setInp({ ...inp, [i.id]: { ...val(i), [k]: Number(e.target.value) || 0 } })}
      className={clsx('!px-2 !py-1.5 w-24 text-right', inp[i.id] && 'border-brand/60 bg-brand-soft/40')} />
  );
  return (
    <>
      <Card hover={false} className="mb-5 flex flex-wrap items-center justify-between gap-3 py-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <AnimatePresence mode="wait"><motion.span key={month} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="min-w-[150px] text-center text-lg font-bold">{monthLabel(month)}</motion.span></AnimatePresence>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          {run && <Badge tone={runTone[run.status]}>{runLabel[run.status]}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!locked && <label className={clsx('inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand/40 hover:bg-brand-soft', busy === 'upload' && 'pointer-events-none opacity-60')}><FileUp className="h-4 w-4" />Upload attendance sheet<input type="file" accept=".xlsx" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>}
          {!locked && <Button icon={<Calculator className="h-4 w-4" />} loading={busy === 'calc'} disabled={!data?.items?.length} onClick={calculate}>{run ? 'Recalculate' : 'Calculate'}</Button>}
          {run?.status === 'CALCULATED' && !dirty && can('COMPANY_ADMIN') && <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} loading={approve.isPending} onClick={() => window.confirm(`Approve consultant payments for ${monthLabel(month)}?`) && approve.mutate()}>Approve</Button>}
          {locked && <Button icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'excel'} onClick={async () => { setBusy('excel'); try { await download(`/consultant-runs/${month}/export.xlsx`, `consultants-${month}.xlsx`); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Download failed'); } finally { setBusy(null); } }}>Download payment sheet</Button>}
          {locked && can('COMPANY_ADMIN') && <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => window.confirm('Reopen this month?') && reopen.mutate()}>Reopen</Button>}
        </div>
      </Card>
      {t && (
        <Stagger className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Stat label="Consultants" value={t.consultants} icon={<Users className="h-5 w-5" />} />
          <Stat label="Total fees" value={t.amount} format={inrShort} tone="info" icon={<Wallet className="h-5 w-5" />} />
          <Stat label="TDS" value={t.tds} format={inrShort} tone="warn" icon={<Calculator className="h-5 w-5" />} hint="deposit by the 7th" />
          <Stat label="Net payable" value={t.net} format={inrShort} tone="ok" icon={<Wallet className="h-5 w-5" />} hint="to bank" />
        </Stagger>
      )}
      <Card hover={false} className="p-2 sm:p-3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {isLoading ? <Skeleton className="h-60" /> : (
          <DataTable rows={data.items} keyOf={(i: any) => i.id}
            empty={<EmptyState icon={<Briefcase className="h-7 w-7" />} title="No active consultants this month" sub="Add consultants in the Consultants tab." />}
            cols={[
              { h: 'Consultant', cell: (i: any) => <div className="min-w-[140px]"><p className="font-semibold">{i.name}</p><p className="text-xs text-muted">{i.hasPan ? `TDS ${Math.round(i.tdsRate * 100)}%` : 'No PAN — TDS 20%'}{!i.hasBank && ' · no bank'}</p></div> },
              { h: 'Monthly fee', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{inr(i.monthlyFee)}</span> },
              { h: 'Days', className: 'text-center', cell: (i: any) => <span>{i.engagedDays}/{data.daysInMonth}</span>, hideOnMobile: true },
              { h: 'LOP days', cell: (i: any) => num(i, 'lopDays', 0.5) },
              { h: 'Adjustment ₹', cell: (i: any) => num(i, 'adjustment', 1), hideOnMobile: true },
              { h: 'Amount', className: 'text-right', cell: (i: any) => <span className="tabular-nums">{i.amount != null ? inr(i.amount) : '—'}</span> },
              { h: 'TDS', className: 'text-right', cell: (i: any) => <span className="tabular-nums text-bad">{i.tds != null ? inr(i.tds) : '—'}</span> },
              { h: 'Net payable', className: 'text-right', cell: (i: any) => <b className="tabular-nums text-ok">{i.net != null ? inr(i.net) : '—'}</b> },
            ]} />)}
        {dirty && <p className="p-3 text-xs text-brand">Changes not calculated yet — click {run ? 'Recalculate' : 'Calculate'}.</p>}
      </Card>
    </>
  );
}

/** Consultant payments: fixed monthly fee, cut for leave from the attendance sheet, TDS on professional fees, approve, then the payment sheet. */
export default function Consultants() {
  const [tab, setTab] = useState<'pay' | 'list'>('pay');
  return (
    <>
      <PageHeader title="Consultant payments" sub="Monthly fee − leave days − TDS = net payable · approve, then download the payment sheet" />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pay', label: 'Monthly payment', icon: <Wallet className="h-4 w-4" /> }, { id: 'list', label: 'Consultants', icon: <Briefcase className="h-4 w-4" /> }]} /></div>
      {tab === 'pay' ? <MonthlyPayment /> : <ConsultantList />}
    </>
  );
}
