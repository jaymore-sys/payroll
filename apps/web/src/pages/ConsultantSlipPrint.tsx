import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { InfoColumn, Page, PrintStyles, Section, SlipHeader, Summary } from '../components/SlipParts';
import { get } from '../lib/api';

/** Consultant payment slip in the same layout as the employee payslip. Opens the print dialog unless ?view=1. */
export default function ConsultantSlipPrint() {
  const { id = '' } = useParams();
  const [qs] = useSearchParams();
  const { data: d, error } = useQuery<any>({ queryKey: ['consultant-slip', id], queryFn: () => get(`/consultant-payments/${id}`) });
  useEffect(() => {
    if (!d) return;
    document.title = `Payment slip-${d.consultant.name}-${d.month}`;
    if (!qs.get('view')) setTimeout(() => window.print(), 600);
  }, [d, qs]);
  if (error) return <p className="p-8">{(error as Error).message}</p>;
  if (!d) return <p className="p-8 text-sm">Preparing payment slip…</p>;
  const c = d.consultant;
  const feeAmount = d.amountOverride != null ? d.amount : d.amount - d.adjustment;
  const rate = d.amount ? Math.round((d.tds / d.amount) * 1000) / 10 : 0;
  return (
    <div className="min-h-dvh py-2 print:py-0">
      <PrintStyles />
      <div className="no-print mx-auto mb-2 flex max-w-[210mm] justify-end px-2"><button onClick={() => window.print()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Download PDF</button></div>
      <Page n={1} of={1}>
        <SlipHeader company={d.company.name} month={d.month} />
        <Summary net={d.net} gross={d.amount} deductions={d.tds} grossLabel="Fees (A)" dedLabel="TDS (B)" />
        <div className="relative mt-6 grid grid-cols-[44mm_1fr] gap-4">
          <InfoColumn rows={[
            ['Consultant Code', c.code], ['Name', c.name], ['PAN', c.pan ?? 'Not provided'], ['Email', c.email],
            ['Account no.', c.account], ['IFSC code', c.ifsc], ['Days in month', d.daysInMonth], ['LOP Days', d.lopDays || null], ['TDS rate', `${rate}%`],
          ]} />
          <div>
            <Section t="green" title="Fees (A)" sub="Professional fees for the month" head={['Description', 'Monthly', 'Total Amount']}
              rows={[['Professional fee', d.fee, feeAmount], ...(d.amountOverride == null && d.adjustment ? [['Adjustment', d.adjustment, d.adjustment]] : [])]}
              total={['Gross Fees', d.amount]} note={d.lopDays > 0 ? `Fee reduced for ${d.lopDays} LOP day(s)` : undefined} />
            <Section t="orange" title="Deductions (B)" sub="Tax deducted at source on professional fees (Income-tax Act 2025, s.393)" head={['Deductions', 'Rate', 'Total Amount']}
              rows={[['TDS on professional fees', `${rate}%`, d.tds]]} total={['Total Deductions', d.tds]} />
            {d.note && <p className="pl-5 text-[10.5px] text-slate-500">Note: {d.note}</p>}
          </div>
        </div>
      </Page>
    </div>
  );
}
