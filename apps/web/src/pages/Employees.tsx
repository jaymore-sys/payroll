import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Copy, FileUp, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Avatar, Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, statusTone, Switch, useDebounced } from '../components/ui';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useAct, useMasters } from '../lib/hooks';

const schema = z.object({
  firstName: z.string().min(1, 'Required'), lastName: z.string().min(1, 'Required'), gender: z.enum(['M', 'F', 'O']),
  dob: z.string().optional(), workEmail: z.string().email('Enter a valid email'), mobile: z.string().regex(/^(\+?\d{10,13})?$/, 'Invalid mobile').optional(),
  doj: z.string().min(1, 'Required'), employmentType: z.enum(['permanent', 'probation', 'fixed-term', 'intern', 'contractor']),
  branchId: z.string().optional(), departmentId: z.string().optional(), designationId: z.string().optional(), managerId: z.string().optional(),
  pan: z.string().regex(/^([A-Z]{5}\d{4}[A-Z])?$/, 'Format: ABCDE1234F').optional(),
  account: z.string().regex(/^(\d{6,18})?$/, '6–18 digits').optional(), ifsc: z.string().regex(/^([A-Z]{4}0[A-Z0-9]{6})?$/, 'Format: HDFC0001234').optional(),
  uan: z.string().regex(/^(\d{12})?$/, '12 digits').optional(), taxRegime: z.enum(['new', 'old']), monthlyGross: z.string().regex(/^\d*$/).optional(),
});
type Form = z.infer<typeof schema>;
const STEPS = ['Personal', 'Job', 'Pay & statutory'];
const STEP_FIELDS: (keyof Form)[][] = [['firstName', 'lastName', 'gender', 'dob', 'workEmail', 'mobile'], ['doj', 'employmentType', 'branchId', 'departmentId', 'designationId', 'managerId'], ['pan', 'account', 'ifsc', 'uan', 'taxRegime', 'monthlyGross']];

function AddEmployee({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [createLogin, setCreateLogin] = useState(true);
  const [done, setDone] = useState<{ code: string; tempPassword?: string } | null>(null);
  const m = useMasters();
  const { data: mgrs } = useQuery<any>({ queryKey: ['employees', 'all-min'], queryFn: () => get('/employees?limit=200&sort=name'), enabled: open });
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { gender: 'M', employmentType: 'permanent', taxRegime: 'new', doj: new Date().toISOString().slice(0, 10) } });
  const e = f.formState.errors;
  const act = useAct((v: Form) => post('/employees', {
    firstName: v.firstName, lastName: v.lastName, gender: v.gender, dob: v.dob || null, workEmail: v.workEmail, mobile: v.mobile || null, doj: v.doj, employmentType: v.employmentType,
    branchId: v.branchId || null, departmentId: v.departmentId || null, designationId: v.designationId || null, managerId: v.managerId || null,
    pan: v.pan || null, uan: v.uan || null, taxRegime: v.taxRegime, createLogin, monthlyGross: v.monthlyGross ? Number(v.monthlyGross) : undefined,
    bank: v.account && v.ifsc ? { holder: `${v.firstName} ${v.lastName}`, account: v.account, ifsc: v.ifsc } : null,
  }), { success: 'Employee added', invalidate: [['employees'], ['dashboard']], onDone: (r) => setDone(r) });
  const close = () => { onClose(); setTimeout(() => { setStep(0); setDone(null); f.reset(); }, 300); };
  const next = async () => { if (await f.trigger(STEP_FIELDS[step])) { setDir(1); setStep(step + 1); } };
  const err = (k: keyof Form) => e[k]?.message as string | undefined;

  return (
    <Modal open={open} onClose={close} title={done ? 'Employee created' : 'Add employee'} wide footer={done ? <Button onClick={close}>Done</Button> : (
      <>
        {step > 0 && <Button variant="secondary" onClick={() => { setDir(-1); setStep(step - 1); }} icon={<ChevronLeft className="h-4 w-4" />}>Back</Button>}
        {step < 2 ? <Button onClick={next} icon={<ChevronRight className="h-4 w-4" />}>Next</Button> : <Button loading={act.isPending} onClick={f.handleSubmit((v) => act.mutate(v))} icon={<Check className="h-4 w-4" />}>Create employee</Button>}
      </>)}>
      {done ? (
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="py-4 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-ok"><Check className="h-8 w-8" /></motion.div>
          <p className="text-lg font-bold">Employee {done.code} created</p>
          {done.tempPassword && (
            <div className="mx-auto mt-4 max-w-sm rounded-2xl border border-warn/40 bg-warn/10 p-4 text-left">
              <p className="text-xs font-semibold text-warn">Temporary password — shown only once. Share it securely.</p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 font-mono text-sm"><span className="truncate">{done.tempPassword}</span>
                <button onClick={() => { navigator.clipboard.writeText(done.tempPassword!); toast.success('Copied'); }} className="text-muted hover:text-ink" aria-label="Copy"><Copy className="h-4 w-4" /></button></div>
            </div>)}
        </motion.div>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-2">
                <motion.span animate={{ scale: i === step ? 1.1 : 1 }} className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors', i < step ? 'bg-ok text-white' : i === step ? 'gradient-brand text-white' : 'bg-surface-2 text-muted')}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</motion.span>
                <span className={clsx('hidden text-xs font-semibold sm:block', i === step ? 'text-ink' : 'text-muted')}>{s}</span>
                {i < 2 && <div className="h-0.5 flex-1 overflow-hidden rounded bg-surface-2"><motion.div className="h-full bg-ok" animate={{ width: i < step ? '100%' : '0%' }} /></div>}
              </div>))}
          </div>
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }} transition={{ duration: 0.25 }} className="grid gap-4 sm:grid-cols-2">
              {step === 0 && <>
                <Field label="First name" error={err('firstName')}><Input {...f.register('firstName')} autoFocus /></Field>
                <Field label="Last name" error={err('lastName')}><Input {...f.register('lastName')} /></Field>
                <Field label="Gender"><Select {...f.register('gender')}><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></Select></Field>
                <Field label="Date of birth"><Input type="date" {...f.register('dob')} /></Field>
                <Field label="Work email" error={err('workEmail')} hint="Used as the login"><Input type="email" {...f.register('workEmail')} /></Field>
                <Field label="Mobile" error={err('mobile')}><Input inputMode="tel" {...f.register('mobile')} /></Field>
              </>}
              {step === 1 && <>
                <Field label="Date of joining" error={err('doj')}><Input type="date" {...f.register('doj')} /></Field>
                <Field label="Employment type"><Select {...f.register('employmentType')}>{['permanent', 'probation', 'fixed-term', 'intern', 'contractor'].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                <Field label="Branch"><Select {...f.register('branchId')}><option value="">—</option>{m.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.state})</option>)}</Select></Field>
                <Field label="Department"><Select {...f.register('departmentId')}><option value="">—</option>{m.departments.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Designation"><Select {...f.register('designationId')}><option value="">—</option>{m.designations.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                <Field label="Reporting manager"><Select {...f.register('managerId')}><option value="">—</option>{mgrs?.items.map((x: any) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName} ({x.code})</option>)}</Select></Field>
              </>}
              {step === 2 && <>
                <Field label="PAN" error={err('pan')} hint="Encrypted at rest"><Input {...f.register('pan', { setValueAs: (v) => v.toUpperCase() })} placeholder="ABCDE1234F" /></Field>
                <Field label="UAN" error={err('uan')}><Input inputMode="numeric" {...f.register('uan')} /></Field>
                <Field label="Bank account" error={err('account')}><Input inputMode="numeric" {...f.register('account')} /></Field>
                <Field label="IFSC" error={err('ifsc')}><Input {...f.register('ifsc', { setValueAs: (v) => v.toUpperCase() })} /></Field>
                <Field label="Tax regime"><Select {...f.register('taxRegime')}><option value="new">New (default)</option><option value="old">Old</option></Select></Field>
                <Field label="Monthly gross (₹)" error={err('monthlyGross')} hint="Split into Basic 50%, HRA 25%, LTA 10%, Special 15%"><Input inputMode="numeric" {...f.register('monthlyGross')} placeholder="e.g. 30000" /></Field>
                <div className="sm:col-span-2"><Switch checked={createLogin} onChange={setCreateLogin} label="Create portal login with a temporary password" /></div>
              </>}
            </motion.div>
          </AnimatePresence>
        </>)}
    </Modal>
  );
}

/** CSV import with a dry-run validation report before anything is saved (spec §4). */
function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [report, setReport] = useState<any>(null);
  const parseCsv = (text: string) => {
    // ponytail: simple CSV parser (quoted fields, no embedded newlines); swap for papaparse if HR uploads get messy.
    const lines = text.trim().split(/\r?\n/);
    const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()).slice(0, -1);
    const head = split(lines[0]);
    return lines.slice(1).filter(Boolean).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
  };
  const check = useAct((dryRun: boolean) => post('/employees/import', { rows, dryRun }), { invalidate: [['employees'], ['dashboard']], onDone: (r) => { setReport(r); if (!r.dryRun) toast.success(`${r.created} employees imported`); } });
  const template = 'code,firstName,lastName,workEmail,gender,doj,mobile,department,designation,branch,managerCode,pan,ifsc,accountNumber,monthlyGross\n,Asha,Verma,asha.verma@company.com,F,2026-11-01,9820012345,Engineering,Developer,Mumbai HQ,EMP0001,ABCDE1234F,HDFC0001234,50100123456,30000\n';
  return (
    <Modal open={open} onClose={() => { onClose(); setRows([]); setReport(null); }} title="Import employees" wide
      footer={<><Button variant="secondary" disabled={!rows.length} loading={check.isPending && check.variables} onClick={() => check.mutate(true)}>Validate</Button><Button disabled={!report?.dryRun || report.errorCount > 0} loading={check.isPending && !check.variables} onClick={() => check.mutate(false)}>Import {report?.valid ?? ''} rows</Button></>}>
      <div className="space-y-4">
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="employee-import-template.csv" className="text-sm font-semibold text-brand">Download CSV template</a>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-brand/50 hover:bg-brand-soft/40">
          <FileUp className="h-8 w-8 text-brand" /><span className="text-sm font-semibold">{rows.length ? `${rows.length} rows loaded` : 'Choose a CSV file'}</span><span className="text-xs text-muted">Max 2,000 rows · nothing is saved until you import</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2e6) return toast.error('File too large'); setRows(parseCsv(await file.text())); setReport(null); }} />
        </label>
        {report && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={clsx('rounded-2xl p-4', report.errorCount ? 'bg-bad/10' : 'bg-ok/10')}>
            <p className="text-sm font-bold">{report.dryRun ? (report.errorCount ? `${report.errorCount} row(s) have errors` : `All ${report.valid} rows look good`) : `Imported ${report.created} employees`}</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">{report.report.map((r: any) => <li key={r.row}><b>Row {r.row}:</b> {r.errors.join('; ')}</li>)}</ul>
          </motion.div>)}
      </div>
    </Modal>
  );
}

export default function Employees() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [pg, setPg] = useState(1);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const m = useMasters();
  useEffect(() => setPg(1), [dq, status, dept]);
  const { data, isLoading } = useQuery<any>({ queryKey: ['employees', dq, status, dept, pg], queryFn: () => get(`/employees?limit=20&page=${pg}&q=${encodeURIComponent(dq)}&status=${status}&departmentId=${dept}`), placeholderData: keepPreviousData });
  const admin = can('COMPANY_ADMIN');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <PageHeader title={can('COMPANY_ADMIN', 'PAYROLL_MANAGER') ? 'People' : 'My team'} sub={data ? `${data.total} employee${data.total === 1 ? '' : 's'}` : ' '}
        actions={admin && <><Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => setImporting(true)}>Import</Button><Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add employee</Button></>} />
      <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code or email" className="pl-10" /></div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40"><option value="">All statuses</option>{['ACTIVE', 'NOTICE', 'EXITED', 'ONBOARDING'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-48"><option value="">All departments</option>{m.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </div>
        <div className="p-2 sm:p-3">
          {isLoading ? <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div> : (
            <DataTable rows={data.items} keyOf={(r: any) => r.id} onRow={(r: any) => nav(`/employees/${r.id}`)}
              empty={<EmptyState icon={<Users className="h-7 w-7" />} title="No employees found" sub="Try a different search, or add your first employee." />}
              cols={[
                { h: 'Employee', cell: (r: any) => <div className="flex items-center gap-3"><Avatar name={`${r.firstName} ${r.lastName}`} size="sm" /><div className="min-w-0"><p className="truncate font-semibold">{r.firstName} {r.lastName}</p><p className="truncate text-xs text-muted">{r.code} · {r.workEmail}</p></div></div> },
                { h: 'Department', cell: (r: any) => <span>{r.department ?? '—'}</span> },
                { h: 'Designation', cell: (r: any) => <span className="text-muted">{r.designation ?? '—'}</span>, hideOnMobile: true },
                { h: 'Location', className: 'whitespace-nowrap', cell: (r: any) => <span className="text-muted">{r.branch ?? '—'}</span>, hideOnMobile: true },
                { h: 'Joined', className: 'whitespace-nowrap', cell: (r: any) => date(r.doj), hideOnMobile: true },
                { h: 'Status', cell: (r: any) => <Badge tone={statusTone[r.status]} dot={r.status === 'NOTICE'}>{r.status.toLowerCase()}</Badge> },
              ]} />)}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">Page {pg} of {pages}</span>
            <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={pg <= 1} onClick={() => setPg(pg - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={pg >= pages} onClick={() => setPg(pg + 1)}>Next</Button></div>
          </div>)}
      </Card>
      {admin && <AddEmployee open={adding} onClose={() => { setAdding(false); if (sp.get('new')) setSp({}); }} />}
      {admin && <ImportModal open={importing} onClose={() => setImporting(false)} />}
    </>
  );
}
