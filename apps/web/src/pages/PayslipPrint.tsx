import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { date } from '../lib/format';

const amt = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Indian-system amount in words: 1,70,386 → "One Lakh Seventy Thousand Three Hundred Eighty Six". */
export function inWords(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  n = Math.round(Math.abs(n));
  if (!n) return 'Zero';
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const la = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (la) parts.push(`${two(la)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}

/** A4 payslip in the company's format (Net = Gross − Deductions, Monthly vs Total columns); opens the print dialog for "Save as PDF". */
export default function PayslipPrint() {
  const { id = '' } = useParams();
  const { data, error } = useQuery<any>({ queryKey: ['payslip', id], queryFn: () => get(`/payslips/${id}`) });
  useEffect(() => { if (data) { document.title = `Payslip-${data.employee.firstName} ${data.employee.lastName}-${data.label}`; setTimeout(() => window.print(), 400); } }, [data]);
  if (error) return <p className="p-8">{(error as Error).message}</p>;
  if (!data) return <p className="p-8 text-sm">Preparing payslip…</p>;
  const p = data.payslip, e = data.employee;
  const earnings: { name: string; full: number; amount: number }[] = p.earnings;
  const extras = p.lines.filter((l: any) => l.section === 'earning' && !earnings.some((x) => x.name === l.label));
  const ded = p.lines.filter((l: any) => l.section === 'deduction');
  const lopAmount = earnings.reduce((s, x) => s + x.full - x.amount, 0);
  const info: [string, string | number | null][] = [
    ['Employee Code', e.code], ['Name', `${e.firstName} ${e.lastName}`], ['Designation', e.designation], ['Date of birth', e.dob ? date(e.dob) : null],
    ['PAN', e.panLast4 ? `XXXXXX${e.panLast4}` : null], ['UAN', e.uan], ['Account no.', e.bankLast4 ? `XXXXXX${e.bankLast4}` : null], ['IFSC code', e.ifsc],
    ['Date of joining', date(e.doj)], ['Payable Days', p.payableDays], ['LOP Days', p.lopDays || null], ['Regime Opted', p.tax.regime === 'old' ? 'Old Regime' : 'New Regime'],
  ];
  const Table = ({ head, rows, total, totalLabel, note }: { head: string; rows: [string, number, number][]; total: number; totalLabel: string; note?: string }) => (
    <div>
      <table className="w-full text-left">
        <thead><tr className="border-b border-slate-300 text-slate-500"><th className="py-2 font-semibold">{head}</th><th className="py-2 text-right font-semibold">Monthly</th><th className="py-2 text-right font-semibold">Total Amount</th></tr></thead>
        <tbody>{rows.map(([l, m, t]) => <tr key={l} className="border-b border-slate-100"><td className="py-1.5">{l}</td><td className="py-1.5 text-right tabular-nums">{amt(m)}</td><td className="py-1.5 text-right tabular-nums">{amt(t)}</td></tr>)}</tbody>
      </table>
      <div className="mt-1 flex justify-end gap-10 py-1.5 font-bold"><span>{totalLabel}</span><span className="w-24 text-right tabular-nums">{amt(total)}</span></div>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
  return (
    <div className="mx-auto max-w-[820px] bg-white p-8 text-[13px] text-slate-900 print:p-0">
      <style>{'@page { size: A4; margin: 12mm } body { background: white !important } html { color-scheme: light }'}</style>
      <div className="flex items-start justify-between">
        <div><p className="text-xl font-extrabold uppercase">{data.company.name}</p>{data.company.address && <p className="text-slate-500">{data.company.address}</p>}</div>
        <p className="font-semibold text-slate-600">Payslip: {new Date(`${data.month}-01T00:00`).toLocaleString('en-IN', { month: 'short', year: 'numeric' })}</p>
      </div>
      <div className="mt-5 flex items-end gap-6 rounded-lg bg-slate-50 px-5 py-4">
        <div><p className="text-xs text-slate-500">Net Pay</p><p className="text-3xl font-extrabold">{amt(p.net)}</p></div>
        <span className="pb-1 text-xl text-slate-400">=</span>
        <div><p className="text-xs text-slate-500">Gross Pay (A)</p><p className="text-lg font-bold">+ {amt(p.gross)}</p></div>
        <div><p className="text-xs text-slate-500">Deductions (B)</p><p className="text-lg font-bold">− {amt(p.deductions.total)}</p></div>
      </div>
      <div className="mt-5 grid grid-cols-[190px_1fr] gap-6">
        <dl className="space-y-2.5 border-r border-slate-200 pr-4">{info.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k}><dt className="text-[11px] text-slate-500">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
        <div className="space-y-6">
          <div><p className="mb-1 font-bold">Gross Pay (A) <span className="font-normal text-slate-500">The total money you earned before the deductions</span></p>
            <Table head="Earnings" totalLabel={lopAmount > 0 ? 'Gross Pay *' : 'Gross Pay'} total={p.gross}
              rows={[...earnings.map((x) => [x.name, x.full, x.amount] as [string, number, number]), ...extras.map((l: any) => [l.label, l.amount, l.amount] as [string, number, number])]}
              note={lopAmount > 0 ? `* Loss of pay amount deducted from actual gross pay is ${amt(lopAmount)}` : undefined} /></div>
          <div><p className="mb-1 font-bold">Deductions (B) <span className="font-normal text-slate-500">The amount deducted for taxes and other benefits</span></p>
            <Table head="Deductions" totalLabel="Total Deductions" total={p.deductions.total} rows={ded.map((l: any) => [l.label === 'Provident fund' ? 'Employee PF Contribution' : l.label, l.amount, l.amount])} /></div>
          <p className="text-slate-600">Net pay in words: <b>Rupees {inWords(p.net)} Only</b></p>
        </div>
      </div>
      <p className="mt-10 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">This is a computer generated payslip and does not require a signature</p>
    </div>
  );
}
