import { STATUTORY_RULES, TAX_RULES, type StatutoryRule, type TaxRule } from '@payrollpro/engines';
import { db, schema } from '../db';

let cache: { at: number; stat: StatutoryRule[]; tax: TaxRule[] } | null = null;

/** Rules come from the dated DB tables (seeded from the engine defaults). Cached for a minute. */
export async function loadRules() {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const s = await db.select().from(schema.statutoryRules);
  const t = await db.select().from(schema.taxRules);
  cache = {
    at: Date.now(),
    stat: s.length ? s.map((r) => ({ id: r.ruleKey, ruleType: r.ruleType as StatutoryRule['ruleType'], state: r.state, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, params: r.params, sourceNote: r.sourceNote })) : STATUTORY_RULES,
    tax: t.length ? t.map((r) => r.data as TaxRule) : TAX_RULES,
  };
  return cache;
}
export const clearRulesCache = () => { cache = null; };
