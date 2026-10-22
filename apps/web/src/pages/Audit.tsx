import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, FileClock } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton, type Tone } from '../components/ui';
import { get } from '../lib/api';
import { dateTime } from '../lib/format';

const tone = (a: string): Tone => (/fail|locked|reuse|reject|delete/.test(a) ? 'red' : /sensitive|role|password|2fa/.test(a) ? 'amber' : /create|approve|login/.test(a) ? 'green' : 'blue');

export default function Audit() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [pg, setPg] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const { data } = useQuery<any>({ queryKey: ['audit', entity, action, from, pg], queryFn: () => get(`/audit?limit=30&page=${pg}&entity=${entity}&action=${action}&from=${from}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Audit log" sub="Append-only · kept 8 years · every create, change, approval, login and sensitive view" />
      <Card hover={false} className="p-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPg(1); }}><option value="">All entities</option>{['employee', 'user', 'company', 'leave_request', 'leave_type', 'branches', 'departments', 'holidays'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPg(1); }}><option value="">All actions</option>{['login', 'login_failed', 'account_locked', 'view_sensitive', 'create', 'update', 'delete', 'salary_revision', 'role_change', 'leave_approved', 'leave_rejected', 'password_reset'].map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPg(1); }} aria-label="From date" />
        </div>
        {!data ? <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : !data.items.length ? <EmptyState icon={<FileClock className="h-7 w-7" />} title="No matching entries" /> : (
          <ul className="divide-y divide-line/70">{data.items.map((r: any, i: number) => (
            <motion.li key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.015 }}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2/60">
                <Badge tone={tone(r.action)}>{r.action.replace(/_/g, ' ')}</Badge>
                <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{r.email ?? 'system'}</b> <span className="text-muted">· {r.entity.replace('_', ' ')}</span></span>
                <span className="hidden text-xs text-muted sm:block">{r.ip}</span><span className="shrink-0 text-xs text-muted">{dateTime(r.at)}</span>
                <motion.span animate={{ rotate: open === r.id ? 180 : 0 }}><ChevronDown className="h-4 w-4 text-muted" /></motion.span>
              </button>
              <AnimatePresence>{open === r.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">{(['before', 'after'] as const).map((k) => (
                    <div key={k}><p className="mb-1 text-[11px] font-bold uppercase text-muted">{k}</p><pre className="scrollbar-thin max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] leading-relaxed">{r[k] ? JSON.stringify(r[k], null, 2) : '—'}</pre></div>))}</div>
                </motion.div>)}</AnimatePresence>
            </motion.li>))}</ul>)}
        {data && data.total > data.limit && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm"><span className="text-muted">{data.total} entries</span>
            <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={pg <= 1} onClick={() => setPg(pg - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={pg * data.limit >= data.total} onClick={() => setPg(pg + 1)}>Next</Button></div></div>)}
      </Card>
    </>
  );
}
