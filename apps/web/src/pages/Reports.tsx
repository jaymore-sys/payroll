import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { FileSpreadsheet, FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Card, CardTitle, DataTable, EmptyState, Input, Skeleton, Switch } from '../components/ui';
import { ApiError, download, get } from '../lib/api';
import { inr } from '../lib/format';

type Def = { key: string; title: string; group: string; desc: string; period: 'month' | 'fy' | 'none' };
type Rep = { title: string; sub?: string; columns: { key: string; label: string; money?: boolean }[]; rows: Record<string, any>[] };
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

/** One report (picked from the Reports sub-menu in the sidebar): choose the month, view it, download Excel or CSV. */
export default function Reports() {
  const { data: defs } = useQuery<Def[]>({ queryKey: ['reports'], queryFn: () => get('/reports') });
  const { key = 'salary-register' } = useParams();
  const [month, setMonth] = useState(prevMonth);
  const [skipped, setSkipped] = useState(false);
  const [q, setQ] = useState('');
  const def = defs?.find((d) => d.key === key);
  const qs = `month=${month}${key === 'salary-register' && skipped ? '&showSkipped=1' : ''}`;
  const { data: rep, isLoading, error } = useQuery<Rep>({ queryKey: ['report', key, qs], queryFn: () => get(`/reports/${key}?${qs}`), enabled: !!def });
  const rows = useMemo(() => (rep?.rows ?? []).filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())), [rep, q]);

  const csv = () => {
    if (!rep) return;
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cols = rep.columns.filter((c) => !c.key.startsWith('_'));
    const text = [cols.map((c) => esc(c.label)).join(','), ...rep.rows.map((r) => cols.map((c) => esc(r[c.key] ?? (c.money ? 0 : ''))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `${key}-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const excel = async () => {
    try { await download(`/reports/${key}?${qs}&format=xlsx`, `${key}-${month}.xlsx`); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Download failed'); }
  };

  return (
    <>
        <Card hover={false} className="min-w-0 p-0" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Reports · {def?.group}</p>
            <CardTitle sub={def?.desc}>{rep?.title ?? def?.title ?? 'Report'}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {def && def.period !== 'none' && <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label={def.period === 'fy' ? 'Any month of the financial year' : 'Month'} />}
              {key === 'salary-register' && <Switch checked={skipped} onChange={setSkipped} label="Show skipped employees" />}
              <div className="relative ml-auto w-full sm:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-9" /></div>
              <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} disabled={!rep?.rows.length} onClick={csv}>CSV</Button>
              <Button size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!rep?.rows.length} onClick={excel}>Excel</Button>
            </div>
            {rep?.sub && <p className="text-xs text-muted">{rep.sub}</p>}
          </div>
          <motion.div key={key + qs} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-x-auto p-2 sm:p-3">
            {error ? <p className="p-4 text-sm text-bad">{(error as Error).message}</p> : isLoading || !rep ? <Skeleton className="h-80" /> : (
              <DataTable rows={rows} keyOf={(r) => rows.indexOf(r).toString()} empty={<EmptyState icon={<FileSpreadsheet className="h-7 w-7" />} title="Nothing to show" sub="No data for this report and period." />}
                cols={rep.columns.map((c) => ({ h: c.label, className: c.money ? 'text-right whitespace-nowrap' : 'whitespace-nowrap', cell: (r: Record<string, any>) => c.key === '_slip'
                  ? <span className="flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => window.open(`${r._slip}?view=1`, '_blank', 'noopener')}>View</Button><Button size="sm" onClick={() => window.open(r._slip, '_blank', 'noopener')}>Download</Button></span>
                  : c.money ? <span className="tabular-nums">{inr(Number(r[c.key] ?? 0))}</span> : <span>{String(r[c.key] ?? '')}</span> }))} />
            )}
            {rep && rep.rows.length > 0 && <p className="px-2 pt-2 text-xs text-muted">{rows.length} of {rep.rows.length} rows</p>}
          </motion.div>
        </Card>
    </>
  );
}
