import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, inrShort } from '../lib/format';

export const PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f43f5e'];
const tick = { fill: '#94a3b8', fontSize: 11 };

const Tip = ({ active, payload, label, money }: any) => active && payload?.length ? (
  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-xl">
    {label && <p className="mb-1 font-bold">{label}</p>}
    {payload.map((p: any) => <p key={p.dataKey ?? p.name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload.fill }} />{p.name}: <b>{money ? inr(p.value) : p.value}</b></p>)}
  </div>
) : null;

export function TrendChart({ data }: { data: { month: string; headcount: number; joiners: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
          <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ec4899" stopOpacity={0.35} /><stop offset="100%" stopColor="#ec4899" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="headcount" name="Headcount" stroke="#6366f1" strokeWidth={2.5} fill="url(#g1)" animationDuration={1400} />
        <Area type="monotone" dataKey="joiners" name="Joiners" stroke="#ec4899" strokeWidth={2} fill="url(#g2)" animationDuration={1600} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DeptCostChart({ data }: { data: { name: string; cost: number; headcount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} horizontal={false} />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={inrShort} />
        <YAxis type="category" dataKey="name" tick={tick} axisLine={false} tickLine={false} width={96} />
        <Tooltip content={<Tip money />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
        <Bar dataKey="cost" name="Monthly cost" radius={[0, 8, 8, 0]} animationDuration={1200} barSize={18}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, money, height = 200, inner = 58 }: { data: { name: string; value: number }[]; money?: boolean; height?: number; inner?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={inner} outerRadius={inner + 28} paddingAngle={3} cornerRadius={6} animationDuration={1200} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip content={<Tip money={money} />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
