import { QUERY_AUDIT_LEVELS, closeQueryAudit, discardAuditedStatements, emptyQueryAudit, formatQueryAudit, isQueryAuditLevel, levelCarriesBindings, queryAuditStore } from "../database/query-audit.js";
import { useEnv } from "@directus/env";
import { InvalidQueryError } from "@directus/errors";
import { parse } from "bytes";

//#region src/middleware/query-audit.ts
/**
* Dev-only: QUERY_AUDIT_HEADER names the header reporting the SQL this request
* ran, one entry per transaction. A request sends the same header to pick how
* much: `counts`, `statements`, `bindings` for each run's bound values, or
* `full` for every run in order; QUERY_AUDIT_LEVEL is the level of a request
* that sends none. A second word, `no-timings`, leaves out every `ms`, `db` and
* `wait`, so two runs of a request report the same header:
* `statements; no-timings`, or `no-timings` alone at QUERY_AUDIT_LEVEL.
*
* Bound values carry what the request read and wrote, so `bindings` and `full`
* report them to an admin alone: anyone else gets `statements`. Whether the
* request is an admin's is known once it has authenticated, after this
* middleware: until then the values are recorded on the ask, and dropped at
* flush for anyone else.
*
* Written when the headers flush rather than in `respond`, so an error response
* and a route that bypasses `respond` carry it too.
*/
const auditRequestQueries = (req, res, next) => {
	const env = useEnv();
	const headerName = `${env["QUERY_AUDIT_HEADER"]}`;
	const auditAsk = auditAskOf(req.get(headerName), env["QUERY_AUDIT_LEVEL"]);
	if (auditAsk === void 0) return next(new InvalidQueryError({ reason: `"${headerName}" must be a level, a timings word, or both as "<level>; <timings word>". Levels: ${QUERY_AUDIT_LEVELS.join(", ")}. Timings words: ${TIMINGS_WORDS.join(", ")}` }));
	const requestedLevel = auditAsk.level;
	const audit = emptyQueryAudit(requestedLevel, () => {
		return req.accountability === void 0 || req.accountability.admin;
	});
	const writeHead = res.writeHead;
	res.once("close", () => {
		closeQueryAudit(audit);
		discardAuditedStatements(audit);
	});
	res.writeHead = function(...headArguments) {
		closeQueryAudit(audit);
		this.setHeader(headerName, formatQueryAudit(audit, {
			level: levelCarriesBindings(requestedLevel) && !req.accountability?.admin ? "statements" : requestedLevel,
			maxSize: parse(String(env["QUERY_AUDIT_HEADER_MAX_SIZE"])) ?? 0,
			timings: auditAsk.timings
		}));
		discardAuditedStatements(audit);
		return writeHead.apply(this, headArguments);
	};
	queryAuditStore.run(audit, next);
};
const TIMINGS_WORDS = ["timings", "no-timings"];
function auditAskOf(askedValue, instanceLevel) {
	const askedWords = askedValue === void 0 ? [] : askedValue.split(";").map((askedWord) => askedWord.trim());
	const lastWord = askedWords.at(-1) ?? "";
	const levelWords = TIMINGS_WORDS.includes(lastWord) ? askedWords.slice(0, -1) : askedWords;
	const askedLevel = levelWords.length === 0 ? instanceLevel : levelWords[0];
	if (levelWords.length > 1 || !isQueryAuditLevel(askedLevel)) return;
	return {
		level: askedLevel,
		timings: lastWord !== "no-timings"
	};
}
var query_audit_default = auditRequestQueries;

//#endregion
export { query_audit_default as default };