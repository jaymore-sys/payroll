import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Briefcase, CalendarDays, Eye, EyeOff, History, IndianRupee, LogOut, Mail, MapPin, Pencil, Phone, ShieldAlert, TrendingUp, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Breakup from '../components/Breakup';
import { Avatar, Badge, Button, Card, CardTitle, DataTable, EmptyState, Field, Input, Item, Modal, Select, Skeleton, Stagger, statusTone, Tabs, useDebounced } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, inr, today } from '../lib/format';
import { useAct, useMasters } from '../lib/hooks';

const Row = ({ l, v }: { l: string; v: React.ReactNode }) => <div className="flex items-center justify-between gap-4 py-2 text-sm"><span className="text-muted">{l}</span><span className="text-right font-medium">{v ?? '—'}</span></div>;

function Sensitive({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (!data) return; const t = setTimeout(() => setData(null), 30_000); return () => clearTimeout(t); }, [data]);
  const reveal = useAct(() => get(`/employees/${id}/sensitive`), { onDone: setData });
  return data ? (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-warn">Visible for 30 seconds · this view was logged</p><button onClick={() => setData(null)} className="text-muted" aria-label="Hide"><EyeOff className="h-4 w-4" /></button></div>
      <Row l="PAN" v={<span className="font-mono">{data.pan ?? '—'}</span>} />
      {data.bank && <><Row l="Account" v={<span className="font-mono">{data.bank.account}</span>} /><Row l="IFSC" v={<span className="font-mono">{data.bank.ifsc}</span>} /><Row l="Holder" v={data.bank.holder} /></>}
    </motion.div>
  ) : <Button size="sm" variant="secondary" className="mt-3" icon={<Eye className="h-3.5 w-3.5" />} loading={reveal.isPending} onClick={() => reveal.mutate()}>Reveal PAN & bank</Button>;
}

function EditModal({ e, open, onClose }: { e: any; open: boolean; onClose: () => void }) {
  const m = useMasters();
  const { can } = useAuth();
  const [v, setV] = useState<any>({});
  useEffect(() => { if (open) setV({ firstName: e.firstName, lastName: e.lastName, mobile: e.mobile ?? '', departmentId: e.departmentId ?? '', designationId: e.designationId ?? '', branchId: e.branchId ?? '', taxRegime: e.taxRegime, metro: e.metro, uan: e.uan ?? '' }); }, [open, e]);
  const admin = can('COMPANY_ADMIN');
  const act = useAct(() => put(`/employees/${e.id}`, admin ? { ...v, departmentId: v.departmentId || null, designationId: v.designationId || null, branchId: v.branchId || null, mobile: v.mobile || null, uan: v.uan || null } : { taxRegime: v.taxRegime, metro: v.metro, uan: v.uan || null }), { success: 'Saved', invalidate: [['employee', e.id], ['employees']], onDone: onClose });
  const s = (k: string) => ({ value: v[k] ?? '', onChange: (x: any) => setV({ ...v, [k]: x.target.value }) });
  return (
    <Modal open={open} onClose={onClose} title="Edit employee" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={act.isPending} onClick={() => act.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {admin && <>
          <Field label="First name"><Input {...s('firstName')} /></Field><Field label="Last name"><Input {...s('lastName')} /></Field>
          <Field label="Mobile"><Input {...s('mobile')} /></Field>
          <Field label="Department"><Select {...s('departmentId')}><option value="">—</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Designation"><Select {...s('designationId')}><option value="">—</option>{m.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Branch"><Select {...s('branchId')}><option value="">—</option>{m.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </>}
        <Field label="Tax regime"><Select {...s('taxRegime')}><option value="new">New</option><option value="old">Old</option></Select></Field>
        <Field label="UAN"><Input {...s('uan')} /></Field>
        <Field label="HRA city"><Select value={v.metro ? '1' : '0'} onChange={(x) => setV({ ...v, metro: x.target.value === '1' })}><option value="1">Metro (50%)</option><option value="0">Non-metro (40%)</option></Select></Field>
      </div>
      {!admin && <p className="mt-3 text-xs text-muted">Payroll Managers can edit pay fields only.</p>}
    </Modal>
  );
}

function ReviseModal({ e, open, onClose }: { e: any; open: boolean; onClose: () => void }) {
  const [ctc, setCtc] = useState('');
  const [eff, setEff] = useState(today());
  const dctc = useDebounced(Number(ctc), 400);
  const { data: preview, error } = useQuery<any>({ queryKey: ['ctc-preview', dctc, e.metro, e.state, e.gender], queryFn: () => post('/ctc/preview', { annualCtc: dctc, metro: !!e.metro, state: e.state ?? 'MH', gender: e.gender === 'F' ? 'F' : 'M' }), enabled: dctc > 50000 });
  const act = useAct(() => post(`/employees/${e.id}/salary-revisions`, { annualCtc: Number(ctc), effectiveFrom: eff }), { success: 'Salary revised', invalidate: [['structures', e.id], ['dashboard']], onDone: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Revise salary" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!preview} loading={act.isPending} onClick={() => act.mutate()}>Save revision</Button></>}>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Field label="New annual CTC (₹)"><Input inputMode="numeric" autoFocus value={ctc} onChange={(x) => setCtc(x.target.value.replace(/\D/g, ''))} placeholder="e.g. 1200000" /></Field>
        <Field label="Effective from" hint="Backdated revisions create arrears in the next payroll run"><Input type="date" value={eff} onChange={(x) => setEff(x.target.value)} /></Field>
      </div>
      {error ? <p className="text-sm text-bad">{(error as Error).message}</p> : preview ? <Breakup p={preview} compact /> : <p className="py-8 text-center text-sm text-muted">Enter a CTC to see the live breakup</p>}
    </Modal>
  );
}

function ExitModal({ e, open, onClose }: { e: any; open: boolean; onClose: () => void }) {
  const [lwd, setLwd] = useState(today());
  const [reason, setReason] = useState('');
  const act = useAct(() => post(`/employees/${e.id}/exit`, { lastWorkingDay: lwd, reason }), { success: 'Exit recorded', invalidate: [['employee', e.id], ['employees'], ['dashboard']], onDone: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Record exit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={reason.length < 3} loading={act.isPending} onClick={() => act.mutate()}>Confirm exit</Button></>}>
      <div className="space-y-4">
        <Field label="Last working day"><Input type="date" value={lwd} onChange={(x) => setLwd(x.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Resignation, better opportunity…" /></Field>
        <p className="text-xs text-muted">Full & final settlement runs in the payroll module (phase 7).</p>
      </div>
    </Modal>
  );
}

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'salary' | 'history'>('overview');
  const [modal, setModal] = useState<'edit' | 'revise' | 'exit' | null>(null);
  const { data: e, isLoading, error } = useQuery<any>({ queryKey: ['employee', id], queryFn: () => get(`/employees/${id}`) });
  const showPay = e && e.access !== 'manager';
  const { data: structures } = useQuery<any[]>({ queryKey: ['structures', id], queryFn: () => get(`/employees/${id}/salary-structures`), enabled: !!showPay && tab === 'salary' });
  const { data: history } = useQuery<any[]>({ queryKey: ['history', id], queryFn: () => get(`/employees/${id}/history`), enabled: tab === 'history' });

  if (error) return <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="Can't open this employee" sub={(error as Error).message} action={<Link to="/employees"><Button variant="secondary">Back</Button></Link>} />;
  if (isLoading || !e) return <div className="space-y-4"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-12 w-96" /><Skeleton className="h-80" /></div>;
  const name = `${e.firstName} ${e.lastName}`;
  const admin = can('COMPANY_ADMIN'), pm = can('PAYROLL_MANAGER');
  const tabs = [{ id: 'overview' as const, label: 'Overview', icon: <User className="h-4 w-4" /> }, ...(showPay ? [{ id: 'salary' as const, label: 'Salary', icon: <IndianRupee className="h-4 w-4" /> }] : []), ...(admin || pm ? [{ id: 'history' as const, label: 'History', icon: <History className="h-4 w-4" /> }] : [])];
  const current = structures?.find((s) => !s.effectiveTo) ?? structures?.[0];

  return (
    <Stagger>
      <Link to="/employees" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />People</Link>
      <Item className="card relative mb-5 overflow-hidden p-6">
        <div className="gradient-brand absolute inset-x-0 top-0 h-20 opacity-90" />
        <div className="relative flex flex-col gap-4 pt-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <motion.div initial={{ scale: 0.5, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring' }} className="rounded-full ring-4 ring-surface"><Avatar name={name} size="lg" /></motion.div>
            <div className="pb-1"><h1 className="text-xl font-extrabold sm:text-2xl">{name}</h1><p className="text-sm text-muted">{e.designation ?? '—'} · {e.code}</p></div>
            <Badge tone={statusTone[e.status]} className="mb-2" dot={e.status === 'NOTICE'}>{e.status.toLowerCase()}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {(admin || pm) && <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal('edit')}>Edit</Button>}
            {(admin || pm) && <Button size="sm" icon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setModal('revise')}>Revise salary</Button>}
            {admin && ['ACTIVE', 'NOTICE'].includes(e.status) && <Button size="sm" variant="ghost" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setModal('exit')}>Exit</Button>}
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />{e.workEmail}</span>
          {e.mobile && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{e.mobile}</span>}
          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{e.branch ?? '—'}</span>
          <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{e.department ?? '—'}</span>
        </div>
      </Item>

      <Item className="mb-5"><Tabs tabs={tabs} value={tab} onChange={setTab} /></Item>

      <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {tab === 'overview' && (
          <Stagger className="grid gap-4 lg:grid-cols-3">
            <Card><CardTitle>Job</CardTitle><div className="divide-y divide-line/70">
              <Row l="Date of joining" v={date(e.doj)} /><Row l="Employment type" v={e.employmentType} /><Row l="Reporting manager" v={e.managerName} /><Row l="Notice period" v={e.noticeDays != null ? `${e.noticeDays} days` : undefined} />
              {e.lastWorkingDay && <Row l="Last working day" v={date(e.lastWorkingDay)} />}</div></Card>
            {showPay ? <>
              <Card><CardTitle>Personal</CardTitle><div className="divide-y divide-line/70"><Row l="Date of birth" v={date(e.dob)} /><Row l="Gender" v={{ M: 'Male', F: 'Female', O: 'Other' }[e.gender as string]} /><Row l="Personal email" v={e.personalEmail} /><Row l="Marital status" v={e.maritalStatus} /></div></Card>
              <Card><CardTitle sub="Encrypted at rest; masked by default">Statutory & bank</CardTitle><div className="divide-y divide-line/70">
                <Row l="PAN" v={<span className="font-mono">{e.pan ?? 'Missing'}</span>} /><Row l="Bank account" v={<span className="font-mono">{e.bank ?? 'Missing'}</span>} /><Row l="Aadhaar" v={<span className="font-mono">{e.aadhaar}</span>} />
                <Row l="UAN" v={e.uan} /><Row l="Tax regime" v={<Badge tone="brand">{e.taxRegime}</Badge>} /><Row l="HRA city" v={e.metro ? 'Metro' : 'Non-metro'} /></div>
                <Sensitive id={id} /></Card>
            </> : <Card className="lg:col-span-2"><EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="Pay details are private" sub="Only HR, payroll and the employee can see salary, PAN and bank details." /></Card>}
          </Stagger>)}

        {tab === 'salary' && (
          <Stagger className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <Card hover={false}><CardTitle sub={current ? `Effective ${date(current.effectiveFrom)} · Annual CTC ${inr(current.annualCtc)}` : undefined}>Current structure</CardTitle>
              {!structures ? <Skeleton className="h-80" /> : current ? <Breakup p={current.breakup} /> : <EmptyState icon={<IndianRupee className="h-7 w-7" />} title="No salary structure yet" action={(admin || pm) && <Button onClick={() => setModal('revise')}>Set salary</Button>} />}</Card>
            <Card hover={false}><CardTitle>Revision history</CardTitle>
              <ol className="relative ml-2 space-y-5 border-l-2 border-line pl-5">{structures?.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-surface ${!s.effectiveTo ? 'bg-ok' : 'bg-line'}`} />
                  <p className="font-bold">{inr(s.annualCtc)}</p><p className="text-xs text-muted">{date(s.effectiveFrom)} → {s.effectiveTo ? date(s.effectiveTo) : 'now'}</p>
                  {structures[i + 1] && <p className="mt-1 text-xs font-semibold text-ok">+{(((Number(s.annualCtc) - Number(structures[i + 1].annualCtc)) / Number(structures[i + 1].annualCtc)) * 100).toFixed(1)}%</p>}
                </motion.li>))}</ol></Card>
          </Stagger>)}

        {tab === 'history' && (
          <Stagger><Card hover={false}><CardTitle sub="Every change, who made it and when">Audit history</CardTitle>
            <ol className="space-y-3">{(history ?? []).map((h, i) => (
              <motion.li key={h.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-3 rounded-xl bg-surface-2/60 p-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" /><div className="min-w-0 flex-1"><p className="font-semibold capitalize">{h.action.replace(/_/g, ' ')}</p>
                  {h.after && <p className="truncate text-xs text-muted">{JSON.stringify(h.after).slice(0, 160)}</p>}</div><span className="shrink-0 text-xs text-muted">{dateTime(h.at)}</span>
              </motion.li>))}</ol></Card></Stagger>)}
      </motion.div>

      <EditModal e={e} open={modal === 'edit'} onClose={() => setModal(null)} />
      <ReviseModal e={e} open={modal === 'revise'} onClose={() => setModal(null)} />
      <ExitModal e={e} open={modal === 'exit'} onClose={() => setModal(null)} />
    </Stagger>
  );
}
