import { daysInMonth, taxYearOf } from '@payrollpro/engines';
import { and, asc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, schema } from '../db';
import { audit } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { decryptJson, encrypt, encryptJson } from '../lib/crypto';
import { ApiError, h, notFound, parse } from '../lib/http';
import { rowsFromXlsx } from './attendance';

/**
 * Consultants (spec: non-employee payees). Fixed monthly fee, cut for leave by days in the month, TDS on professional
 * fees (Income-tax Act 2025 s.393, table sl. 6: 10%, 2% for technical services, 20% without PAN, ₹50,000 a year threshold).
 * No PF, ESI or professional tax.
 */
export const consultantsRouter = Router();
const C = schema.consultants, R = schema.consultantRuns, P = schema.consultantPayments;
const ADMIN = ['COMPANY_ADMIN', 'PAYROLL_MANAGER'] as const;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const THRESHOLD = 50000; // ponytail: one threshold for all payees; per-section thresholds if other payment types are added
const PAN = z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN format'));
const bank = z.object({ account: z.string().regex(/^\d{6,18}$/, '6–18 digits'), ifsc: z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC')) });
const body = z.object({
  code: z.string().max(20).nullish(), name: z.string().min(2).max(120), email: z.string().email().nullish().or(z.literal('').transform(() => null)),
  pan: PAN.nullish().or(z.literal('').transform(() => null)), bank: bank.nullish(),
  monthlyFee: z.number().positive().max(1e8), tdsRate: z.number().min(0).max(0.3).default(0.1),
  startDate: z.string().date(), endDate: z.string().date().nullish().or(z.literal('').transform(() => null)), active: z.boolean().default(true),
});

const show = (c: typeof C.$inferSelect) => ({
  id: c.id, code: c.code, name: c.name, email: c.email, panLast4: c.panLast4, hasPan: !!c.panEnc, bankLast4: c.bankLast4, hasBank: !!c.bankEnc,
  monthlyFee: Number(c.monthlyFee), tdsRate: Number(c.tdsRate), startDate: c.startDate, endDate: c.endDate, active: c.active,
});
const secrets = (d: { pan?: string | null; bank?: { account: string; ifsc: string } | null }, name: string) => ({
  ...(d.pan !== undefined ? { panEnc: d.pan ? encrypt(d.pan) : null, panLast4: d.pan ? d.pan.slice(-4) : null } : {}),
  ...(d.bank !== undefined ? { bankEnc: d.bank ? encryptJson({ holder: name, ...d.bank }) : null, bankLast4: d.bank ? d.bank.account.slice(-4) : null } : {}),
});

consultantsRouter.get('/consultants', requireRole(...ADMIN), h(async (req, res) => {
  res.json((await db.select().from(C).where(eq(C.companyId, req.user!.cid)).orderBy(asc(C.name))).map(show));
}));
consultantsRouter.post('/consultants', requireRole(...ADMIN), h(async (req, res) => {
  const { pan, bank: b, ...d } = parse(body, req.body);
  const [c] = await db.insert(C).values({ ...d, companyId: req.user!.cid, monthlyFee: String(d.monthlyFee), tdsRate: String(d.tdsRate), ...secrets({ pan, bank: b }, d.name) }).returning();
  await audit(req, 'create', 'consultant', c.id, undefined, show(c));
  res.status(201).json(show(c));
}));
consultantsRouter.put('/consultants/:id', requireRole(...ADMIN), h(async (req, res) => {
  const { pan, bank: b, monthlyFee, tdsRate, ...d } = parse(body.partial(), req.body);
  const [old] = await db.select().from(C).where(and(eq(C.companyId, req.user!.cid), eq(C.id, req.params.id)));
  if (!old) throw notFound('Consultant');
  const [c] = await db.update(C).set({ ...d, ...(monthlyFee !== undefined ? { monthlyFee: String(monthlyFee) } : {}), ...(tdsRate !== undefined ? { tdsRate: String(tdsRate) } : {}), ...secrets({ pan, bank: b }, d.name ?? old.name) })
    .where(eq(C.id, old.id)).returning();
  await audit(req, 'update', 'consultant', c.id, show(old), show(c));
  res.json(show(c));
}));

/* ---------- monthly payment ---------- */
const bounds = (m: string) => ({ first: `${m}-01`, last: `${m}-${String(daysInMonth(m)).padStart(2, '0')}` });
async function eligible(cid: string, month: string) {
  const { first, last } = bounds(month);
  return db.select().from(C).where(and(eq(C.companyId, cid), eq(C.active, true), lte(C.startDate, last), or(isNull(C.endDate), gte(C.endDate, first)))).orderBy(asc(C.name));
}
async function runFor(cid: string, month: string) {
  const [run] = await db.select().from(R).where(and(eq(R.companyId, cid), eq(R.month, month)));
  return run;
}
/** Days the consultant is engaged in the month (start/end dates clip it). */
const engagedDays = (c: typeof C.$inferSelect, month: string) => {
  const { first, last } = bounds(month);
  const from = c.startDate > first ? Number(c.startDate.slice(8, 10)) : 1;
  const to = c.endDate && c.endDate < last ? Number(c.endDate.slice(8, 10)) : daysInMonth(month);
  return Math.max(0, to - from + 1);
};

consultantsRouter.get('/consultant-runs/:month', requireRole(...ADMIN), h(async (req, res) => {
  const month = parse(MONTH, req.params.month), cid = req.user!.cid;
  const run = await runFor(cid, month);
  const pays = run ? new Map((await db.select().from(P).where(eq(P.runId, run.id))).map((p) => [p.consultantId, p])) : new Map();
  const list = await eligible(cid, month);
  res.json({
    month, daysInMonth: daysInMonth(month), run: run ?? null,
    items: list.map((c) => {
      const p = pays.get(c.id);
      return { ...show(c), engagedDays: engagedDays(c, month), lopDays: p ? Number(p.lopDays) : 0, adjustment: p ? Number(p.adjustment) : 0, note: p?.note ?? null,
        amount: p?.amount != null ? Number(p.amount) : null, tds: p?.tds != null ? Number(p.tds) : null, net: p?.net != null ? Number(p.net) : null };
    }),
  });
}));

/** Read LOP for consultants from the monthly attendance sheet (matched by name). Nothing is saved. */
consultantsRouter.post('/consultant-runs/:month/import', requireRole(...ADMIN), h(async (req, res) => {
  const month = parse(MONTH, req.params.month);
  const { fileBase64 } = parse(z.object({ fileBase64: z.string().max(3_000_000) }), req.body);
  const { rows, sheetMonth } = await rowsFromXlsx(fileBase64);
  if (sheetMonth && sheetMonth !== month) throw new ApiError(422, 'wrong_month', `This sheet is for ${sheetMonth}, but you are working on ${month}`);
  const list = await eligible(req.user!.cid, month);
  const nm = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const found: { consultantId: string; name: string; lopDays: number }[] = [];
  for (const c of list) {
    const r = rows.find((x) => x.name !== undefined && (nm(x.name) === nm(c.name) || nm(c.name).startsWith(`${nm(x.name)} `)));
    if (!r) continue;
    const lop = r.lopDays !== undefined ? Number(r.lopDays) : r.payableDays !== undefined ? Math.max(0, daysInMonth(month) - Number(r.payableDays)) : 0;
    found.push({ consultantId: c.id, name: c.name, lopDays: Math.round(lop * 10) / 10 });
  }
  res.json({ found, notInSheet: list.filter((c) => !found.some((f) => f.consultantId === c.id)).map((c) => c.name) });
}));

consultantsRouter.post('/consultant-runs/:month/calculate', requireRole(...ADMIN), h(async (req, res) => {
  const month = parse(MONTH, req.params.month), cid = req.user!.cid;
  const { items } = parse(z.object({ items: z.array(z.object({ consultantId: z.string().uuid(), lopDays: z.number().min(0).max(31).multipleOf(0.1), adjustment: z.number().min(-1e8).max(1e8).default(0), note: z.string().max(200).nullish() })).max(2000) }), req.body);
  let run = await runFor(cid, month);
  if (run?.status === 'FINALISED') throw new ApiError(409, 'approved', 'This month is approved; reopen it to make changes');
  const list = await eligible(cid, month);
  const input = new Map(items.map((i) => [i.consultantId, i]));
  const dim = daysInMonth(month);
  // FY-to-date from approved months: amounts paid and TDS already deducted (for the ₹50,000 threshold).
  const fyFirst = `${taxYearOf(month).slice(0, 4)}-04`;
  const ytd = new Map((await db.select({ c: P.consultantId, paid: sql<number>`sum(${P.amount})::float`, tds: sql<number>`sum(${P.tds})::float` }).from(P).innerJoin(R, eq(R.id, P.runId))
    .where(and(eq(P.companyId, cid), eq(R.status, 'FINALISED'), gte(R.month, fyFirst), lt(R.month, month))).groupBy(P.consultantId)).map((r) => [r.c, r]));
  const rows = list.map((c) => {
    const i = input.get(c.id) ?? { lopDays: 0, adjustment: 0, note: null };
    const days = Math.max(0, engagedDays(c, month) - i.lopDays);
    const amount = Math.max(0, Math.round((Number(c.monthlyFee) * days) / dim + i.adjustment));
    const rate = c.panEnc ? Number(c.tdsRate) : Math.max(Number(c.tdsRate), 0.2);
    const y = ytd.get(c.id) ?? { paid: 0, tds: 0 };
    // Below ₹50,000 for the year: no TDS. Crossing it: deduct on the whole year so far (catch-up), then on each payment.
    const base = y.paid + amount <= THRESHOLD ? 0 : !y.tds ? y.paid + amount : amount;
    const tds = Math.round(base * rate);
    return { companyId: cid, consultantId: c.id, fee: c.monthlyFee, daysInMonth: dim, lopDays: String(i.lopDays), adjustment: String(i.adjustment), note: i.note ?? null, amount: String(amount), tds: String(tds), net: String(amount - tds) };
  });
  const sum = (k: 'amount' | 'tds' | 'net') => rows.reduce((a, r) => a + Number(r[k]), 0);
  const totals = { consultants: rows.length, amount: sum('amount'), tds: sum('tds'), net: sum('net') };
  await db.transaction(async (tx) => {
    if (!run) [run] = await tx.insert(R).values({ companyId: cid, month, createdBy: req.user!.sub }).returning();
    await tx.delete(P).where(eq(P.runId, run.id));
    if (rows.length) await tx.insert(P).values(rows.map((r) => ({ ...r, runId: run!.id })));
    await tx.update(R).set({ status: 'CALCULATED', totals, calculatedAt: new Date() }).where(eq(R.id, run.id));
  });
  await audit(req, 'calculate', 'consultant_run', run!.id, undefined, totals);
  res.json({ totals });
}));

const setStatus = (to: 'FINALISED' | 'CALCULATED', from: 'CALCULATED' | 'FINALISED') => h(async (req: Request, res) => {
  const month = parse(MONTH, req.params.month);
  const [u] = await db.update(R).set({ status: to, approvedAt: to === 'FINALISED' ? new Date() : null, approvedBy: to === 'FINALISED' ? req.user!.sub : null })
    .where(and(eq(R.companyId, req.user!.cid), eq(R.month, month), eq(R.status, from))).returning({ id: R.id });
  if (!u) throw new ApiError(409, 'wrong_state', to === 'FINALISED' ? 'Calculate the payments before approving' : 'This month is not approved');
  await audit(req, to === 'FINALISED' ? 'approve' : 'reopen', 'consultant_run', u.id);
  res.json({ ok: true });
});
consultantsRouter.post('/consultant-runs/:month/approve', requireRole('COMPANY_ADMIN'), setStatus('FINALISED', 'CALCULATED'));
consultantsRouter.post('/consultant-runs/:month/reopen', requireRole('COMPANY_ADMIN'), setStatus('CALCULATED', 'FINALISED'));

consultantsRouter.get('/consultant-runs/:month/export.xlsx', requireRole(...ADMIN), h(async (req, res) => {
  const month = parse(MONTH, req.params.month), cid = req.user!.cid;
  const run = await runFor(cid, month);
  if (run?.status !== 'FINALISED') throw new ApiError(409, 'not_approved', 'Approve the payments first');
  const rows = await db.select({ p: P, c: C }).from(P).innerJoin(C, eq(C.id, P.consultantId)).where(eq(P.runId, run.id)).orderBy(asc(C.name));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const INR = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet, title: string, cols: [string, number][]) => {
    ws.addRow([`${company.legalName ?? company.name} · ${title} · ${label}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const r = ws.addRow(cols.map(([c]) => c)); r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; });
    cols.forEach(([, w], i) => (ws.getColumn(i + 1).width = w));
  };
  const pay = wb.addWorksheet('Consultant payments');
  head(pay, 'Consultant payments', [['Code', 10], ['Name', 26], ['PAN', 13], ['Monthly fee', 13], ['Days', 7], ['LOP', 7], ['Adjustment', 12], ['Amount', 13], ['TDS %', 7], ['TDS', 11], ['Net payable', 13], ['Note', 28]]);
  for (const { p, c } of rows) {
    const r = pay.addRow([c.code ?? '', c.name, c.panLast4 ? `XXXXXX${c.panLast4}` : 'MISSING', Number(p.fee), p.daysInMonth, Number(p.lopDays), Number(p.adjustment), Number(p.amount), Number(p.amount) ? Math.round((Number(p.tds) / Number(p.amount)) * 1000) / 10 : 0, Number(p.tds), Number(p.net), p.note ?? '']);
    [4, 7, 8, 10, 11].forEach((i) => (r.getCell(i).numFmt = INR));
  }
  const t = pay.addRow(['', 'Total', '', null, null, null, null, { formula: `SUM(H4:H${3 + rows.length})` }, null, { formula: `SUM(J4:J${3 + rows.length})` }, { formula: `SUM(K4:K${3 + rows.length})` }]);
  t.font = { bold: true }; [8, 10, 11].forEach((i) => (t.getCell(i).numFmt = INR));
  const bankWs = wb.addWorksheet('Bank transfer');
  head(bankWs, 'Bank transfer', [['Sr', 5], ['Beneficiary name', 28], ['Account number', 20], ['IFSC', 13], ['Amount', 13], ['Narration', 30]]);
  rows.filter(({ p, c }) => c.bankEnc && Number(p.net) > 0).forEach(({ p, c }, i) => {
    const b = decryptJson<{ account: string; ifsc: string }>(c.bankEnc!);
    const r = bankWs.addRow([i + 1, c.name, b.account, b.ifsc, Number(p.net), `Professional fees ${label}`]);
    r.getCell(3).numFmt = '@'; r.getCell(5).numFmt = INR;
  });
  const missing = rows.filter(({ c }) => !c.bankEnc).map(({ c }) => c.name);
  if (missing.length) bankWs.addRow([]).getCell(1).value = `Not included (bank details missing): ${missing.join(', ')}`;
  const tdsTotal = rows.reduce((a, { p }) => a + Number(p.tds), 0);
  const sumWs = wb.addWorksheet('TDS');
  head(sumWs, 'TDS on professional fees (s.393)', [['Item', 40], ['Amount', 16]]);
  [['Consultants paid', rows.length], ['Total fees', rows.reduce((a, { p }) => a + Number(p.amount), 0)], ['TDS to deposit by the 7th of next month', tdsTotal], ['Net paid to consultants', rows.reduce((a, { p }) => a + Number(p.net), 0)]]
    .forEach(([k, v], i) => { const r = sumWs.addRow([k, v]); if (i) r.getCell(2).numFmt = INR; });
  await audit(req, 'export_consultant_sheet', 'consultant_run', run.id, undefined, { month, rows: rows.length });
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="consultants-${month}.xlsx"`, 'Cache-Control': 'no-store' });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));
