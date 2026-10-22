import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { inr } from '../lib/format';
import { Donut, PALETTE } from './charts';
import { Badge, CountUp } from './ui';

const Line = ({ l, v, i, tag, neg, compact }: { l: string; v: number; i: number; tag?: string; neg?: boolean; compact?: boolean }) => (
  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 text-sm">
    <span className="flex items-center gap-2">{l}{tag && <Badge tone="brand">{tag}</Badge>}</span>
    <span className="w-24 text-right tabular-nums">{neg && v ? '−' : ''}{inr(v)}</span>
    {!compact && <span className="w-28 text-right tabular-nums text-muted">{neg && v ? '−' : ''}{inr(v * 12)}</span>}
  </motion.div>
);

/** CTC breakup view from the engine's splitCtc() output. */
export default function Breakup({ p, compact }: { p: any; compact?: boolean }) {
  const rows: [string, number, string?][] = [
    ...p.components.map((c: any) => [c.name, c.monthly, c.isWage ? 'wage' : undefined] as [string, number, string?]),
  ];
  const employer: [string, number][] = [['Employer PF', p.employer.pf], ['Employer ESI', p.employer.esi], ['Gratuity provision', p.employer.gratuity]];
  const deductions: [string, number][] = [['Employee PF', p.employee.pf], ['Employee ESI', p.employee.esi], ['Professional tax', p.employee.pt], ['TDS (new regime, est.)', p.tds.new]];
  return (
    <div className="space-y-5">
      {p.warnings?.map((w: string) => <div key={w} className="flex gap-2 rounded-xl bg-warn/12 px-3 py-2.5 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</div>)}
      <div className="grid gap-4 sm:grid-cols-3">
        {[['Monthly gross', p.monthlyGross], ['Take-home / month', p.takeHome.new], ['Employer cost / month', p.employer.monthlyTotal]].map(([l, v], i) => (
          <motion.div key={l as string} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl bg-surface-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p>
            <p className={`mt-1 text-xl font-extrabold ${i === 1 ? 'text-ok' : ''}`}><CountUp value={v as number} format={(x) => inr(x)} duration={0.8} /></p>
          </motion.div>))}
      </div>
      <div className={compact ? '' : 'grid gap-6 lg:grid-cols-[1fr_220px]'}>
        <div className="divide-y divide-line/70">
          {!compact && <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-1 text-xs font-semibold uppercase text-muted"><span>Component</span><span className="w-24 text-right">Monthly</span><span className="w-28 text-right">Annual</span></div>}
          <div>{rows.map(([l, v, t], i) => <Line key={l} l={l} v={v} i={i} tag={t} compact={compact} />)}</div>
          <div><p className="pt-3 text-xs font-bold uppercase text-muted">Employer contributions</p>{employer.map(([l, v], i) => <Line key={l} l={l} v={v} i={i + 4} compact={compact} />)}</div>
          <div><p className="pt-3 text-xs font-bold uppercase text-muted">Employee deductions</p>{deductions.map(([l, v], i) => <Line key={l} l={l} v={v} i={i + 8} neg compact={compact} />)}</div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 py-3 text-sm font-bold"><span>Cost to company</span><span className="w-24 text-right">{inr(p.checkCtc / 12)}</span>{!compact && <span className="w-28 text-right">{inr(p.checkCtc)}</span>}</div>
        </div>
        {!compact && (
          <div>
            <Donut data={[...p.components.map((c: any) => ({ name: c.name, value: c.monthly })), { name: 'Employer costs', value: p.employer.monthlyTotal }]} money height={200} />
            <ul className="mt-2 space-y-1 text-xs">{[...p.components.map((c: any) => c.name), 'Employer costs'].map((n: string, i: number) => <li key={n} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i] }} />{n}</li>)}</ul>
            <div className="mt-4 rounded-xl bg-brand-soft p-3 text-xs text-brand-ink"><p className="font-bold">Estimated TDS / month</p><p>New: {inr(p.tds.new)} · Old: {inr(p.tds.old)}</p><p className="mt-1">Recommended: <b>{p.tds.recommended} regime</b></p></div>
          </div>)}
      </div>
    </div>
  );
}
