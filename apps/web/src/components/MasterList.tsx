import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { del, get, post, put } from '../lib/api';
import { useAct } from '../lib/hooks';
import { Button, Card, CardTitle, EmptyState, Field, Input, Modal, Select, Skeleton, Switch } from './ui';

export type MField = { k: string; label: string; type?: 'text' | 'date' | 'bool' | 'select'; options?: [string, string][]; upper?: boolean; placeholder?: string };

/** Small CRUD list for company master tables (branches, departments, holidays …). */
export default function MasterList({ path, title, fields, render, canEdit, sub }: { path: string; title: string; sub?: string; fields: MField[]; render: (r: any) => ReactNode; canEdit: boolean }) {
  const { data } = useQuery<any[]>({ queryKey: [path], queryFn: () => get(`/${path}`) });
  const [edit, setEdit] = useState<any | null>(null);
  const save = useAct((v: any) => {
    const body = Object.fromEntries(fields.map((f) => [f.k, f.type === 'bool' ? !!v[f.k] : v[f.k] === '' ? null : v[f.k]]));
    return v.id ? put(`/${path}/${v.id}`, body) : post(`/${path}`, body);
  }, { success: 'Saved', invalidate: [[path]], onDone: () => setEdit(null) });
  const remove = useAct((id: string) => del(`/${path}/${id}`), { success: 'Deleted', invalidate: [[path]] });
  return (
    <Card hover={false}>
      <CardTitle sub={sub} action={canEdit && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit({})}>Add</Button>}>{title}</CardTitle>
      {!data ? <Skeleton className="h-32" /> : !data.length ? <EmptyState icon={<Plus className="h-7 w-7" />} title={`No ${title.toLowerCase()} yet`} /> : (
        <ul className="divide-y divide-line/70">
          <AnimatePresence initial={false}>{data.map((r, i) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0, transition: { delay: i * 0.02 } }} exit={{ opacity: 0, x: 30 }} className="group flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1 text-sm">{render(r)}</div>
              {canEdit && <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button onClick={() => setEdit(r)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => confirm('Delete this record?') && remove.mutate(r.id)} className="rounded-lg p-1.5 text-muted hover:bg-bad/10 hover:text-bad" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>}
            </motion.li>))}</AnimatePresence>
        </ul>)}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit` : `Add`} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(edit)}>Save</Button></>}>
        <div className="space-y-4">{fields.map((f) => (
          f.type === 'bool' ? <Switch key={f.k} checked={!!edit?.[f.k]} onChange={(x) => setEdit({ ...edit, [f.k]: x })} label={f.label} /> :
          <Field key={f.k} label={f.label}>{f.type === 'select'
            ? <Select value={edit?.[f.k] ?? ''} onChange={(e) => setEdit({ ...edit, [f.k]: e.target.value })}><option value="">—</option>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            : <Input type={f.type ?? 'text'} placeholder={f.placeholder} value={edit?.[f.k] ?? ''} onChange={(e) => setEdit({ ...edit, [f.k]: f.upper ? e.target.value.toUpperCase() : e.target.value })} />}</Field>))}</div>
      </Modal>
    </Card>
  );
}
