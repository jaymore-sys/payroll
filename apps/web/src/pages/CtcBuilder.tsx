import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import Breakup from '../components/Breakup';
import { Card, CardTitle, EmptyState, Field, Input, PageHeader, Select, Skeleton, useDebounced } from '../components/ui';
import { post } from '../lib/api';

const STATES = [['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['DL', 'Delhi'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['GJ', 'Gujarat'], ['WB', 'West Bengal']];

export default function CtcBuilder() {
  const [mode, setMode] = useState<'gross' | 'ctc'>('gross');
  const [gross, setGross] = useState(30000);
  const [ctc, setCtc] = useState(1200000);
  const [variable, setVariable] = useState(0);
  const [state, setState] = useState('MH');
  const metro = true; // HRA is a flat 25% of gross, so metro no longer changes the split
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [age, setAge] = useState(30);
  const [cap, setCap] = useState<'capped' | 'actual'>('capped');
  const body = useDebounced({ ...(mode === 'gross' ? { monthlyGross: gross } : { annualCtc: ctc }), annualVariable: variable, state, metro, gender, age, pfCapMode: cap }, 350);
  const { data, error, isLoading } = useQuery<any>({ queryKey: ['ctc-preview', body], queryFn: () => post('/ctc/preview', body), enabled: mode === 'gross' ? gross >= 1000 : ctc > 50000, placeholderData: keepPreviousData });
  const money = (val: number, set: (n: number) => void) => ({ inputMode: 'numeric' as const, value: val ? val.toLocaleString('en-IN') : '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value.replace(/\D/g, '')) || 0) });
  return (
    <>
      <PageHeader title="Salary builder" sub="Split a monthly gross (or annual CTC) into Basic, HRA, LTA and Special allowance, with PF, PT, employer cost and TDS" />
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Card hover={false} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
          <CardTitle>Inputs</CardTitle>
          <div className="space-y-3">
            <Field label="Start from"><Select value={mode} onChange={(e) => setMode(e.target.value as 'gross' | 'ctc')}><option value="gross">Monthly gross</option><option value="ctc">Annual CTC</option></Select></Field>
            {mode === 'gross' ? <>
              <Field label="Monthly gross (₹)"><Input {...money(gross, setGross)} /></Field>
              <input type="range" min={10000} max={500000} step={500} value={gross} onChange={(e) => setGross(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" aria-label="Gross slider" />
            </> : <>
              <Field label="Annual CTC (₹)"><Input {...money(ctc, setCtc)} /></Field>
              <input type="range" min={180000} max={6000000} step={10000} value={ctc} onChange={(e) => setCtc(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" aria-label="CTC slider" />
            </>}
            <Field label="Variable pay (annual, ₹)" hint="Paid outside monthly gross"><Input {...money(variable, setVariable)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work state"><Select value={state} onChange={(e) => setState(e.target.value)}>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
              <Field label="Gender"><Select value={gender} onChange={(e) => setGender(e.target.value as 'M' | 'F')}><option value="M">Male</option><option value="F">Female</option></Select></Field>
              <Field label="Age"><Input type="number" min={18} max={80} value={age} onChange={(e) => setAge(Number(e.target.value) || 30)} /></Field>
              <Field label="PF wage"><Select value={cap} onChange={(e) => setCap(e.target.value as 'capped' | 'actual')}><option value="capped">Capped ₹25,000</option><option value="actual">Actual</option></Select></Field>
            </div>
          </div>
        </Card>
        <Card hover={false}>
          <CardTitle sub="Basic 50% · HRA 25% · LTA 10% · Special allowance 15% of gross · PF 12% on gross minus HRA (max ₹3,000)">Breakup</CardTitle>
          {error ? <p className="text-sm text-bad">{(error as Error).message}</p> : (mode === 'gross' ? gross < 1000 : ctc <= 50000) ? <EmptyState icon={<Wallet className="h-7 w-7" />} title="Enter a salary" /> : isLoading || !data ? <Skeleton className="h-96" /> : <Breakup p={data} />}
        </Card>
      </div>
    </>
  );
}
