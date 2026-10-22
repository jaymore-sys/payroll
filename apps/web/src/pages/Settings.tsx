import { useQuery } from '@tanstack/react-query';
import { Building2, Landmark, MapPin, Settings2, Shapes } from 'lucide-react';
import { useEffect, useState } from 'react';
import MasterList from '../components/MasterList';
import { Badge, Button, Card, CardTitle, Field, Input, PageHeader, Select, Skeleton, Stagger, Switch, Tabs } from '../components/ui';
import { get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fieldErrors, useAct } from '../lib/hooks';

function CompanyForm({ c, edit }: { c: any; edit: boolean }) {
  const [v, setV] = useState<any>(c);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => setV(c), [c]);
  const save = useAct(() => put('/company', Object.fromEntries(Object.entries(v).filter(([k]) => !['id', 'createdAt', 'updatedAt', 'nextEmployeeSeq', 'weekPattern'].includes(k)))), { success: 'Company saved', invalidate: [['company']] });
  useEffect(() => { setErrs(fieldErrors(save.error)); }, [save.error]);
  const t = (k: string, l: string, upper = false) => <Field label={l} error={errs[k]}><Input disabled={!edit} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: upper ? e.target.value.toUpperCase() : e.target.value })} /></Field>;
  return (
    <Stagger className="grid gap-4 lg:grid-cols-2">
      <Card hover={false}><CardTitle>Company details</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">{t('name', 'Display name')}{t('legalName', 'Legal name')}{t('pan', 'PAN', true)}{t('tan', 'TAN', true)}{t('cin', 'CIN / LLPIN', true)}{t('gstin', 'GSTIN', true)}<div className="sm:col-span-2">{t('address', 'Registered address')}</div></div></Card>
      <Card hover={false}><CardTitle sub="Drives payable days, PF and statutory calculations">Pay settings</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pay day"><Input type="number" min={1} max={31} disabled={!edit} value={v.payDay} onChange={(e) => setV({ ...v, payDay: Number(e.target.value) })} /></Field>
          <Field label="Attendance cut-off day"><Input type="number" min={1} max={31} disabled={!edit} value={v.cutoffDay} onChange={(e) => setV({ ...v, cutoffDay: Number(e.target.value) })} /></Field>
          <Field label="Payable days"><Select disabled={!edit} value={v.payableDaysMethod} onChange={(e) => setV({ ...v, payableDaysMethod: e.target.value })}><option value="calendar">Calendar days</option><option value="fixed30">Fixed 30</option><option value="working">Working days</option></Select></Field>
          <Field label="PF wage"><Select disabled={!edit} value={v.pfCapMode} onChange={(e) => setV({ ...v, pfCapMode: e.target.value })}><option value="capped">Capped at ₹15,000</option><option value="actual">Actual wage</option></Select></Field>
          <Field label="Employee code prefix"><Input disabled={!edit} value={v.employeeCodePrefix} onChange={(e) => setV({ ...v, employeeCodePrefix: e.target.value.toUpperCase() })} /></Field>
          <Field label="Financial year starts"><Select disabled={!edit} value={v.fyStartMonth} onChange={(e) => setV({ ...v, fyStartMonth: Number(e.target.value) })}><option value={4}>April</option><option value={1}>January</option></Select></Field>
          <div className="space-y-3 sm:col-span-2">
            <Switch checked={v.labourCodeMode} onChange={(x) => edit && setV({ ...v, labourCodeMode: x })} label="Labour Code mode (50% wage rule for PF/ESI/gratuity)" />
            <Switch checked={v.twoPersonRule} onChange={(x) => edit && setV({ ...v, twoPersonRule: x })} label="Two-person rule (processor can't finalise payroll)" />
          </div>
        </div>
        {edit && <div className="mt-5 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button></div>}</Card>
    </Stagger>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const edit = can('COMPANY_ADMIN');
  const [tab, setTab] = useState<'company' | 'entities' | 'branches' | 'org'>('company');
  const { data: c } = useQuery<any>({ queryKey: ['company'], queryFn: () => get('/company') });
  const { data: entities } = useQuery<any[]>({ queryKey: ['entities'], queryFn: () => get('/entities') });
  return (
    <>
      <PageHeader title="Company setup" sub={edit ? 'Everything the payroll engine needs before the first run' : 'Read-only for Payroll Managers'} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'company', label: 'Company & pay', icon: <Building2 className="h-4 w-4" /> }, { id: 'entities', label: 'Legal entities', icon: <Landmark className="h-4 w-4" /> }, { id: 'branches', label: 'Branches', icon: <MapPin className="h-4 w-4" /> }, { id: 'org', label: 'Departments & designations', icon: <Shapes className="h-4 w-4" /> }]} /></div>
      {tab === 'company' && (c ? <CompanyForm c={c} edit={edit} /> : <Skeleton className="h-96" />)}
      {tab === 'entities' && <MasterList path="entities" title="Legal entities" sub="Each entity has its own PAN, TAN, PF and ESI codes" canEdit={edit}
        fields={[{ k: 'name', label: 'Name' }, { k: 'pan', label: 'PAN', upper: true }, { k: 'tan', label: 'TAN', upper: true }, { k: 'pfCode', label: 'PF establishment code', upper: true }, { k: 'esiCode', label: 'ESI employer code' }]}
        render={(r) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-muted">PAN {r.pan ?? '—'} · TAN {r.tan ?? '—'} · PF {r.pfCode ?? '—'} · ESI {r.esiCode ?? '—'}</p></div>} />}
      {tab === 'branches' && <MasterList path="branches" title="Branches" sub="A branch's state decides PT and LWF" canEdit={edit}
        fields={[{ k: 'name', label: 'Name' }, { k: 'state', label: 'State code', upper: true, placeholder: 'MH' }, { k: 'city', label: 'City' }, { k: 'entityId', label: 'Legal entity', type: 'select', options: (entities ?? []).map((e) => [e.id, e.name]) }, { k: 'ptRegNo', label: 'PT registration' }, { k: 'lwfRegNo', label: 'LWF registration' }, { k: 'metro', label: 'Metro city (HRA 50%)', type: 'bool' }]}
        render={(r) => <div className="flex items-center gap-2"><span className="font-semibold">{r.name}</span><Badge>{r.state}</Badge>{r.metro && <Badge tone="brand">metro</Badge>}<span className="text-xs text-muted">{r.city}</span></div>} />}
      {tab === 'org' && <div className="grid gap-4 lg:grid-cols-2">
        <MasterList path="departments" title="Departments" canEdit={edit} fields={[{ k: 'name', label: 'Name' }]} render={(r) => <span className="font-medium">{r.name}</span>} />
        <MasterList path="designations" title="Designations" canEdit={edit} fields={[{ k: 'name', label: 'Name' }]} render={(r) => <span className="font-medium">{r.name}</span>} />
      </div>}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted"><Settings2 className="h-3.5 w-3.5" />Statutory rates (PF, ESI, PT, LWF, tax slabs) live in dated rules tables — see the API's /rules endpoints.</p>
    </>
  );
}
