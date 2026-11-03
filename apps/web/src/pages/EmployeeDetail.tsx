import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Briefcase, CalendarDays, Eye, EyeOff, History, IndianRupee, KeyRound, LogOut, Mail, MapPin, Pencil, Phone, RotateCcw, Save, ShieldAlert, TrendingUp, User, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Breakup from '../components/Breakup';
import { Avatar, Badge, Button, Card, CardTitle, DataTable, EmptyState, Field, Input, Item, Modal, Select, Skeleton, Stagger, statusTone, Switch, Tabs, useDebounced } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, inr, today } from '../lib/format';
import { useAct, useMasters } from '../lib/hooks';
import { RoleChecks } from './Users';
import type { Role } from '../lib/auth';

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
  useEffect(() => { if (open) setV({ firstName: e.firstName, lastName: e.lastName, mobile: e.mobile ?? '', departmentId: e.departmentId ?? '', designationId: e.designationId ?? '', branchId: e.branchId ?? '', taxRegime: e.taxRegime, metro: e.metro, uan: e.uan ?? '', dob: e.dob ?? '', employmentType: e.employmentType, pfDeduct: !e.pfOptOut, ptDeduct: !e.ptExempt }); }, [open, e]);
  const admin = can('COMPANY_ADMIN');
  const pay = { taxRegime: v.taxRegime, metro: v.metro, uan: v.uan || null, pfOptOut: !v.pfDeduct, ptExempt: !v.ptDeduct };
  const act = useAct(() => {
    const { pfDeduct: _p, ptDeduct: _t, ...rest } = v;
    return put(`/employees/${e.id}`, admin ? { ...rest, ...pay, departmentId: v.departmentId || null, designationId: v.designationId || null, branchId: v.branchId || null, mobile: v.mobile || null, dob: v.dob || null } : pay);
  }, { success: 'Saved', invalidate: [['employee', e.id], ['employees']], onDone: onClose });
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
          <Field label="Date of birth"><Input type="date" {...s('dob')} /></Field>
          <Field label="Employment type"><Select {...s('employmentType')}>{['permanent', 'probation', 'fixed-term', 'intern', 'contractor'].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        </>}
        <Field label="Tax regime"><Select {...s('taxRegime')}><option value="new">New</option><option value="old">Old</option></Select></Field>
        <Field label="UAN"><Input {...s('uan')} /></Field>
        <Field label="HRA city"><Select value={v.metro ? '1' : '0'} onChange={(x) => setV({ ...v, metro: x.target.value === '1' })}><option value="1">Metro (50%)</option><option value="0">Non-metro (40%)</option></Select></Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 rounded-xl bg-surface-2/60 p-3">
        <Switch checked={!!v.pfDeduct} onChange={(x) => setV({ ...v, pfDeduct: x })} label="Deduct PF" />
        <Switch checked={!!v.ptDeduct} onChange={(x) => setV({ ...v, ptDeduct: x })} label="Deduct professional tax" />
      </div>
      {v.employmentType === 'intern' && <p className="mt-2 text-xs text-muted">Interns are paid a stipend only — no PF, PT or TDS.</p>}
      {!admin && <p className="mt-3 text-xs text-muted">Payroll Managers can edit pay fields only.</p>}
    </Modal>
  );
}

function ReviseModal({ e, open, onClose }: { e: any; open: boolean; onClose: () => void }) {
  const [ctc, setCtc] = useState('');
  const [eff, setEff] = useState(today());
  const dctc = useDebounced(Number(ctc), 400);
  const { data: preview, error } = useQuery<any>({ queryKey: ['ctc-preview', dctc, e.metro, e.state, e.gender], queryFn: () => post('/ctc/preview', { monthlyGross: dctc, metro: !!e.metro, state: e.state ?? 'MH', gender: e.gender === 'F' ? 'F' : 'M' }), enabled: dctc >= 1000 });
  const act = useAct(() => post(`/employees/${e.id}/salary-revisions`, { monthlyGross: Number(ctc), effectiveFrom: eff }), { success: 'Salary revised', invalidate: [['structures', e.id], ['dashboard']], onDone: onClose });
  const intern = e.employmentType === 'intern';
  return (
    <Modal open={open} onClose={onClose} title="Revise salary" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!preview} loading={act.isPending} onClick={() => act.mutate()}>Save revision</Button></>}>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Field label={intern ? 'Monthly stipend (₹)' : 'New monthly gross (₹)'} hint={intern ? 'Interns get a stipend only — no breakup' : 'Split: Basic 50% · HRA 25% · LTA 10% · Special 15%'}><Input inputMode="numeric" autoFocus value={ctc} onChange={(x) => setCtc(x.target.value.replace(/\D/g, ''))} placeholder="e.g. 30000" /></Field>
        <Field label="Effective from" hint="Backdated revisions create arrears in the next payroll run"><Input type="date" value={eff} onChange={(x) => setEff(x.target.value)} /></Field>
      </div>
      {error ? <p className="text-sm text-bad">{(error as Error).message}</p> : preview ? <Breakup p={preview} intern={intern} compact /> : <p className="py-8 text-center text-sm text-muted">Enter the monthly gross to see the breakup</p>}
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

/** Admin-only Profile tab: edit personal, statutory and bank details, and the employee's login password. */
function ProfileTab({ e }: { e: any }) {
  const { data: secret } = useQuery<any>({ queryKey: ['sensitive', e.id], queryFn: () => get(`/employees/${e.id}/sensitive`), staleTime: 0, gcTime: 0 });
  const { data: login, refetch } = useQuery<any>({ queryKey: ['emp-login', e.id], queryFn: () => get(`/employees/${e.id}/login`) });
  const init = (): Record<string, any> => ({
    firstName: e.firstName ?? '', middleName: e.middleName ?? '', lastName: e.lastName ?? '', dob: e.dob ?? '', gender: e.gender ?? 'M', maritalStatus: e.maritalStatus ?? '',
    mobile: e.mobile ?? '', personalEmail: e.personalEmail ?? '', workEmail: e.workEmail ?? '',
    pan: secret?.pan ?? '', aadhaar: '', uan: e.uan ?? '', esiIp: e.esiIp ?? '',
    holder: secret?.bank?.holder ?? `${e.firstName} ${e.lastName}`, account: secret?.bank?.account ?? '', ifsc: secret?.bank?.ifsc ?? '', bankName: secret?.bank?.bankName ?? '',
  });
  const [v, setV] = useState<any>(init);
  useEffect(() => setV(init()), [secret, e]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pw, setPw] = useState({ next: '', again: '', mustChange: true });
  const [roles, setRoles] = useState<Role[] | null>(null);
  useEffect(() => { if (login?.roles) setRoles(login.roles); }, [login]);
  const saveRoles = useAct(() => put(`/users/${login.id}/roles`, { roles }), { success: 'Roles saved — they will sign in again', invalidate: [['users']], onDone: () => refetch() });
  const f = (k: string, label: string, props: any = {}) => <Field label={label}><Input value={v[k] ?? ''} onChange={(x) => setV({ ...v, [k]: props.upper ? x.target.value.toUpperCase() : x.target.value })} {...props} upper={undefined} /></Field>;

  const save = useAct(() => {
    const o = init(), body: any = {};
    for (const k of ['firstName', 'middleName', 'lastName', 'dob', 'gender', 'maritalStatus', 'mobile', 'personalEmail', 'workEmail', 'uan', 'esiIp'])
      if (v[k] !== o[k]) body[k] = v[k] === '' ? null : v[k];
    if (v.pan !== o.pan) body.pan = v.pan || null;
    if (v.aadhaar) body.aadhaar = v.aadhaar;
    if (['holder', 'account', 'ifsc', 'bankName'].some((k) => v[k] !== o[k])) body.bank = v.account ? { holder: v.holder, account: v.account, ifsc: v.ifsc, ...(v.bankName ? { bankName: v.bankName } : {}) } : null;
    if (!Object.keys(body).length) return Promise.resolve();
    return put(`/employees/${e.id}`, body);
  }, { success: 'Profile saved', invalidate: [['employee', e.id], ['employees'], ['sensitive', e.id]] });
  const setPassword = useAct((reset: boolean) => post(`/employees/${e.id}/login-password`, reset ? { resetToDefault: true } : { password: pw.next, mustChange: pw.mustChange }),
    { success: 'Login password updated', onDone: () => { setPw({ next: '', again: '', mustChange: true }); refetch(); } });
  const strong = pw.next.length >= 10 && /[a-z]/.test(pw.next) && /[A-Z]/.test(pw.next) && /\d/.test(pw.next);

  return (
    <Stagger className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card hover={false}>
        <CardTitle sub="Changes are saved to the employee record and logged in History">Edit profile</CardTitle>
        <p className="mb-2 mt-1 text-xs font-bold uppercase text-muted">Personal</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {f('firstName', 'First name')}{f('middleName', 'Middle name')}{f('lastName', 'Last name')}
          {f('dob', 'Date of birth', { type: 'date' })}
          <Field label="Gender"><Select value={v.gender} onChange={(x) => setV({ ...v, gender: x.target.value })}><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></Select></Field>
          {f('maritalStatus', 'Marital status')}
          {f('mobile', 'Mobile', { inputMode: 'tel' })}{f('personalEmail', 'Personal email', { type: 'email' })}{f('workEmail', 'Work email (login)', { type: 'email' })}
        </div>
        <p className="mb-2 mt-5 text-xs font-bold uppercase text-muted">Statutory</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {f('pan', 'PAN', { upper: true, placeholder: 'ABCDE1234F', className: 'font-mono' })}
          {f('aadhaar', `Aadhaar${e.aadhaar ? ` (now ${e.aadhaar})` : ''}`, { inputMode: 'numeric', placeholder: 'Leave blank to keep' })}
          {f('uan', 'UAN', { inputMode: 'numeric' })}{f('esiIp', 'ESI IP number', { inputMode: 'numeric' })}
        </div>
        <p className="mb-2 mt-5 text-xs font-bold uppercase text-muted">Bank</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {f('holder', 'Account holder')}{f('account', 'Account number', { inputMode: 'numeric', className: 'font-mono' })}{f('ifsc', 'IFSC', { upper: true, className: 'font-mono' })}{f('bankName', 'Bank name')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setV(init())}>Undo changes</Button>
          <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
        </div>
      </Card>
      <Card hover={false} className="h-fit">
        <CardTitle sub={login ? (login.exists ? login.email : `No login yet — setting a password creates one for ${login.email}`) : undefined}>Login & password</CardTitle>
        {login?.exists && <div className="mb-4 divide-y divide-line/70 text-sm">
          <Row l="Status" v={<Badge tone={login.active ? (login.locked ? 'amber' : 'green') : 'gray'}>{!login.active ? 'Deactivated' : login.locked ? 'Locked' : 'Active'}</Badge>} />
          <Row l="Last sign-in" v={login.lastLoginAt ? dateTime(login.lastLoginAt) : 'Never'} />
          <Row l="Own password set" v={login.mustChangePassword ? 'No — must change at next sign-in' : 'Yes'} />
        </div>}
        <div className="space-y-3">
          <Field label="New password" hint="10+ characters with upper, lower case and a number"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(x) => setPw({ ...pw, next: x.target.value })} /></Field>
          <Field label="New password again"><Input type="password" autoComplete="new-password" value={pw.again} onChange={(x) => setPw({ ...pw, again: x.target.value })} /></Field>
          {pw.again && pw.again !== pw.next && <p className="text-xs font-medium text-bad">The two passwords do not match</p>}
          <Switch checked={pw.mustChange} onChange={(x) => setPw({ ...pw, mustChange: x })} label="Ask them to choose their own at next sign-in" />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button icon={<KeyRound className="h-4 w-4" />} disabled={!strong || pw.next !== pw.again} loading={setPassword.isPending && setPassword.variables === false} onClick={() => setPassword.mutate(false)}>Set password</Button>
            <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={setPassword.isPending && setPassword.variables === true} onClick={() => window.confirm('Reset this login to the default password Valencia123?') && setPassword.mutate(true)}>Reset to Valencia123</Button>
          </div>
          <p className="text-xs text-muted">Changing the password signs the employee out everywhere. Every change is logged.</p>
        </div>
        {login?.exists && roles && <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs font-bold uppercase text-muted">Role</p>
          <RoleChecks value={roles} onChange={setRoles} />
          <Button className="mt-3" size="sm" disabled={!roles.length || JSON.stringify([...roles].sort()) === JSON.stringify([...login.roles].sort())} loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>Save role</Button>
        </div>}
      </Card>
    </Stagger>
  );
}

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'salary' | 'history' | 'profile'>('overview');
  const [modal, setModal] = useState<'edit' | 'revise' | 'exit' | null>(null);
  const { data: e, isLoading, error } = useQuery<any>({ queryKey: ['employee', id], queryFn: () => get(`/employees/${id}`) });
  const showPay = e && e.access !== 'manager';
  const { data: structures } = useQuery<any[]>({ queryKey: ['structures', id], queryFn: () => get(`/employees/${id}/salary-structures`), enabled: !!showPay && tab === 'salary' });
  const { data: history } = useQuery<any[]>({ queryKey: ['history', id], queryFn: () => get(`/employees/${id}/history`), enabled: tab === 'history' });

  if (error) return <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="Can't open this employee" sub={(error as Error).message} action={<Link to="/employees"><Button variant="secondary">Back</Button></Link>} />;
  if (isLoading || !e) return <div className="space-y-4"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-12 w-96" /><Skeleton className="h-80" /></div>;
  const name = `${e.firstName} ${e.lastName}`;
  const admin = can('COMPANY_ADMIN'), pm = can('PAYROLL_MANAGER');
  const tabs = [{ id: 'overview' as const, label: 'Overview', icon: <User className="h-4 w-4" /> }, ...(showPay ? [{ id: 'salary' as const, label: 'Salary', icon: <IndianRupee className="h-4 w-4" /> }] : []), ...(admin || pm ? [{ id: 'history' as const, label: 'History', icon: <History className="h-4 w-4" /> }] : []), ...(admin ? [{ id: 'profile' as const, label: 'Profile', icon: <UserCog className="h-4 w-4" /> }] : [])];
  const current = structures?.find((s) => !s.effectiveTo) ?? structures?.[0];

  return (
    <Stagger>
      <Link to="/employees" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />People</Link>
      <Item className="card relative mb-5 overflow-hidden p-6">
        <div className="gradient-brand absolute inset-x-0 top-0 h-14 opacity-90" />
        <div className="relative flex flex-col gap-4 pt-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <motion.div initial={{ scale: 0.5, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring' }} className="rounded-full ring-4 ring-surface"><Avatar name={name} size="lg" /></motion.div>
            <div className="pb-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-extrabold sm:text-2xl">{name}</h1><Badge tone={statusTone[e.status]} dot={e.status === 'NOTICE'}>{e.status.toLowerCase()}</Badge></div><p className="text-sm text-muted">{e.designation ?? '—'} · {e.code}</p></div>
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
                <Row l="UAN" v={e.uan} /><Row l="PF / PT" v={e.employmentType === 'intern' ? 'Not deducted (intern)' : `${e.pfOptOut ? 'No PF' : 'PF'} · ${e.ptExempt ? 'No PT' : 'PT'}`} /><Row l="Tax regime" v={<Badge tone="brand">{e.taxRegime}</Badge>} /><Row l="HRA city" v={e.metro ? 'Metro' : 'Non-metro'} /></div>
                <Sensitive id={id} /></Card>
            </> : <Card className="lg:col-span-2"><EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="Pay details are private" sub="Only HR, payroll and the employee can see salary, PAN and bank details." /></Card>}
          </Stagger>)}

        {tab === 'salary' && (
          <Stagger className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <Card hover={false}><CardTitle sub={current ? `Effective ${date(current.effectiveFrom)} · Annual CTC ${inr(current.annualCtc)}` : undefined}>Current structure</CardTitle>
              {!structures ? <Skeleton className="h-80" /> : current ? <Breakup p={current.breakup} intern={e.employmentType === 'intern'} /> : <EmptyState icon={<IndianRupee className="h-7 w-7" />} title="No salary structure yet" action={(admin || pm) && <Button onClick={() => setModal('revise')}>Set salary</Button>} />}</Card>
            <Card hover={false}><CardTitle>Revision history</CardTitle>
              <ol className="relative ml-2 space-y-5 border-l-2 border-line pl-5">{structures?.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-surface ${!s.effectiveTo ? 'bg-ok' : 'bg-line'}`} />
                  <p className="font-bold">{inr(s.annualCtc)}</p><p className="text-xs text-muted">{date(s.effectiveFrom)} → {s.effectiveTo ? date(s.effectiveTo) : 'now'}</p>
                  {structures[i + 1] && <p className="mt-1 text-xs font-semibold text-ok">+{(((Number(s.annualCtc) - Number(structures[i + 1].annualCtc)) / Number(structures[i + 1].annualCtc)) * 100).toFixed(1)}%</p>}
                </motion.li>))}</ol></Card>
          </Stagger>)}

        {tab === 'profile' && admin && <ProfileTab e={e} />}

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
