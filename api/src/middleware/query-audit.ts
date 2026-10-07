import { useEnv } from '@directus/env';
import { InvalidQueryError } from '@directus/errors';
import { parse as parseBytesConfiguration } from 'bytes';
import type { RequestHandler, Response } from 'express';
import {
	emptyQueryAudit,
	formatQueryAudit,
	isQueryAuditLevel,
	QUERY_AUDIT_LEVELS,
	queryAuditStore,
} from '../database/query-audit.js';

/**
 * Dev-only: QUERY_AUDIT_HEADER names the header reporting the SQL this request
 * ran, one entry per transaction. A request sends the same header to pick how
 * much: `counts`, `statements`, or `full` for each run's bound values;
 * QUERY_AUDIT_LEVEL is the level of a request that sends none.
 *
 * Bound values carry what the request read and wrote, so `full` reports them to
 * an admin alone: anyone else gets `statements`. Whether the request is an
 * admin's is known once it has authenticated, after this middleware, so the
 * values are recorded on the ask and dropped at flush.
 *
 * Written when the headers flush rather than in `respond`, so an error response
 * and a route that bypasses `respond` carry it too.
 */
const auditRequestQueries: RequestHandler = (req, res, next) => {
	const env = useEnv();
	const headerName = `${env['QUERY_AUDIT_HEADER']}`;
	const requestedLevel = req.get(headerName) ?? env['QUERY_AUDIT_LEVEL'];

	if (!isQueryAuditLevel(requestedLevel)) {
		return next(new InvalidQueryError({
			reason: `"${headerName}" must be one of ${QUERY_AUDIT_LEVELS.join(', ')}`,
		}));
	}

	const audit = emptyQueryAudit(requestedLevel === 'full');
	const writeHead = res.writeHead;

	res.writeHead = function (this: Response, ...headArguments: any[]) {
		this.setHeader(headerName, formatQueryAudit(audit, {
			level: requestedLevel === 'full' && !req.accountability?.admin
				? 'statements'
				: requestedLevel,
			maxSize: parseBytesConfiguration(
				String(env['QUERY_AUDIT_HEADER_MAX_SIZE']),
			) ?? 0,
		}));

		return writeHead.apply(this, headArguments as any);
	} as Response['writeHead'];

	queryAuditStore.run(audit, next);
};

export default auditRequestQueries;
