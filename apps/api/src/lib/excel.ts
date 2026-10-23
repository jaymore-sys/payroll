import type { Payslip } from '@payrollpro/engines';
import ExcelJS from 'exceljs';

export interface SheetRow {
  code: string; name: string; department: string; designation: string; state: string;
  panLast4: string | null; uan: string | null; hold: boolean;
  attendance?: { working: number; present: number; paidLeave: number; overtime: number } | null;
  bank: { holder: string; account: string; ifsc: string; bankName?: string } | null;
  payslip: Payslip;
}

const INR = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0'; // Indian digit grouping
const BRAND = 'FF4F46E5', HEAD_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function header(ws: ExcelJS.Worksheet, row: number) {
  const r = ws.getRow(row);
  r.font = HEAD_FONT; r.alignment = { vertical: 'middle', wrapText: true }; r.height = 32;
  r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }; c.border = { bottom: { style: 'thin' } }; });
}
function title(ws: ExcelJS.Worksheet, text: string, sub: string, span: number) {
  ws.mergeCells(1, 1, 1, span); ws.mergeCells(2, 1, 2, span);
  ws.getCell(1, 1).value = text; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BRAND } };
  ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
}
function totalsRow(ws: ExcelJS.Worksheet, rowNo: number, firstData: number, lastData: number, fromCol: number, toCol: number, label = 'Total') {
  const r = ws.getRow(rowNo);
  r.getCell(1).value = label;
  for (let c = fromCol; c <= toCol; c++) {
    const col = ws.getColumn(c).letter;
    r.getCell(c).value = { formula: `SUM(${col}${firstData}:${col}${lastData})` };
    r.getCell(c).numFmt = INR;
  }
  r.font = { bold: true };
  r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0FF' } }; c.border = { top: { style: 'thin' } }; });
}

/**
 * Salary processing workbook: Summary, Salary register, Bank transfer, Statutory summary.
 * Totals are live Excel formulas so edits in the sheet re-total; the source of truth stays the finalised run.
 */
export async function buildSalaryWorkbook(o: { company: string; month: string; label: string; status: string; rows: SheetRow[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PayrollPro'; wb.created = new Date();
  const sub = `${o.company} · Salary for ${o.label}`;

  // Component columns are the union across employees (templates can differ).
  const sm = wb.addWorksheet('Summary'); // first tab; filled in at the end
  const compNames: string[] = [];
  for (const r of o.rows) for (const e of r.payslip.earnings) if (!compNames.includes(e.name)) compNames.push(e.name);

  /* ---- Salary register ---- */
  const reg = wb.addWorksheet('Salary register', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const regCols: { h: string; w: number; v: (r: SheetRow) => string | number | null; money?: boolean }[] = [
    { h: 'Emp code', w: 11, v: (r) => r.code }, { h: 'Name', w: 22, v: (r) => r.name },
    { h: 'Department', w: 16, v: (r) => r.department }, { h: 'Designation', w: 20, v: (r) => r.designation },
    { h: 'PAN', w: 12, v: (r) => (r.panLast4 ? `XXXXXX${r.panLast4}` : 'MISSING') }, { h: 'UAN', w: 14, v: (r) => r.uan },
    { h: 'Days in month', w: 8, v: (r) => r.payslip.daysInMonth }, { h: 'Working days', w: 8, v: (r) => r.attendance?.working ?? null },
    { h: 'Present', w: 8, v: (r) => r.attendance?.present ?? null }, { h: 'Paid leave', w: 8, v: (r) => r.attendance?.paidLeave ?? null },
    { h: 'LOP days', w: 7, v: (r) => r.payslip.lopDays }, { h: 'Payable days', w: 8, v: (r) => r.payslip.payableDays },
    ...compNames.map((n) => ({ h: n, w: 13, money: true, v: (r: SheetRow) => r.payslip.earnings.find((e) => e.name === n)?.amount ?? 0 })),
    { h: 'Bonus / other earnings', w: 13, money: true, v: (r) => r.payslip.gross - r.payslip.earnings.reduce((a, e) => a + e.amount, 0) },
    { h: 'Gross earnings', w: 14, money: true, v: (r) => r.payslip.gross },
    { h: 'PF (employee)', w: 12, money: true, v: (r) => r.payslip.deductions.pf }, { h: 'ESI (employee)', w: 11, money: true, v: (r) => r.payslip.deductions.esi },
    { h: 'Professional tax', w: 11, money: true, v: (r) => r.payslip.deductions.pt }, { h: 'LWF', w: 8, money: true, v: (r) => r.payslip.deductions.lwf },
    { h: 'TDS', w: 12, money: true, v: (r) => r.payslip.deductions.tds }, { h: 'Other deductions', w: 12, money: true, v: (r) => r.payslip.deductions.other },
    { h: 'Total deductions', w: 14, money: true, v: (r) => r.payslip.deductions.total },
    { h: 'NET PAY', w: 14, money: true, v: (r) => r.payslip.net },
    { h: 'Employer PF', w: 12, money: true, v: (r) => r.payslip.employer.pf }, { h: 'Employer ESI', w: 12, money: true, v: (r) => r.payslip.employer.esi },
    { h: 'EDLI + PF admin', w: 12, money: true, v: (r) => r.payslip.employer.edli + r.payslip.employer.admin },
    { h: 'Employer LWF', w: 10, money: true, v: (r) => r.payslip.employer.lwf }, { h: 'Gratuity provision', w: 12, money: true, v: (r) => r.payslip.employer.gratuity },
    { h: 'Cost to company', w: 14, money: true, v: (r) => r.payslip.gross + r.payslip.employer.total },
    { h: 'Status', w: 10, v: (r) => (r.hold ? 'ON HOLD' : 'Pay') }, { h: 'Notes', w: 30, v: (r) => r.payslip.notes.map((n) => (n.startsWith('No earlier payslips') ? 'YTD assumed (see Summary)' : n)).join('; ') },
  ];
  title(reg, 'Salary register', sub, regCols.length);
  reg.getRow(3).values = regCols.map((c) => c.h);
  regCols.forEach((c, i) => { reg.getColumn(i + 1).width = c.w; if (c.money) reg.getColumn(i + 1).numFmt = INR; });
  header(reg, 3);
  o.rows.forEach((r) => {
    const row = reg.addRow(regCols.map((c) => c.v(r)));
    if (r.hold) row.font = { color: { argb: 'FFB45309' } };
  });
  const firstData = 4, lastData = 3 + o.rows.length;
  const firstMoney = regCols.findIndex((c) => c.money) + 1, lastMoney = regCols.length - 2;
  if (o.rows.length) totalsRow(reg, lastData + 1, firstData, lastData, firstMoney, lastMoney);
  reg.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: regCols.length } };
  const netCol = regCols.findIndex((c) => c.h === 'NET PAY') + 1;
  reg.getColumn(netCol).font = { bold: true };

  /* ---- Bank transfer (excludes salaries on hold and missing bank details) ---- */
  const bank = wb.addWorksheet('Bank transfer', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(bank, 'Bank transfer', `${sub} · upload via net banking (adapt columns to your bank's bulk template)`, 8);
  bank.getRow(3).values = ['Sr', 'Emp code', 'Beneficiary name', 'Account number', 'IFSC', 'Bank', 'Amount', 'Narration'];
  [5, 11, 26, 20, 13, 18, 14, 26].forEach((w, i) => (bank.getColumn(i + 1).width = w));
  header(bank, 3);
  const payable = o.rows.filter((r) => !r.hold && r.bank && r.payslip.net > 0);
  payable.forEach((r, i) => {
    const row = bank.addRow([i + 1, r.code, r.bank!.holder, r.bank!.account, r.bank!.ifsc, r.bank!.bankName ?? '', r.payslip.net, `Salary ${o.label}`]);
    row.getCell(4).numFmt = '@'; // keep leading zeros in account numbers
    row.getCell(7).numFmt = INR;
  });
  if (payable.length) totalsRow(bank, 4 + payable.length, 4, 3 + payable.length, 7, 7);
  const skipped = o.rows.filter((r) => !payable.includes(r));
  if (skipped.length) {
    const at = 6 + payable.length;
    bank.getCell(at, 1).value = 'Not in this file:'; bank.getCell(at, 1).font = { bold: true, color: { argb: 'FFB45309' } };
    skipped.forEach((r, i) => { bank.getCell(at + 1 + i, 2).value = r.code; bank.getCell(at + 1 + i, 3).value = `${r.name} — ${r.hold ? 'salary on hold' : !r.bank ? 'bank details missing' : 'net pay is zero'}`; });
  }

  /* ---- Statutory summary ---- */
  const st = wb.addWorksheet('Statutory');
  title(st, 'Statutory dues', `${sub} · PF & ESI by the 15th, TDS by the 7th of next month`, 4);
  st.getRow(3).values = ['Item', 'Employee', 'Employer', 'Total'];
  [34, 14, 14, 14].forEach((w, i) => (st.getColumn(i + 1).width = w));
  header(st, 3);
  const sum = (f: (p: Payslip) => number) => o.rows.reduce((a, r) => a + f(r.payslip), 0);
  const stat: [string, number, number][] = [
    ['Provident fund — EPF (A/c 1)', sum((p) => p.deductions.pf), sum((p) => p.employer.epf)],
    ['Provident fund — EPS (A/c 10)', 0, sum((p) => p.employer.eps)],
    ['EDLI (A/c 21)', 0, sum((p) => p.employer.edli)],
    ['PF admin charges (A/c 2)', 0, sum((p) => p.employer.admin)],
    ['ESI', sum((p) => p.deductions.esi), sum((p) => p.employer.esi)],
    ['Labour welfare fund', sum((p) => p.deductions.lwf), sum((p) => p.employer.lwf)],
    ['Income tax deducted (TDS, section 392)', sum((p) => p.deductions.tds), 0],
  ];
  const states = [...new Set(o.rows.map((r) => r.state || '—'))];
  for (const s of states) stat.push([`Professional tax — ${s}`, o.rows.filter((r) => (r.state || '—') === s).reduce((a, r) => a + r.payslip.deductions.pt, 0), 0]);
  stat.forEach(([label, e, er], i) => {
    const row = st.addRow([label, e, er, { formula: `B${4 + i}+C${4 + i}` }]);
    [2, 3, 4].forEach((c) => (row.getCell(c).numFmt = INR));
  });
  totalsRow(st, 4 + stat.length, 4, 3 + stat.length, 2, 4);
  st.addRow([]);
  st.addRow(['PF wage (total)', sum((p) => p.pfWage)]).getCell(2).numFmt = INR;
  st.addRow(['ESI gross (covered employees)', sum((p) => p.esiGross)]).getCell(2).numFmt = INR;
  st.addRow(['Employees covered by ESI', o.rows.filter((r) => r.payslip.esiGross > 0).length]);

  /* ---- Summary (first tab) ---- */
  title(sm, `Payroll summary — ${o.label}`, sub, 2);
  sm.getColumn(1).width = 34; sm.getColumn(2).width = 18;
  const S: [string, number | string][] = [
    ['Employees paid', o.rows.length], ['Salaries on hold', o.rows.filter((r) => r.hold).length],
    ['Gross earnings', sum((p) => p.gross)], ['Total deductions', sum((p) => p.deductions.total)],
    ['Net pay (all)', sum((p) => p.net)], ['Net pay in bank file', payable.reduce((a, r) => a + r.payslip.net, 0)],
    ['Employer contributions', sum((p) => p.employer.total)], ['Total cost to company', sum((p) => p.gross + p.employer.total)],
    ['Employees with assumed YTD for TDS', o.rows.filter((r) => r.payslip.tax.assumedEarlierMonths).length], ['Generated', new Date().toLocaleString('en-IN')],
  ];
  S.forEach(([k, v], i) => {
    const row = sm.getRow(4 + i); row.getCell(1).value = k; row.getCell(2).value = v;
    row.getCell(1).font = { bold: true };
    if (typeof v === 'number' && i >= 2 && i <= 7) row.getCell(2).numFmt = INR;
  });
  sm.getCell('A17').value = 'Assumed YTD: earlier months of this financial year were not paid through PayrollPro, so TDS assumes they were paid at the current salary. Import opening YTD for exact TDS.'; sm.mergeCells('A17:B18'); sm.getCell('A17').alignment = { wrapText: true, vertical: 'top' }; sm.getCell('A17').font = { italic: true, color: { argb: 'FF6B7280' } };
  sm.mergeCells('A16:B16'); sm.getCell('A16').alignment = { wrapText: true, vertical: 'top' }; sm.getRow(16).height = 30;
  sm.getCell('A16').value = 'Bank account numbers are confidential. Share this file only over secure channels and delete local copies after upload.';
  sm.getCell('A16').font = { italic: true, color: { argb: 'FFB91C1C' } };
  // Print-ready: landscape, one page wide, headers repeated.
  for (const ws of [sm, reg, bank, st]) ws.pageSetup = { orientation: ws === sm ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: ws === sm ? undefined : '3:3' };
  return wb;
}
