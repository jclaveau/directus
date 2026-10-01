import Joi from 'joi';
import { CACHE_AUDIT_VERDICTS, type CacheAuditOptions } from '../cache-audit.js';
import type { CacheAuditFindingsPage } from '../cache-audit-runs.js';

/**
 * What a caller may narrow an audit by, as `POST /utils/cache/audit` and the
 * `run_cache_audit` MCP tool both read it — one schema, so a limit the route
 * refuses is one the tool refuses too.
 */
export const CacheAuditOptionsSchema = Joi.object<
	Pick<CacheAuditOptions, 'limit' | 'user' | 'collection'>
	& { ignore: string[]; purge: boolean }
>({
	limit: Joi.number()
		.integer()
		.min(1),
	user: Joi.string(),
	collection: Joi.string(),
	ignore: Joi.array()
		.items(Joi.string().pattern(/^\//))
		.single()
		.default([]),
	purge: Joi.boolean().default(false),
});

const FINDINGS_PAGE = 100;
const FINDINGS_PAGE_MAX = 1000;

/**
 * The page of findings a run read answers, as `GET /utils/cache/audits/:id`
 * and the `read_cache_audit` MCP tool both take it: the same schema, so the
 * two agree on the default page and on how much one may ask for.
 */
export const CacheAuditFindingsPageSchema = Joi.object<CacheAuditFindingsPage>({
	limit: Joi.number()
		.integer()
		.min(1)
		.max(FINDINGS_PAGE_MAX)
		.default(FINDINGS_PAGE),
	offset: Joi.number()
		.integer()
		.min(0)
		.default(0),
	// A fresh entry stores no finding, so a page of them is not a thing to ask.
	verdict: Joi.string().valid(
		...CACHE_AUDIT_VERDICTS.filter((verdict) => verdict !== 'fresh'),
	),
});
