import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { KeyRound, Shield, ShieldCheck, UserCog } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Button, Card, CardTitle, Field, Input, Modal, PageHeader, Select, Skeleton, Stagger, statusTone } from '../components/ui';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, inr, roleLabel } from '../lib/format';
import { useAct } from '../lib/hooks';

const Row = ({ l, v }: { l: string; v: React.ReactNode }) => <div className="flex justify-between gap-4 py-2 text-sm"><span className="text-muted">{l}</span><span className="text-right font-medium">{v ?? '—'}</span></div>;

function ChangeRequest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [field, setField] = useState<'bank' | 'pan' | 'mobile' | 'name'>('bank');
  const [v, setV] = useState<any>({});
  const value = field === 'bank' ? { holder: v.holder, account: v.account, ifsc: v.ifsc?.toUpperCase() } : field === 'name' ? { firstName: v.firstName, lastName: v.lastName } : field === 'pan' ? v.pan?.toUpperCase() : v.mobile;
  const act = useAct(() => post('/change-requests', { field, value }), { success: 'Request sent to HR for approval', invalidate: [['change-requests']], onDone: () => { onClose(); setV({}); } });
  const i = (k: string, l: string) => <Field label={l}><Input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <Modal open={open} onClose={onClose} title="Request a change" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={act.isPending} onClick={() => act.mutate()}>Send for approval</Button></>}>
      <div className="space-y-4">
        <Field label="What do you want to change?"><Select value={field} onChange={(e) => { setField(e.target.value as any); setV({}); }}><option value="bank">Bank account</option><option value="pan">PAN</option><option value="mobile">Mobile</option><option value="name">Name</option></Select></Field>
        {field === 'bank' && <>{i('holder', 'Account holder')}{i('account', 'Account number')}{i('ifsc', 'IFSC')}</>}
        {field === 'pan' && i('pan', 'New PAN')}{field === 'mobile' && i('mobile', 'New mobile')}{field === 'name' && <>{i('firstName', 'First name')}{i('lastName', 'Last name')}</>}
        <p className="text-xs text-muted">HR approves the change; the old value is kept in history.</p>
      </div>
    </Modal>
  );
}

function Security() {
  const { me, reload, logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const change = useAct(() => post('/auth/change-password', pw), { onDone: () => logout('Password changed — please sign in again') });
  const start = useAct(() => post('/auth/2fa/setup'), { onDone: setSetup });
  const enable = useAct(() => post('/auth/2fa/enable', { code }), { success: 'Two-step verification is on', onDone: () => { setSetup(null); reload(); } });
  const strength = [/.{10,}/, /[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw.next)).length;
  return (
    <Stagger className="grid gap-4 lg:grid-cols-2">
      <Card hover={false}><CardTitle sub="Signs you out everywhere">Change password</CardTitle>
        <div className="space-y-3">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" hint="10+ characters with upper, lower case and a number"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <div className="flex gap-1">{[0, 1, 2, 3, 4].map((i) => <motion.div key={i} className="h-1.5 flex-1 rounded-full" animate={{ background: i < strength ? ['#ef4444', '#f59e0b', '#f59e0b', '#10b981', '#10b981'][strength - 1] : 'rgb(var(--surface-2))' }} />)}</div>
          <Button loading={change.isPending} disabled={strength < 4 || !pw.current} onClick={() => change.mutate()}>Update password</Button>
        </div></Card>
      <Card hover={false}><CardTitle sub="Authenticator app (TOTP)">Two-step verification</CardTitle>
        {me?.totpEnabled ? <div className="flex items-center gap-3 rounded-2xl bg-ok/10 p-4 text-ok"><ShieldCheck className="h-6 w-6" /><p className="text-sm font-semibold">Enabled — you'll be asked for a code at sign-in.</p></div> : setup ? (
          <div className="space-y-3">
            <p className="text-sm">Add this key in Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</p>
            <div className="break-all rounded-xl bg-surface-2 p-3 font-mono text-sm tracking-wider">{setup.secret}</div>
            <a href={setup.otpauthUrl} className="text-xs font-semibold text-brand">Open in authenticator app</a>
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="text-center tracking-[0.4em]" />
            <Button loading={enable.isPending} disabled={code.length !== 6} onClick={() => enable.mutate()}>Verify & enable</Button>
          </div>
        ) : <div className="space-y-3"><p className="text-sm text-muted">Recommended for anyone who can see salary data.</p><Button icon={<Shield className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>Set up 2FA</Button></div>}
        <p className="mt-4 text-xs text-muted">Last sign-in: {dateTime(me?.lastLoginAt)}</p></Card>
    </Stagger>
  );
}

export default function Profile() {
  const { me } = useAuth();
  const [cr, setCr] = useState(false);
  const eid = me?.employeeId;
  const { data: e } = useQuery<any>({ queryKey: ['employee', eid], queryFn: () => get(`/employees/${eid}`), enabled: !!eid });
  const { data: s } = useQuery<any[]>({ queryKey: ['structures', eid], queryFn: () => get(`/employees/${eid}/salary-structures`), enabled: !!eid });
  const { data: reqs } = useQuery<any[]>({ queryKey: ['change-requests'], queryFn: () => get('/change-requests'), enabled: !!eid });
  const name = e ? `${e.firstName} ${e.lastName}` : me?.email ?? '';
  return (
    <>
      <PageHeader title="My profile" actions={eid && <Button variant="secondary" icon={<UserCog className="h-4 w-4" />} onClick={() => setCr(true)}>Request a change</Button>} />
      <Stagger className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center text-center">
          <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><Avatar name={name} size="lg" /></motion.div>
          <p className="mt-3 text-lg font-extrabold">{name}</p><p className="text-sm text-muted">{e?.designation ?? me?.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-1">{me?.roles.map((r) => <Badge key={r} tone="brand">{roleLabel[r]}</Badge>)}</div>
          {e && <Badge className="mt-2" tone={statusTone[e.status]}>{e.status.toLowerCase()}</Badge>}
        </Card>
        {eid && (!e ? <Skeleton className="h-60 lg:col-span-2" /> : (
          <Card className="lg:col-span-2" hover={false}><CardTitle>Details</CardTitle>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div className="divide-y divide-line/70"><Row l="Employee code" v={e.code} /><Row l="Work email" v={e.workEmail} /><Row l="Mobile" v={e.mobile} /><Row l="Department" v={e.department} /><Row l="Manager" v={e.managerName} /><Row l="Joined" v={date(e.doj)} /></div>
              <div className="divide-y divide-line/70"><Row l="PAN" v={<span className="font-mono">{e.pan}</span>} /><Row l="Bank" v={<span className="font-mono">{e.bank}</span>} /><Row l="UAN" v={e.uan} /><Row l="Tax regime" v={<Badge tone="brand">{e.taxRegime}</Badge>} /><Row l="Annual CTC" v={s?.[0] ? inr(s[0].annualCtc) : '—'} /><Row l="Location" v={e.branch} /></div>
            </div>
            {!!reqs?.length && <div className="mt-4 border-t border-line pt-3"><p className="mb-2 text-xs font-bold uppercase text-muted">Change requests</p>{reqs.slice(0, 5).map((r) => <div key={r.id} className="flex items-center justify-between py-1 text-sm"><span className="capitalize">{r.field} · <span className="font-mono text-muted">{r.preview}</span></span><Badge tone={statusTone[r.status]}>{r.status.toLowerCase()}</Badge></div>)}</div>}
          </Card>))}
      </Stagger>
      <h2 className="mb-3 mt-6 flex items-center gap-2 text-lg font-bold"><KeyRound className="h-5 w-5" />Security</h2>
      <Security />
      <ChangeRequest open={cr} onClose={() => setCr(false)} />
    </>
  );
}
