import Joi from 'joi';
import type { CacheAuditOptions } from '../cache-audit.js';

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
