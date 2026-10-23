import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { date, inr } from '../lib/format';

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

/** Clean A4 payslip; opens the browser's print dialog so the employee can "Save as PDF". */
export default function PayslipPrint() {
  const { id = '' } = useParams();
  const { data, error } = useQuery<any>({ queryKey: ['payslip', id], queryFn: () => get(`/payslips/${id}`) });
  useEffect(() => { if (data) { document.title = `Payslip ${data.label} - ${data.employee.code}`; setTimeout(() => window.print(), 400); } }, [data]);
  if (error) return <p className="p-8">{(error as Error).message}</p>;
  if (!data) return <p className="p-8 text-sm">Preparing payslip…</p>;
  const p = data.payslip, e = data.employee;
  const earn = p.lines.filter((l: any) => l.section === 'earning'), ded = p.lines.filter((l: any) => l.section === 'deduction');
  const rows = Math.max(earn.length, ded.length);
  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-slate-900 print:p-0">
      <style>{'@page { size: A4; margin: 14mm } body { background: white !important } html { color-scheme: light }'}</style>
      <div className="flex items-start justify-between border-b-2 border-indigo-600 pb-4">
        <div><p className="text-xl font-extrabold">{data.company.name}</p>{data.company.address && <p className="text-slate-500">{data.company.address}</p>}</div>
        <div className="text-right"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Payslip</p><p className="text-lg font-bold">{data.label}</p></div>
      </div>
      <table className="mt-4 w-full text-left"><tbody>
        {[[['Employee name', `${e.firstName} ${e.lastName}`], ['Employee code', e.code]], [['Designation', e.designation ?? '—'], ['Department', e.department ?? '—']], [['Date of joining', date(e.doj)], ['PAN', e.panLast4 ? `XXXXXX${e.panLast4}` : '—']], [['UAN', e.uan ?? '—'], ['Bank account', e.bankLast4 ? `XXXXXX${e.bankLast4}` : '—']], [['Days in month', p.daysInMonth], ['Payable days / LOP', `${p.payableDays} / ${p.lopDays}`]]].map((r, i) => (
          <tr key={i}>{r.flatMap(([k, v]) => [<td key={`${k}k`} className="w-1/5 py-1 text-slate-500">{k}</td>, <td key={`${k}v`} className="w-[30%] py-1 font-semibold">{v}</td>])}</tr>))}
      </tbody></table>
      <table className="mt-5 w-full border border-slate-300 text-left">
        <thead className="bg-indigo-50"><tr><th className="border-b border-slate-300 px-3 py-2">Earnings</th><th className="border-b border-r border-slate-300 px-3 py-2 text-right">Amount (₹)</th><th className="border-b border-slate-300 px-3 py-2">Deductions</th><th className="border-b border-slate-300 px-3 py-2 text-right">Amount (₹)</th></tr></thead>
        <tbody>{Array.from({ length: rows }).map((_, i) => (
          <tr key={i}><td className="px-3 py-1.5">{earn[i]?.label ?? ''}</td><td className="border-r border-slate-300 px-3 py-1.5 text-right tabular-nums">{earn[i] ? inr(earn[i].amount).replace('₹', '') : ''}</td>
            <td className="px-3 py-1.5">{ded[i]?.label ?? ''}</td><td className="px-3 py-1.5 text-right tabular-nums">{ded[i] ? inr(ded[i].amount).replace('₹', '') : ''}</td></tr>))}
          <tr className="border-t border-slate-300 bg-slate-50 font-bold"><td className="px-3 py-2">Gross earnings</td><td className="border-r border-slate-300 px-3 py-2 text-right">{inr(p.gross).replace('₹', '')}</td><td className="px-3 py-2">Total deductions</td><td className="px-3 py-2 text-right">{inr(p.deductions.total).replace('₹', '')}</td></tr>
        </tbody>
      </table>
      <div className="mt-4 flex items-center justify-between rounded-lg bg-indigo-600 px-4 py-3 text-white"><span className="font-semibold">Net pay (in-hand)</span><span className="text-xl font-extrabold">{inr(p.net)}</span></div>
      <p className="mt-2 text-slate-600">In words: <b>Rupees {inWords(p.net)} Only</b></p>
      <div className="mt-5 grid grid-cols-2 gap-6 text-[12px]">
        <div><p className="mb-1 font-bold text-slate-500">TDS summary ({p.tax.regime} regime)</p>
          <p className="flex justify-between"><span>Projected taxable income</span><span>{inr(p.tax.projectedTaxable)}</span></p>
          <p className="flex justify-between"><span>Tax for the year</span><span>{inr(p.tax.annualTax)}</span></p>
          <p className="flex justify-between"><span>Deducted before this month</span><span>{inr(p.tax.paidSoFar)}</span></p>
          <p className="flex justify-between font-bold"><span>Deducted this month</span><span>{inr(p.tax.thisMonth)}</span></p></div>
        <div><p className="mb-1 font-bold text-slate-500">Employer contributions (not part of in-hand)</p>
          {p.lines.filter((l: any) => l.section === 'employer').map((l: any) => <p key={l.label} className="flex justify-between"><span>{l.label}</span><span>{inr(l.amount)}</span></p>)}</div>
      </div>
      <p className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">This is a computer-generated payslip and does not need a signature.</p>
    </div>
  );
}
