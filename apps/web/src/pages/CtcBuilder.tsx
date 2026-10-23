import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import Breakup from '../components/Breakup';
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, useDebounced } from '../components/ui';
import { post } from '../lib/api';

const STATES = [['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['DL', 'Delhi'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['GJ', 'Gujarat'], ['WB', 'West Bengal']];

export default function CtcBuilder() {
  const [ctc, setCtc] = useState(1200000);
  const [variable, setVariable] = useState(0);
  const [state, setState] = useState('MH');
  const [metro, setMetro] = useState(true);
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [age, setAge] = useState(30);
  const [cap, setCap] = useState<'capped' | 'actual'>('capped');
  const body = useDebounced({ annualCtc: ctc, annualVariable: variable, state, metro, gender, age, pfCapMode: cap }, 350);
  const { data, error, isLoading } = useQuery<any>({ queryKey: ['ctc-preview', body], queryFn: () => post('/ctc/preview', body), enabled: body.annualCtc > 50000, placeholderData: keepPreviousData });
  const money = (val: number, set: (n: number) => void) => ({ inputMode: 'numeric' as const, value: val ? val.toLocaleString('en-IN') : '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value.replace(/\D/g, '')) || 0) });
  return (
    <>
      <PageHeader title="CTC builder" sub="Split an annual CTC into components with employer costs, the 50% wage rule and TDS for both regimes" />
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Card hover={false} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
          <CardTitle>Inputs</CardTitle>
          <div className="space-y-3">
            <Field label="Annual CTC (₹)"><Input {...money(ctc, setCtc)} /></Field>
            <input type="range" min={180000} max={6000000} step={10000} value={ctc} onChange={(e) => setCtc(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" aria-label="CTC slider" />
            <Field label="Variable pay (annual, ₹)" hint="Paid outside monthly gross"><Input {...money(variable, setVariable)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work state"><Select value={state} onChange={(e) => setState(e.target.value)}>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
              <Field label="Gender"><Select value={gender} onChange={(e) => setGender(e.target.value as 'M' | 'F')}><option value="M">Male</option><option value="F">Female</option></Select></Field>
              <Field label="Age"><Input type="number" min={18} max={80} value={age} onChange={(e) => setAge(Number(e.target.value) || 30)} /></Field>
              <Field label="PF wage"><Select value={cap} onChange={(e) => setCap(e.target.value as 'capped' | 'actual')}><option value="capped">Capped ₹25,000</option><option value="actual">Actual</option></Select></Field>
            </div>
            <Switch checked={metro} onChange={setMetro} label="Metro city (HRA 50% of basic)" />
          </div>
        </Card>
        <Card hover={false}>
          <CardTitle sub="Default template: Basic 50% of gross · HRA 50%/40% of basic · Special allowance balances">Breakup</CardTitle>
          {error ? <p className="text-sm text-bad">{(error as Error).message}</p> : ctc <= 50000 ? <EmptyState icon={<Wallet className="h-7 w-7" />} title="Enter a CTC above ₹50,000" /> : isLoading || !data ? <Skeleton className="h-96" /> : <Breakup p={data} />}
        </Card>
      </div>
    </>
  );
}
