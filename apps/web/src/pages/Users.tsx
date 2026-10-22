import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Avatar, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';
import { dateTime, roleLabel } from '../lib/format';
import { useAct } from '../lib/hooks';

const ROLES: Role[] = ['COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER', 'EMPLOYEE'];
const RoleChecks = ({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) => (
  <div className="grid grid-cols-2 gap-2">{ROLES.map((r) => (
    <label key={r} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line p-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
      <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />{roleLabel[r]}
    </label>))}</div>
);
const Secret = ({ pw, onClose }: { pw: string | null; onClose: () => void }) => (
  <Modal open={!!pw} onClose={onClose} title="Temporary password" footer={<Button onClick={onClose}>Done</Button>}>
    <p className="text-sm text-muted">Shown only once. Share it over a secure channel and ask the user to change it after signing in.</p>
    <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 font-mono"><span>{pw}</span><button onClick={() => { navigator.clipboard.writeText(pw!); toast.success('Copied'); }} aria-label="Copy"><Copy className="h-4 w-4" /></button></div>
  </Modal>
);

export default function Users() {
  const { me } = useAuth();
  const { data } = useQuery<any[]>({ queryKey: ['users'], queryFn: () => get('/users') });
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [nu, setNu] = useState<{ email: string; roles: Role[]; employeeId: string }>({ email: '', roles: ['EMPLOYEE'], employeeId: '' });
  const [pw, setPw] = useState<string | null>(null);
  const { data: emps } = useQuery<any>({ queryKey: ['employees', 'all-min'], queryFn: () => get('/employees?limit=200&sort=name'), enabled: adding });
  const saveRoles = useAct(() => put(`/users/${editing.id}/roles`, { roles: editing.roles }), { success: 'Roles updated — user must sign in again', invalidate: [['users']], onDone: () => setEditing(null) });
  const toggle = useAct(({ id, active }: { id: string; active: boolean }) => put(`/users/${id}/active`, { active }), { success: 'Updated', invalidate: [['users']] });
  const reset = useAct((id: string) => post(`/users/${id}/reset-password`), { invalidate: [['users']], onDone: (r) => setPw(r.tempPassword) });
  const create = useAct(() => post('/users', { email: nu.email, roles: nu.roles, employeeId: nu.employeeId || undefined }), { invalidate: [['users']], onDone: (r) => { setAdding(false); setPw(r.tempPassword); setNu({ email: '', roles: ['EMPLOYEE'], employeeId: '' }); } });
  return (
    <>
      <PageHeader title="Users & roles" sub="Permissions are enforced on the server for every request" actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Invite user</Button>} />
      <Card hover={false} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {!data ? <Skeleton className="h-60" /> : (
          <DataTable rows={data} keyOf={(r: any) => r.id}
            cols={[
              { h: 'User', cell: (r: any) => <div className="flex items-center gap-3"><Avatar name={r.name ?? r.email} size="sm" /><div className="min-w-0"><p className="truncate font-semibold">{r.name ?? '—'}</p><p className="truncate text-xs text-muted">{r.email}</p></div></div> },
              { h: 'Roles', cell: (r: any) => <div className="flex flex-wrap justify-end gap-1 md:justify-start">{r.roles.map((x: Role) => <Badge key={x} tone={x === 'COMPANY_ADMIN' ? 'brand' : 'gray'}>{roleLabel[x]}</Badge>)}</div> },
              { h: 'Security', cell: (r: any) => <div className="flex gap-1">{r.totpEnabled ? <Badge tone="green"><ShieldCheck className="h-3 w-3" />2FA</Badge> : <Badge>no 2FA</Badge>}{r.lockedUntil && new Date(r.lockedUntil) > new Date() && <Badge tone="red"><Lock className="h-3 w-3" />locked</Badge>}</div> },
              { h: 'Last login', cell: (r: any) => <span className="text-muted">{dateTime(r.lastLoginAt)}</span>, hideOnMobile: true },
              { h: 'Active', cell: (r: any) => <Switch checked={r.active} onChange={(a) => r.id !== me?.id && toggle.mutate({ id: r.id, active: a })} /> },
              { h: '', cell: (r: any) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing({ ...r })}>Roles</Button><Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => confirm(`Reset password for ${r.email}?`) && reset.mutate(r.id)}>Reset</Button></div> },
            ]} />)}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Roles · ${editing?.email ?? ''}`} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!editing?.roles.length} loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>Save</Button></>}>
        {editing && <RoleChecks value={editing.roles} onChange={(roles) => setEditing({ ...editing, roles })} />}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="Invite user" footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={!nu.email || !nu.roles.length} loading={create.isPending} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Email"><Input type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></Field>
          <Field label="Link to employee (optional)"><Select value={nu.employeeId} onChange={(e) => setNu({ ...nu, employeeId: e.target.value })}><option value="">—</option>{emps?.items.map((x: any) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName} ({x.code})</option>)}</Select></Field>
          <RoleChecks value={nu.roles} onChange={(roles) => setNu({ ...nu, roles })} />
        </div>
      </Modal>
      <Secret pw={pw} onClose={() => setPw(null)} />
    </>
  );
}
