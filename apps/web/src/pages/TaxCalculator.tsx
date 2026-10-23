import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Info, Sparkles, Wand2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { get } from '../lib/api';
import { useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Badge, Button, Card, CardTitle, CountUp, Field, Input, Item, PageHeader, Select, Skeleton, Stagger, Switch, useDebounced } from '../components/ui';
import { post } from '../lib/api';
import { inr, inrShort } from '../lib/format';

const fields: [string, string, string?][] = [
  ['annualSalary', 'Annual gross salary'], ['basicDaAnnual', 'Basic + DA (annual)'], ['hraReceived', 'HRA received (annual)', 'old'], ['rentPaid', 'Rent paid (annual)', 'old'],
  ['80C', '80C — PF, PPF, ELSS, LIC…', 'old'], ['80D', '80D — health insurance (self)', 'old'], ['80DParents', '80D — parents', 'old'], ['80CCD1B', '80CCD(1B) — own NPS', 'old'],
  ['homeLoanInterest', 'Home loan interest 24(b)', 'old'], ['employerNps', 'Employer NPS 80CCD(2)'], ['professionalTax', 'Professional tax paid', 'old'], ['otherIncome', 'Other income'],
];

function RegimeCard({ label, r, best, delay }: { label: string; r: any; best: boolean; delay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Item className={clsx('card relative overflow-hidden p-5', best && 'ring-2 ring-ok')} transition={{ delay }}>
      <AnimatePresence>{best && (
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 300 }} className="absolute right-4 top-4">
          <Badge tone="green"><Crown className="h-3 w-3" />Recommended</Badge></motion.div>)}</AnimatePresence>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-extrabold"><CountUp value={r.totalTax} format={(v) => inr(v)} duration={0.7} /></p>
      <p className="text-xs text-muted">Monthly ≈ {inr(Math.round(r.totalTax / 12))} · taxable {inr(r.taxableIncome)}</p>
      <button onClick={() => setOpen(!open)} className="mt-3 text-xs font-semibold text-brand">{open ? 'Hide' : 'Show'} worksheet</button>
      <AnimatePresence>{open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 divide-y divide-line/70 text-sm">{r.lines.filter((l: any) => l.amount !== 0 || ['Taxable income', 'Total tax'].includes(l.label)).map((l: any, i: number) => (
            <motion.div key={l.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={clsx('flex justify-between py-1.5', ['Taxable income', 'Total tax'].includes(l.label) && 'font-bold')}>
              <span title={l.ruleId}>{l.label}</span><span className="tabular-nums">{inr(l.amount)}</span></motion.div>))}</div>
        </motion.div>)}</AnimatePresence>
    </Item>
  );
}

export default function TaxCalculator() {
  const [v, setV] = useState<Record<string, number>>({ annualSalary: 1500000, basicDaAnnual: 750000, hraReceived: 300000, rentPaid: 240000, '80C': 150000, '80D': 25000 });
  const [metro, setMetro] = useState(true);
  const [senior, setSenior] = useState(false);
  const [age, setAge] = useState('below60');
  const body: Record<string, any> = useDebounced({ ...v, metro, age, senior }, 350);
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['tax-calc', body], placeholderData: keepPreviousData,
    queryFn: () => post('/tax/calculate', {
      taxYear: '2026-27', ageBand: body.age, annualSalary: body.annualSalary ?? 0, basicDaAnnual: body.basicDaAnnual ?? 0, hraReceived: body.hraReceived ?? 0, rentPaid: body.rentPaid ?? 0, metro: body.metro,
      professionalTax: body.professionalTax ?? 0, employerNps: body.employerNps ?? 0, otherIncome: body.otherIncome ?? 0,
      deductions: { '80C': body['80C'] ?? 0, '80D': body['80D'] ?? 0, '80DParents': body['80DParents'] ?? 0, parentsSenior: body.senior, '80CCD1B': body['80CCD1B'] ?? 0, homeLoanInterest: body.homeLoanInterest ?? 0 },
    }),
  });
  const { me } = useAuth();
  const { data: dash } = useQuery<any>({ queryKey: ['dashboard'], queryFn: () => get('/dashboard'), enabled: !!me?.employeeId });
  const mine = dash?.me?.salary?.breakup;
  const useMine = () => {
    const hra = mine.components.find((c: any) => c.code === 'HRA')?.monthly ?? 0;
    setV({ ...v, annualSalary: mine.monthlyGross * 12 + (mine.annualVariable ?? 0), basicDaAnnual: mine.wages * 12, hraReceived: hra * 12, '80C': Math.max(v['80C'] ?? 0, mine.employee.pf * 12), professionalTax: mine.employee.pt * 12 });
  };
  return (
    <>
      <PageHeader title="Tax deductions" sub="Tax Year 2026-27 · Income-tax Act 2025 · compare both regimes side by side"
        actions={mine && <Button variant="secondary" icon={<Wand2 className="h-4 w-4" />} onClick={useMine}>Use my salary</Button>} />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Card hover={false} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
          <CardTitle sub="Fields marked OLD only count in the old regime">Your income & deductions</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Field label="Age"><Select value={age} onChange={(e) => setAge(e.target.value)}><option value="below60">Below 60</option><option value="60to79">60 – 79</option><option value="80plus">80+</option></Select></Field>
            <div className="flex flex-col justify-end gap-2 pb-1"><Switch checked={metro} onChange={setMetro} label="Metro city (HRA 50%)" /><Switch checked={senior} onChange={setSenior} label="Parents are seniors" /></div>
            {fields.map(([k, l, only]) => (
              <Field key={k} label={l} hint={only ? 'OLD' : undefined}>
                <div className="relative"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
                  <Input inputMode="numeric" className="pl-7" value={v[k] ? v[k].toLocaleString('en-IN') : ''} placeholder="0" onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div>
              </Field>))}
          </div>
        </Card>
        <div className="space-y-5">
          {error ? <Card className="text-sm text-bad">{(error as Error).message}</Card> : isLoading || !data ? <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div> : (
            <>
              <motion.div key={data.recommended} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="gradient-brand relative overflow-hidden rounded-3xl p-6 text-white shadow-lift">
                <motion.div className="absolute -right-6 -top-6" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 20, ease: 'linear' }}><Sparkles className="h-28 w-28 opacity-15" /></motion.div>
                <p className="text-sm text-white/80">The <b className="capitalize">{data.recommended} regime</b> saves you</p>
                <p className="mt-1 text-4xl font-extrabold"><CountUp value={data.savings} format={(x) => inr(x)} /></p>
                <p className="mt-1 text-sm text-white/80">per year · about {inr(Math.round(data.savings / 12))} a month</p>
              </motion.div>
              <Stagger className="grid gap-4 sm:grid-cols-2">
                <RegimeCard label="New regime (default)" r={data.new} best={data.recommended === 'new'} delay={0} />
                <RegimeCard label="Old regime" r={data.old} best={data.recommended === 'old'} delay={0.08} />
              </Stagger>
              <Card hover={false}><CardTitle>Comparison</CardTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={[{ n: 'Taxable income', New: data.new.taxableIncome, Old: data.old.taxableIncome }, { n: 'Total tax', New: data.new.totalTax, Old: data.old.totalTax }]} barGap={6}>
                    <XAxis dataKey="n" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(x: number) => inr(x)} contentStyle={{ borderRadius: 12, border: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))' }} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                    <Bar dataKey="New" radius={[8, 8, 0, 0]} animationDuration={900}>{[0, 1].map((i) => <Cell key={i} fill="#6366f1" />)}</Bar>
                    <Bar dataKey="Old" radius={[8, 8, 0, 0]} animationDuration={1100}>{[0, 1].map((i) => <Cell key={i} fill="#ec4899" />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Estimate using seeded 2026-27 rules (87A rebate with marginal relief, surcharge relief, 4% cess). Payroll TDS uses verified proofs after the proof deadline. Short form figures: {inrShort(data.new.totalTax)} vs {inrShort(data.old.totalTax)}.</p>
              </Card>
            </>)}
        </div>
      </div>
    </>
  );
}
