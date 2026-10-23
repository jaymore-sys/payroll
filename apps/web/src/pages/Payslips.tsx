import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Eye, FileDown, ReceiptText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, CountUp, DataTable, EmptyState, Modal, PageHeader, Select, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { inr } from '../lib/format';
import { PayslipBody } from './PayrollRun';

const fyOf = (m: string) => { const y = Number(m.slice(0, 4)); const s = Number(m.slice(5, 7)) >= 4 ? y : y - 1; return `${s} - ${s + 1}`; };

export default function Payslips() {
  const { data } = useQuery<any[]>({ queryKey: ['my-payslips'], queryFn: () => get('/payslips') });
  const years = useMemo(() => [...new Set((data ?? []).map((p) => fyOf(p.month)))], [data]);
  const [fy, setFy] = useState<string>('');
  const year = fy || years[0];
  const rows = (data ?? []).filter((p) => fyOf(p.month) === year);
  const [open, setOpen] = useState<string | null>(null);
  const { data: slip } = useQuery<any>({ queryKey: ['payslip', open], queryFn: () => get(`/payslips/${open}`), enabled: !!open });
  const totals = rows.reduce((a, r) => ({ gross: a.gross + Number(r.gross), net: a.net + Number(r.net), tds: a.tds + Number(r.tds) }), { gross: 0, net: 0, tds: 0 });
  return (
    <>
      <PageHeader title="Pay slips" sub="Click a month to see the payslip, or download it as a PDF" />
      {!data ? <Skeleton className="h-72" /> : !data.length ? <Card hover={false}><EmptyState icon={<ReceiptText className="h-7 w-7" />} title="No payslips yet" sub="Your payslip appears here as soon as HR approves the month's salaries." /></Card> : (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-[260px_1fr]">
            <Card hover={false} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <p className="label">Financial year</p>
              <Select value={year} onChange={(e) => setFy(e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
            </Card>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="gradient-brand grid grid-cols-3 gap-3 rounded-2xl p-5 text-white shadow-lift">
              {[['Gross this year', totals.gross], ['TDS this year', totals.tds], ['In-hand this year', totals.net]].map(([l, v]) => (
                <div key={l as string}><p className="text-[11px] font-semibold uppercase text-white/75">{l}</p><p className="text-lg font-extrabold sm:text-2xl"><CountUp value={v as number} format={(x) => inr(x)} /></p></div>))}
            </motion.div>
          </div>
          <Card hover={false} className="p-2 sm:p-3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <DataTable rows={rows} keyOf={(p: any) => p.id} onRow={(p: any) => setOpen(p.id)}
              cols={[
                { h: 'Month', cell: (p: any) => <span className="font-semibold text-brand">{p.label}</span> },
                { h: 'Gross salary', className: 'text-right', cell: (p: any) => <span className="tabular-nums">{inr(p.gross)}</span> },
                { h: 'Deductions', className: 'text-right', cell: (p: any) => <span className="tabular-nums text-bad">{inr(p.deductions)}</span>, hideOnMobile: true },
                { h: 'In-hand salary', className: 'text-right', cell: (p: any) => <b className="tabular-nums text-ok">{inr(p.net)}</b> },
                { h: '', className: 'text-right', cell: (p: any) => <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setOpen(p.id); }}>View</Button>
                    <Button size="sm" variant="secondary" icon={<FileDown className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); window.open(`/payslips/${p.id}/print`, '_blank', 'noopener'); }}>PDF</Button>
                  </div> },
              ]} />
          </Card>
        </>)}
      <Modal open={!!open} onClose={() => setOpen(null)} wide title={slip ? `Payslip · ${slip.label}` : 'Payslip'}
        footer={open && <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => window.open(`/payslips/${open}/print`, '_blank', 'noopener')}>Download PDF</Button>}>
        {!slip ? <Skeleton className="h-72" /> : (
          <>
            <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm"><div><p className="font-bold">{slip.employee.firstName} {slip.employee.lastName}</p><p className="text-muted">{slip.employee.code} · {slip.employee.designation ?? ''}</p></div>
              <div className="text-right text-muted"><p>{slip.company.name}</p><p>PAN ••••{slip.employee.panLast4 ?? '—'} · UAN {slip.employee.uan ?? '—'}</p></div></div>
            <PayslipBody p={slip.payslip} />
          </>)}
      </Modal>
    </>
  );
}
