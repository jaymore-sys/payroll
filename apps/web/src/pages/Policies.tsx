import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import MasterList from '../components/MasterList';
import { Badge, Button, Card, CardTitle, DataTable, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useAct } from '../lib/hooks';

const NUM = ['quota', 'carryCap', 'encashCap', 'allowNegative', 'maxPerRequest', 'minNoticeDays', 'encashDivisor'];

function TypeModal({ t, onClose }: { t: any; onClose: () => void }) {
  const [v, setV] = useState<any>(() => ({ code: '', name: '', paid: true, quota: 0, accrual: 'upfront', proration: 'months', carryCap: 0, encashCap: 0, encashDivisor: 26, sandwich: false, allowNegative: 0, minNoticeDays: 0, maxPerRequest: 10, halfDay: true, active: true, ...t, ...Object.fromEntries(NUM.filter((k) => t?.[k] !== undefined).map((k) => [k, Number(t[k])])) }));
  const save = useAct(() => { const { id, companyId, createdAt, updatedAt, docAfterDays, gender, ...body } = v; void companyId; void createdAt; void updatedAt; return id ? put(`/leave-types/${id}`, { ...body, gender: gender || null, docAfterDays: docAfterDays ?? null }) : post('/leave-types', { ...body, gender: gender || null }); }, { success: 'Policy saved', invalidate: [['leave-types']], onDone: onClose });
  const n = (k: string, l: string) => <Field label={l}><Input type="number" step="0.5" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></Field>;
  return (
    <Modal open onClose={onClose} wide title={t.id ? `Edit ${t.name}` : 'New leave type'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code"><Input value={v.code} disabled={!!t.id} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name" className="sm:col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        {n('quota', 'Annual quota')}
        <Field label="Accrual"><Select value={v.accrual} onChange={(e) => setV({ ...v, accrual: e.target.value })}><option value="upfront">Upfront</option><option value="monthly">Monthly</option><option value="days_worked">By days worked</option></Select></Field>
        <Field label="Joiner proration"><Select value={v.proration} onChange={(e) => setV({ ...v, proration: e.target.value })}><option value="months">By months</option><option value="days">By days</option><option value="none">None</option></Select></Field>
        {n('carryCap', 'Carry-forward cap')}{n('encashCap', 'Encash cap / year')}
        <Field label="Encash divisor"><Select value={v.encashDivisor} onChange={(e) => setV({ ...v, encashDivisor: Number(e.target.value) })}><option value={26}>26</option><option value={30}>30</option></Select></Field>
        {n('maxPerRequest', 'Max days / request')}{n('minNoticeDays', 'Notice (days)')}{n('allowNegative', 'Negative balance allowed')}
        <Field label="Only for"><Select value={v.gender ?? ''} onChange={(e) => setV({ ...v, gender: e.target.value })}><option value="">Everyone</option><option value="F">Women</option><option value="M">Men</option></Select></Field>
        <div className="flex flex-wrap gap-5 sm:col-span-3"><Switch checked={v.paid} onChange={(x) => setV({ ...v, paid: x })} label="Paid" /><Switch checked={v.halfDay} onChange={(x) => setV({ ...v, halfDay: x })} label="Half days" /><Switch checked={v.sandwich} onChange={(x) => setV({ ...v, sandwich: x })} label="Sandwich rule" /><Switch checked={v.active} onChange={(x) => setV({ ...v, active: x })} label="Active" /></div>
      </div>
    </Modal>
  );
}

export default function Policies() {
  const { can } = useAuth();
  const admin = can('COMPANY_ADMIN');
  const [edit, setEdit] = useState<any | null>(null);
  const { data } = useQuery<any[]>({ queryKey: ['leave-types'], queryFn: () => get('/leave-types') });
  return (
    <>
      <PageHeader title="Leave policies" sub="Policies are configuration — the leave engine reads them, nothing is hard-coded" actions={admin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>New leave type</Button>} />
      <Card hover={false} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <CardTitle>Leave types</CardTitle>
        {!data ? <Skeleton className="h-60" /> : (
          <DataTable rows={data} keyOf={(r: any) => r.id} onRow={admin ? setEdit : undefined}
            cols={[
              { h: 'Type', cell: (r: any) => <div className="flex items-center gap-2"><Badge tone="brand">{r.code}</Badge><span className="font-semibold">{r.name}</span>{!r.active && <Badge>inactive</Badge>}</div> },
              { h: 'Quota', cell: (r: any) => <b>{Number(r.quota)}</b> },
              { h: 'Accrual', cell: (r: any) => <span className="capitalize">{r.accrual.replace('_', ' ')}</span> },
              { h: 'Carry / encash', cell: (r: any) => `${Number(r.carryCap)} / ${Number(r.encashCap)}`, hideOnMobile: true },
              { h: 'Rules', cell: (r: any) => <div className="flex flex-wrap gap-1">{r.paid ? <Badge tone="green">paid</Badge> : <Badge tone="red">unpaid</Badge>}{r.sandwich && <Badge tone="amber">sandwich</Badge>}{r.gender && <Badge tone="blue">{r.gender === 'F' ? 'women' : 'men'}</Badge>}</div>, hideOnMobile: true },
              { h: '', cell: () => admin ? <Pencil className="h-4 w-4 text-muted" /> : null, hideOnMobile: true },
            ]} />)}
      </Card>
      <div className="mt-5"><MasterList path="holidays" title="Holiday calendar" sub="Blank state = applies to all branches" canEdit={admin}
        fields={[{ k: 'date', label: 'Date', type: 'date' }, { k: 'name', label: 'Name' }, { k: 'state', label: 'State code (optional)', upper: true, placeholder: 'MH' }, { k: 'restricted', label: 'Restricted holiday', type: 'bool' }]}
        render={(r) => <div className="flex items-center gap-3"><span className="w-28 shrink-0 font-semibold">{date(r.date)}</span><span className="flex-1 truncate">{r.name}</span>{r.state && <Badge>{r.state}</Badge>}{r.restricted && <Badge tone="amber">restricted</Badge>}</div>} /></div>
      {edit && <TypeModal t={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
