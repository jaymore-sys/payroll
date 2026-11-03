import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { amt, dmy, InfoColumn, Page, PrintStyles, Section, shortMonth, SlipHeader, Summary } from '../components/SlipParts';
import { get } from '../lib/api';

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

/** Employee payslip in the RazorpayX layout: page 1 pay, page 2 the tax computation. Opens the print dialog ("Save as PDF") unless ?view=1. */
export default function PayslipPrint() {
  const { id = '' } = useParams();
  const [qs] = useSearchParams();
  const { data, error } = useQuery<any>({ queryKey: ['payslip', id], queryFn: () => get(`/payslips/${id}`) });
  useEffect(() => {
    if (!data) return;
    document.title = `Payslip-${data.employee.firstName} ${data.employee.lastName}-${data.label}`;
    if (!qs.get('view')) setTimeout(() => window.print(), 600);
  }, [data, qs]);
  if (error) return <p className="p-8">{(error as Error).message}</p>;
  if (!data) return <p className="p-8 text-sm">Preparing payslip…</p>;

  const p = data.payslip, e = data.employee, t = p.tax ?? {};
  const intern = e.employmentType === 'intern' || p.intern;
  const extras = p.lines.filter((l: any) => l.section === 'earning' && !p.earnings.some((x: any) => x.name === l.label)).map((l: any) => [l.label === 'Arrears' ? 'Arrear' : l.label, l.amount, l.amount]);
  const lopAmount = p.earnings.reduce((s: number, x: any) => s + x.full - x.amount, 0);
  const ded = p.lines.filter((l: any) => l.section === 'deduction').map((l: any) => [l.label, l.amount, l.amount]);
  const w = (label: string) => (t.worksheet ?? []).find((l: any) => l.label.startsWith(label))?.amount ?? 0;
  const yearly: { name: string; gross: number; exempt: number; taxable: number }[] = t.yearly ?? [];
  const showTax = !intern && yearly.length > 0;
  const pages = showTax ? 2 : 1;
  const annualTaxable = yearly.reduce((s, y) => s + y.taxable, 0) + (t.prevEmployer?.taxable ?? 0);
  const deductedTillDate = t.paidSoFar ?? 0;
  const netTax = t.annualTax ?? 0;

  return (
    <div className="min-h-dvh py-2 print:py-0">
      <PrintStyles />
      <div className="no-print mx-auto mb-2 flex max-w-[210mm] justify-end gap-2 px-2">
        <button onClick={() => window.print()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Download PDF</button>
      </div>
      <Page n={1} of={pages}>
        <SlipHeader company={data.company.name} month={data.month} />
        <Summary net={p.net} gross={p.gross} deductions={p.deductions.total} />
        <div className="relative mt-6 grid grid-cols-[44mm_1fr] gap-4">
          <InfoColumn rows={[
            ['Employee Code', e.code?.replace(/^EMP0*/, '') || e.code], ['Name', `${e.firstName} ${e.lastName}`], ['Date of birth', dmy(e.dob)], ['PAN', e.pan],
            ['UAN', e.uan], ['Account no.', e.account], ['IFSC code', e.ifsc], ['Date of joining', dmy(e.doj)],
            ['Payable Days', p.payableDays], ['LOP Days', p.lopDays || null], ['Regime Opted', intern ? null : t.regime === 'old' ? 'Old Regime' : 'New Regime'],
          ]} />
          <div>
            <Section t="green" title="Gross Pay (A)" sub="The total money you earned before the deductions" head={['Earnings', 'Monthly', 'Total Amount']}
              rows={[...p.earnings.map((x: any) => [x.name, x.full, x.amount]), ...extras]}
              total={[lopAmount > 0 ? 'Gross Pay *' : 'Gross Pay', p.gross]}
              note={lopAmount > 0 ? `* Loss of pay amount deducted from actual gross pay is ${amt(lopAmount)}` : undefined} />
            {ded.length > 0 && <Section t="orange" title="Deductions (B)" sub="The amount deducted for taxes and other benefits" head={['Deductions', 'Monthly', 'Total Amount']}
              rows={ded} total={['Total Deductions', p.deductions.total]} />}
          </div>
        </div>
        {showTax && <div className="mt-2">
          <Section t="blue" title="Yearly Taxable Income (C)" sub="The money you will earn annually excluding the exemptions you declare" head={['Description', 'Gross', 'Exempted', 'Taxable']}
            rows={[...yearly.map((y) => [y.name, y.gross, y.exempt, y.taxable]), ...(t.prevEmployer?.taxable ? [['Previous employer income', t.prevEmployer.taxable, 0, t.prevEmployer.taxable]] : [])]}
            total={['Annual Taxable Salary', annualTaxable]} />
        </div>}
      </Page>

      {showTax && <Page n={2} of={2}>
        <Section t="green" title="Net Taxable Income (E)" sub="Your taxes are calculated on this amount after considering all investments you claimed to save taxes" head={['Details', 'Amount']}
          rows={[
            ['Annual Taxable Salary(C)', annualTaxable],
            ['Standard Deductions (Section 16)', -w('Standard deduction')],
            ...(w('Professional tax') ? [['Professional Tax (Section 16)', -w('Professional tax')]] : []),
            ...(w('80C') ? [['Section 80C', -w('80C')]] : []),
            ...(w('80D') ? [['Section 80D', -w('80D')]] : []),
            ...(w('80CCD(1B)') ? [['Section 80CCD(1B)', -w('80CCD(1B)')]] : []),
            ...(w('Employer NPS') ? [['Section 80CCD(2)', -w('Employer NPS')]] : []),
            ...(w('Home loan') ? [['Section 24(b)', -w('Home loan')]] : []),
          ]} total={['Net Taxable Income', w('Taxable income')]} />
        <Section t="orange" title={`Tax for ${data.month >= `${data.month.slice(0, 4)}-04` ? `${data.month.slice(0, 4)} - ${String(Number(data.month.slice(0, 4)) + 1).slice(2)}` : `${Number(data.month.slice(0, 4)) - 1} - ${data.month.slice(2, 4)}`}`}
          sub="Tax will be deducted on this Net Taxable Salary after all exemptions" head={['Details', 'Amount']}
          rows={[
            ['Tax on Taxable Income', w('Slab tax')],
            ...(w('Rebate 87A') ? [['Tax Rebate u/s 87A', w('Rebate 87A')]] : []),
            ...(w('Surcharge') ? [['Surcharge', w('Surcharge')]] : []),
            ...(w('Health & education cess') ? [['Health & Education Cess', w('Health & education cess')]] : []),
            ['Net Tax', netTax],
            ['Tax Deducted Till Date (Current Employer)', deductedTillDate],
          ]} total={['Tax To Be Deducted This Year', Math.max(0, netTax - deductedTillDate)]} />
        <div className="mb-5">
          <p className="mb-2 text-[11.5px] font-bold">Tax for {shortMonth(data.month)} <span className="ml-3 text-[9.5px] font-normal text-slate-500">Tax to be deducted (F) / No. of payroll executions left in this financial year</span></p>
          <div className="flex justify-between bg-rose-50/60 px-3 py-2.5"><span className="text-slate-500">Tax to be deducted this month</span><span>{amt(p.deductions.tds)}</span></div>
          <div className="flex justify-end gap-10 bg-rose-50 px-3 py-2.5 font-bold"><span>Tax Deducted This Month</span><span className="min-w-[60px] text-right">{amt(p.deductions.tds)}</span></div>
        </div>
        {data.monthlyTax?.length > 0 && <div className="relative pl-5">
          <span className="absolute bottom-3 left-0 top-3 w-[1.5px] bg-indigo-500" /><span className="absolute left-0 top-3 h-[1.5px] w-5 bg-indigo-500" />
          <p className="mb-3 flex items-center gap-2 pl-2 text-[11.5px] font-bold">Monthly tax<span className="h-1.5 w-1.5 rotate-45 bg-indigo-400" /><span className="text-[9.5px] font-normal text-slate-500">Projected TDS for rest of the year are marked with <span className="text-indigo-500">*</span></span></p>
          <div className="grid grid-cols-6 gap-y-4 bg-indigo-50/50 px-3 py-3">
            {data.monthlyTax.map((m: any) => <div key={m.month}><p className="text-[10.5px] text-slate-500">{m.label}{m.projected && <span className="text-indigo-500"> *</span>}</p><p className="text-[11px]">{amt(m.amount)}</p></div>)}
          </div>
          <p className="mt-2 pl-2 text-[9.5px] text-slate-500"><span className="text-indigo-500">*</span> These may change if there is a change in your income</p>
        </div>}
      </Page>}
    </div>
  );
}
