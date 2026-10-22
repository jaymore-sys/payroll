import { encashmentAmount, upfrontProration, yearEnd } from '@payrollpro/engines';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CalendarPlus, Plane, Users } from 'lucide-react';
import { useState } from 'react';
import { PALETTE } from '../components/charts';
import { Badge, Button, Card, CardTitle, DataTable, EmptyState, Field, Input, Item, Modal, PageHeader, Ring, Select, Skeleton, Stagger, statusTone, Switch, Tabs, useDebounced } from '../components/ui';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateShort, inr, today } from '../lib/format';
import { useAct } from '../lib/hooks';

function ApplyModal({ open, onClose, balances }: { open: boolean; onClose: () => void; balances: any[] }) {
  const [v, setV] = useState({ leaveTypeId: '', from: today(), to: today(), halfDayFrom: false, halfDayTo: false, reason: '' });
  const type = v.leaveTypeId || balances[0]?.leaveTypeId;
  const dv = useDebounced({ ...v, leaveTypeId: type }, 300);
  const { data: calc, isFetching } = useQuery<any>({ queryKey: ['leave-calc', dv], queryFn: () => post('/leave/calculate', dv), enabled: open && !!dv.leaveTypeId && dv.to >= dv.from });
  const act = useAct(() => post('/leave/requests', { ...v, leaveTypeId: type }), { success: 'Leave applied — your manager has been notified', invalidate: [['leave-requests'], ['balances'], ['dashboard']], onDone: onClose });
  const set = (k: string, x: unknown) => setV({ ...v, [k]: x });
  const sel = balances.find((b) => b.leaveTypeId === type);
  return (
    <Modal open={open} onClose={onClose} title="Apply for leave" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!calc || calc.errors.length > 0} loading={act.isPending} onClick={() => act.mutate()}>Submit request</Button></>}>
      <div className="space-y-4">
        <Field label="Leave type"><Select value={type} onChange={(e) => set('leaveTypeId', e.target.value)}>{balances.map((b) => <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.name} {b.paid ? `(${b.balance - b.pending} available)` : ''}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} /></Field>
          <Field label="To"><Input type="date" min={v.from} value={v.to} onChange={(e) => set('to', e.target.value)} /></Field>
        </div>
        {sel?.halfDay && <div className="flex flex-wrap gap-4"><Switch checked={v.halfDayFrom} onChange={(x) => set('halfDayFrom', x)} label="Half day on first day" />{v.to !== v.from && <Switch checked={v.halfDayTo} onChange={(x) => set('halfDayTo', x)} label="Half day on last day" />}</div>}
        <Field label="Reason"><Input value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Optional" maxLength={500} /></Field>
        <AnimatePresence mode="wait">
          {calc && (
            <motion.div key={JSON.stringify(calc)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: isFetching ? 0.6 : 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl bg-surface-2 p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[11px] font-semibold uppercase text-muted">Calendar</p><p className="text-xl font-extrabold">{calc.calendarDays}</p></div>
                <div><p className="text-[11px] font-semibold uppercase text-muted">Offs / holidays</p><p className="text-xl font-extrabold">{calc.offsExcluded}</p></div>
                <div><p className="text-[11px] font-semibold uppercase text-muted">Counted</p><p className="text-xl font-extrabold text-brand">{calc.counted}</p></div>
              </div>
              {calc.balanceAfter !== null && <p className="mt-3 text-center text-sm">Balance <b>{calc.available}</b> → <b className={calc.balanceAfter < 0 ? 'text-bad' : 'text-ok'}>{calc.balanceAfter}</b></p>}
              {calc.teamOff.length > 0 && <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-warn"><Users className="h-3.5 w-3.5" />{calc.teamOff.map((t: any) => t.name).join(', ')} also off</p>}
              {calc.errors.map((er: string) => <p key={er} className="mt-2 flex items-center gap-1.5 text-sm text-bad"><AlertCircle className="h-4 w-4" />{er}</p>)}
            </motion.div>)}
        </AnimatePresence>
      </div>
    </Modal>
  );
}

/** Pure leave calculator (runs the engine in the browser — no data leaves the page). */
function Calculator() {
  const [quota, setQuota] = useState(18), [join, setJoin] = useState(today()), [start, setStart] = useState(1);
  const [bal, setBal] = useState(12), [carry, setCarry] = useState(30), [encashCap, setEncashCap] = useState(10), [basic, setBasic] = useState(30000), [divisor, setDivisor] = useState<26 | 30>(26);
  const credit = upfrontProration(quota, join, start);
  const ye = yearEnd(bal, carry, true, encashCap);
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value) || 0);
  return (
    <Stagger className="grid gap-4 lg:grid-cols-2">
      <Card><CardTitle sub="Upfront credit for a mid-year joiner">Joiner proration</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Annual quota"><Input type="number" value={quota} onChange={num(setQuota)} /></Field><Field label="Joining date"><Input type="date" value={join} onChange={(e) => setJoin(e.target.value)} /></Field>
          <Field label="Leave year"><Select value={start} onChange={(e) => setStart(Number(e.target.value))}><option value={1}>Jan–Dec</option><option value={4}>Apr–Mar</option></Select></Field></div>
        <motion.div key={credit} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-4 rounded-2xl bg-brand-soft p-4 text-center"><p className="text-xs font-semibold text-brand-ink">Credit on joining</p><p className="text-3xl font-extrabold text-brand-ink">{credit} days</p><p className="mt-1 text-xs text-muted">Joining month counts if joined on or before the 15th · rounded to 0.5</p></motion.div></Card>
      <Card><CardTitle sub="Carry forward, encash, lapse">Year-end & encashment</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Balance"><Input type="number" value={bal} onChange={num(setBal)} /></Field><Field label="Carry cap"><Input type="number" value={carry} onChange={num(setCarry)} /></Field><Field label="Encash cap"><Input type="number" value={encashCap} onChange={num(setEncashCap)} /></Field>
          <Field label="Basic + DA / month"><Input type="number" value={basic} onChange={num(setBasic)} /></Field><Field label="Divisor"><Select value={divisor} onChange={(e) => setDivisor(Number(e.target.value) as 26 | 30)}><option value={26}>26</option><option value={30}>30</option></Select></Field></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">{([['Carried', ye.carry, 'text-ok'], ['Encashed', ye.encash, 'text-brand'], ['Lapsed', ye.lapse, 'text-bad']] as const).map(([l, x, c]) => <motion.div key={l + x} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="rounded-xl bg-surface-2 p-3"><p className="text-[11px] font-semibold uppercase text-muted">{l}</p><p className={clsx('text-2xl font-extrabold', c)}>{x}</p></motion.div>)}</div>
        <p className="mt-3 text-center text-sm">Encashment payout <b>{inr(encashmentAmount(basic, divisor, ye.encash))}</b> <span className="text-muted">(taxable in that month)</span></p></Card>
    </Stagger>
  );
}

export default function Leave() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'mine' | 'calc'>('mine');
  const [applying, setApplying] = useState(false);
  const { data: bal } = useQuery<any[]>({ queryKey: ['balances', 'me'], queryFn: () => get('/leave/balances'), enabled: !!me?.employeeId });
  const { data: reqs } = useQuery<any[]>({ queryKey: ['leave-requests', 'mine'], queryFn: () => get('/leave/requests?scope=mine'), enabled: !!me?.employeeId });
  const cancel = useAct((id: string) => post(`/leave/requests/${id}/cancel`), { success: 'Leave cancelled', invalidate: [['leave-requests'], ['balances']] });
  const applicable = (bal ?? []).filter((b) => b.paid ? b.balance > 0 || b.quota > 0 : true);
  return (
    <>
      <PageHeader title="Leave" sub="Balances, requests and the leave calculator" actions={me?.employeeId && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setApplying(true)} disabled={!bal}>Apply leave</Button>} />
      <div className="mb-5"><Tabs tabs={[{ id: 'mine', label: 'My leave' }, { id: 'calc', label: 'Leave calculator' }]} value={tab} onChange={setTab} /></div>
      {tab === 'calc' ? <Calculator /> : !me?.employeeId ? <EmptyState icon={<Plane className="h-7 w-7" />} title="No employee profile linked" sub="Your login isn't linked to an employee record." /> : (
        <>
          <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {!bal ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />) : bal.map((b, i) => (
              <Item key={b.leaveTypeId} whileHover={{ y: -4 }} className="card flex flex-col items-center p-4 text-center">
                <Ring value={b.paid ? b.balance : 0} max={Math.max(b.quota, b.balance, 1)} color={PALETTE[i % PALETTE.length]} size={72}><span className="text-lg font-extrabold">{b.paid ? b.balance : '—'}</span></Ring>
                <p className="mt-2 text-sm font-bold">{b.name}</p><p className="text-[11px] text-muted">{b.used} used{b.pending ? ` · ${b.pending} pending` : ''}</p>
              </Item>))}
          </Stagger>
          <Card hover={false} className="mt-5"><CardTitle>My requests</CardTitle>
            {!reqs ? <Skeleton className="h-40" /> : (
              <DataTable rows={reqs} keyOf={(r: any) => r.id} empty={<EmptyState icon={<Plane className="h-7 w-7" />} title="No leave requests yet" sub="Time off is good for you. Plan some!" action={<Button onClick={() => setApplying(true)}>Apply leave</Button>} />}
                cols={[
                  { h: 'Type', cell: (r: any) => <div className="flex items-center gap-2"><Badge tone="brand">{r.typeCode}</Badge><span className="font-medium">{r.type}</span></div> },
                  { h: 'Dates', cell: (r: any) => <span>{dateShort(r.from)}{r.to !== r.from && ` → ${dateShort(r.to)}`}</span> },
                  { h: 'Days', cell: (r: any) => <b>{Number(r.days)}</b> },
                  { h: 'Status', cell: (r: any) => <Badge tone={statusTone[r.status]}>{r.status.toLowerCase()}</Badge> },
                  { h: 'Applied', cell: (r: any) => <span className="text-muted">{date(r.createdAt)}</span>, hideOnMobile: true },
                  { h: '', cell: (r: any) => ['PENDING', 'APPROVED'].includes(r.status) && r.from >= today() ? <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={(e) => { e.stopPropagation(); cancel.mutate(r.id); }}>Cancel</Button> : r.decisionNote ? <span className="text-xs text-muted">{r.decisionNote}</span> : null },
                ]} />)}
          </Card>
          {bal && <ApplyModal open={applying} onClose={() => setApplying(false)} balances={applicable} />}
        </>)}
    </>
  );
}
