import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { UserCog } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { get, put } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAct } from '../lib/hooks';

/** Employee self-service changes to bank, PAN, name or mobile wait here for HR approval (spec §2). */
export default function Approvals() {
  const { data } = useQuery<any[]>({ queryKey: ['change-requests'], queryFn: () => get('/change-requests') });
  const decide = useAct(({ id, approve }: { id: string; approve: boolean }) => put(`/change-requests/${id}/decision`, { approve }), { success: 'Done', invalidate: [['change-requests'], ['dashboard']] });
  const pending = (data ?? []).filter((c) => c.status === 'PENDING');
  return (
    <>
      <PageHeader title="Profile requests" sub="Bank, PAN, name and mobile changes requested by employees — every decision is logged" />
      {!data ? <Skeleton className="h-60" /> : !pending.length ? <Card hover={false}><EmptyState icon={<UserCog className="h-7 w-7" />} title="No pending requests" sub="When an employee asks to change their bank account or PAN, it appears here." /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>{pending.map((c, i) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }} exit={{ opacity: 0, x: 80 }} className="card p-4">
              <div className="flex items-center gap-3"><Avatar name={c.name} size="sm" /><div className="flex-1"><p className="font-bold">{c.name}</p><p className="text-xs text-muted">{c.code} · {dateTime(c.createdAt)}</p></div><Badge tone="amber">{c.field}</Badge></div>
              <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm">{c.preview}</p>
              <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => decide.mutate({ id: c.id, approve: false })}>Reject</Button><Button variant="success" onClick={() => decide.mutate({ id: c.id, approve: true })}>Approve</Button></div>
            </motion.div>))}</AnimatePresence>
        </div>)}
    </>
  );
}
