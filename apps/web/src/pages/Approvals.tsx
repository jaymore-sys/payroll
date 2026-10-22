import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ClipboardCheck, UserCog, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Skeleton, Tabs } from '../components/ui';
import { get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateShort, dateTime } from '../lib/format';
import { useAct } from '../lib/hooks';

export default function Approvals() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'leave' | 'changes'>('leave');
  const [reject, setReject] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const scope = can('COMPANY_ADMIN') ? 'all' : 'team';
  const { data: leaves } = useQuery<any[]>({ queryKey: ['leave-requests', scope, 'PENDING'], queryFn: () => get(`/leave/requests?scope=${scope}&status=PENDING`) });
  const { data: changes } = useQuery<any[]>({ queryKey: ['change-requests'], queryFn: () => get('/change-requests'), enabled: can('COMPANY_ADMIN') });
  const decide = useAct(({ id, approve, note }: { id: string; approve: boolean; note?: string }) => put(`/leave/requests/${id}/decision`, { approve, note }), { success: 'Done', invalidate: [['leave-requests'], ['dashboard']], onDone: () => { setReject(null); setNote(''); } });
  const decideCr = useAct(({ id, approve }: { id: string; approve: boolean }) => put(`/change-requests/${id}/decision`, { approve }), { success: 'Done', invalidate: [['change-requests'], ['dashboard']] });
  const pendingCr = (changes ?? []).filter((c) => c.status === 'PENDING');

  const tabs = [{ id: 'leave' as const, label: `Leave${leaves?.length ? ` (${leaves.length})` : ''}` }, ...(can('COMPANY_ADMIN') ? [{ id: 'changes' as const, label: `Profile changes${pendingCr.length ? ` (${pendingCr.length})` : ''}` }] : [])];
  return (
    <>
      <PageHeader title="Approvals" sub="Approve with one tap — every decision is logged" />
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'leave' && (!leaves ? <Skeleton className="h-60" /> : !leaves.length ? <Card hover={false}><EmptyState icon={<ClipboardCheck className="h-7 w-7" />} title="Inbox zero" sub="No leave requests waiting for you." /></Card> : (
        <motion.div layout className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>{leaves.map((r, i) => (
            <motion.div key={r.id} layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.05 } }} exit={{ opacity: 0, x: 80, scale: 0.9, transition: { duration: 0.25 } }} className="card p-4">
              <div className="flex items-center gap-3"><Avatar name={r.name} /><div className="min-w-0 flex-1"><p className="truncate font-bold">{r.name}</p><p className="text-xs text-muted">{r.code} · applied {dateTime(r.createdAt)}</p></div><Badge tone="brand">{r.typeCode}</Badge></div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm"><span>{dateShort(r.from)}{r.to !== r.from && ` → ${dateShort(r.to)}`}</span><b>{Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}</b></div>
              {r.reason && <p className="mt-2 line-clamp-2 text-sm text-muted">“{r.reason}”</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setReject(r.id)}>Reject</Button>
                <Button variant="success" icon={<Check className="h-4 w-4" />} loading={decide.isPending && decide.variables?.id === r.id && decide.variables.approve} onClick={() => decide.mutate({ id: r.id, approve: true })}>Approve</Button>
              </div>
            </motion.div>))}</AnimatePresence>
        </motion.div>))}
      {tab === 'changes' && (!changes ? <Skeleton className="h-60" /> : !pendingCr.length ? <Card hover={false}><EmptyState icon={<UserCog className="h-7 w-7" />} title="No pending profile changes" /></Card> : (
        <div className="grid gap-3 md:grid-cols-2">
          <AnimatePresence>{pendingCr.map((c) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 80 }} className="card p-4">
              <div className="flex items-center gap-3"><Avatar name={c.name} size="sm" /><div className="flex-1"><p className="font-bold">{c.name}</p><p className="text-xs text-muted">{c.code} · {dateTime(c.createdAt)}</p></div><Badge tone="amber">{c.field}</Badge></div>
              <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">{c.preview}</p>
              <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => decideCr.mutate({ id: c.id, approve: false })}>Reject</Button><Button variant="success" onClick={() => decideCr.mutate({ id: c.id, approve: true })}>Approve</Button></div>
            </motion.div>))}</AnimatePresence>
        </div>))}
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject leave" footer={<><Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button><Button variant="danger" disabled={note.length < 3} loading={decide.isPending} onClick={() => decide.mutate({ id: reject!, approve: false, note })}>Reject</Button></>}>
        <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (shared with the employee)" maxLength={300} />
      </Modal>
    </>
  );
}
