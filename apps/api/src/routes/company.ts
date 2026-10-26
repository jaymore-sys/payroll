import { and, asc, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { db, schema } from '../db';
import type { Role } from '../db/schema';
import { audit } from '../lib/audit';
import { needsRecalc } from '../lib/runs';
import { requireRole } from '../lib/auth';
import { h, notFound, parse } from '../lib/http';

export const companyRouter = Router();
const C = schema.companies;
const PAN = z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN');
const TAN = z.string().regex(/^[A-Z]{4}\d{5}[A-Z]$/, 'Invalid TAN');
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullish().or(z.literal('').transform(() => null));

const companySchema = z.object({
  name: z.string().min(2).max(200), legalName: opt(z.string().max(200)), pan: opt(PAN), tan: opt(TAN),
  cin: opt(z.string().max(30)), gstin: opt(z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN')), address: opt(z.string().max(500)),
  fyStartMonth: z.number().int().min(1).max(12), payDay: z.number().int().min(1).max(31), cutoffDay: z.number().int().min(1).max(31),
  payableDaysMethod: z.enum(['calendar', 'fixed30', 'working']), pfCapMode: z.enum(['capped', 'actual']),
  labourCodeMode: z.boolean(), twoPersonRule: z.boolean(), esiEnabled: z.boolean(),
  weekPattern: z.object({ weeklyOffs: z.array(z.number().int().min(0).max(6)).max(7), offSaturdaysOfMonth: z.array(z.number().int().min(1).max(5)).max(5).optional() }).strict(), employeeCodePrefix: z.string().regex(/^[A-Z0-9-]{1,8}$/),
}).partial();

companyRouter.get('/company', h(async (req, res) => {
  const [c] = await db.select().from(C).where(eq(C.id, req.user!.cid));
  res.json(c);
}));
companyRouter.put('/company', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const data = parse(companySchema, req.body);
  const [before] = await db.select().from(C).where(eq(C.id, req.user!.cid));
  const [after] = await db.update(C).set(data).where(eq(C.id, req.user!.cid)).returning();
  await needsRecalc(req.user!.cid);
  await audit(req, 'update', 'company', after.id, before, after);
  res.json(after);
}));

/** Company-scoped CRUD for simple master tables. companyId always comes from the token, never the body. */
function crud(path: string, table: PgTable & { id: any; companyId: any }, body: ZodObject<ZodRawShape>, readRoles: Role[] | 'all', order: any) {
  const scope = (cid: string, id?: string) => (id ? and(eq(table.companyId, cid), eq(table.id, id)) : eq(table.companyId, cid));
  const read = readRoles === 'all' ? [] : [requireRole(...readRoles)];
  companyRouter.get(`/${path}`, ...read, h(async (req, res) => {
    res.json(await db.select().from(table).where(scope(req.user!.cid)).orderBy(asc(order)));
  }));
  companyRouter.post(`/${path}`, requireRole('COMPANY_ADMIN'), h(async (req, res) => {
    const data = parse(body, req.body);
    const [row] = await db.insert(table).values({ ...data, companyId: req.user!.cid } as any).returning();
    await audit(req, 'create', path, (row as any).id, undefined, row);
    res.status(201).json(row);
  }));
  companyRouter.put(`/${path}/:id`, requireRole('COMPANY_ADMIN'), h(async (req, res) => {
    const data = parse(body.partial(), req.body);
    const [before] = await db.select().from(table).where(scope(req.user!.cid, req.params.id));
    if (!before) throw notFound();
    const [row] = await db.update(table).set(data as any).where(scope(req.user!.cid, req.params.id)).returning();
    await audit(req, 'update', path, req.params.id, before, row);
    res.json(row);
  }));
  companyRouter.delete(`/${path}/:id`, requireRole('COMPANY_ADMIN'), h(async (req, res) => {
    const [row] = await db.delete(table).where(scope(req.user!.cid, req.params.id)).returning();
    if (!row) throw notFound();
    await audit(req, 'delete', path, req.params.id, row);
    res.status(204).end();
  }));
}

const uuidOpt = opt(z.string().uuid());
crud('entities', schema.entities, z.object({ name: z.string().min(2).max(200), pan: opt(PAN), tan: opt(TAN), pfCode: opt(z.string().max(30)), esiCode: opt(z.string().max(30)) }), ['COMPANY_ADMIN', 'PAYROLL_MANAGER'], schema.entities.name);
crud('branches', schema.branches, z.object({ name: z.string().min(2).max(200), state: z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter state code'), city: opt(z.string().max(100)), metro: z.boolean().default(false), entityId: uuidOpt, ptRegNo: opt(z.string().max(40)), lwfRegNo: opt(z.string().max(40)) }), 'all', schema.branches.name);
crud('departments', schema.departments, z.object({ name: z.string().min(1).max(100) }), 'all', schema.departments.name);
crud('designations', schema.designations, z.object({ name: z.string().min(1).max(100) }), 'all', schema.designations.name);
crud('holidays', schema.holidays, z.object({ date: z.string().date(), name: z.string().min(1).max(100), state: opt(z.string().regex(/^[A-Z]{2}$/)), restricted: z.boolean().default(false) }), 'all', schema.holidays.date);
