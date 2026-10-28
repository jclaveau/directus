import { CACHE_AUDIT_VERDICTS } from "../cache-audit.js";
import Joi from "joi";

//#region src/utils/cache-audit-options.ts
/**
* What a caller may narrow an audit by, as `POST /utils/cache/audit` and the
* `run_cache_audit` MCP tool both read it — one schema, so a limit the route
* refuses is one the tool refuses too.
*/
const CacheAuditOptionsSchema = Joi.object({
	limit: Joi.number().integer().min(1),
	user: Joi.string(),
	collection: Joi.string(),
	ignore: Joi.array().items(Joi.string().pattern(/^\//)).single().default([]),
	purge: Joi.boolean().default(false)
});
const FINDINGS_PAGE = 100;
const FINDINGS_PAGE_MAX = 1e3;
/**
* The page of findings a run read answers, as `GET /utils/cache/audits/:id`
* and the `read_cache_audit` MCP tool both take it: the same schema, so the
* two agree on the default page and on how much one may ask for.
*/
const CacheAuditFindingsPageSchema = Joi.object({
	limit: Joi.number().integer().min(1).max(FINDINGS_PAGE_MAX).default(FINDINGS_PAGE),
	offset: Joi.number().integer().min(0).default(0),
	verdict: Joi.string().valid(...CACHE_AUDIT_VERDICTS.filter((verdict) => verdict !== "fresh"))
});

//#endregion
export { CacheAuditFindingsPageSchema, CacheAuditOptionsSchema };