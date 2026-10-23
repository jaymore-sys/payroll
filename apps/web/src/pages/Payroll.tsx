import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Banknote, CalendarPlus, ChevronRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Stagger, type Tone } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTime, inr, inrShort } from '../lib/format';
import { useAct } from '../lib/hooks';

export const runTone: Record<string, Tone> = { DRAFT: 'gray', CALCULATED: 'blue', FINALISED: 'green' };
export const runLabel: Record<string, string> = { DRAFT: 'not calculated', CALCULATED: 'awaiting approval', FINALISED: 'approved' };
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

export default function Payroll() {
  const nav = useNavigate();
  const { data } = useQuery<any[]>({ queryKey: ['payroll-runs'], queryFn: () => get('/payroll-runs') });
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const create = useAct(() => post('/payroll-runs', { month }), { success: 'Payroll run created', invalidate: [['payroll-runs']], onDone: (r) => nav(`/payroll/${r.id}`) });
  const existing = data?.find((r) => r.month === month);
  return (
    <>
      <PageHeader title="Run payroll" sub="1. Upload the attendance sheet  2. Check each employee’s salary and tax  3. Approve and download the salary sheet"
        actions={<Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>New payroll run</Button>} />
      {!data ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : !data.length ? (
        <Card hover={false}><EmptyState icon={<Banknote className="h-7 w-7" />} title="No payroll runs yet" sub="Start with this month: we'll pull everyone with a salary structure and calculate PF, ESI, PT, TDS and net pay." action={<Button onClick={() => setOpen(true)}>Run this month's payroll</Button>} /></Card>
      ) : (
        <Stagger className="space-y-3">
          {data.map((r) => (
            <motion.button key={r.id} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} whileHover={{ y: -2 }} onClick={() => nav(`/payroll/${r.id}`)}
              className="card flex w-full flex-col gap-3 p-5 text-left transition-colors hover:border-brand/40 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-4">
                <div className="gradient-brand grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white">{r.status === 'FINALISED' ? <Lock className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}</div>
                <div><p className="text-lg font-bold">{monthLabel(r.month)}</p><p className="text-xs text-muted">{r.finalisedAt ? `Approved ${dateTime(r.finalisedAt)}` : r.calculatedAt ? `Calculated ${dateTime(r.calculatedAt)}` : 'Not calculated yet'}</p></div>
              </div>
              {r.totals && <div className="grid grid-cols-3 gap-4 text-sm sm:w-[420px]">
                <div><p className="text-xs text-muted">Employees</p><p className="font-bold">{r.totals.employees}</p></div>
                <div><p className="text-xs text-muted">Net pay</p><p className="font-bold">{inrShort(r.totals.net)}</p></div>
                <div><p className="text-xs text-muted">Cost</p><p className="font-bold">{inrShort(r.totals.gross + r.totals.employerCost)}</p></div>
              </div>}
              <div className="flex items-center gap-3"><Badge tone={runTone[r.status]}>{runLabel[r.status]}</Badge><ChevronRight className="h-5 w-5 text-muted" /></div>
            </motion.button>
          ))}
        </Stagger>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New payroll run"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>{existing ? <Button onClick={() => nav(`/payroll/${existing.id}`)}>Open existing run</Button> : <Button loading={create.isPending} onClick={() => create.mutate()}>Create run</Button>}</>}>
        <Field label="Salary month" hint={existing ? `A run for ${monthLabel(month)} already exists.` : 'Everyone on the rolls with a salary structure is included. Approved unpaid leave becomes LOP.'}>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        {existing?.totals && <p className="mt-3 text-sm text-muted">Net pay in that run: <b>{inr(existing.totals.net)}</b></p>}
      </Modal>
    </>
  );
}
