import { useEnv } from '@directus/env';
import { parse as parseBytesConfiguration } from 'bytes';
import type { RequestHandler, Response } from 'express';
import {
	emptyQueryAudit,
	formatQueryAudit,
	queryAuditStore,
} from '../database/query-audit.js';

/**
 * Dev-only: QUERY_AUDIT_HEADER names the header reporting the SQL this request
 * ran, one entry per transaction; QUERY_AUDIT_STATEMENTS adds each entry's
 * statements. It is written when the headers flush rather than in `respond`,
 * so an error response and a route that bypasses `respond` carry it too.
 */
const auditRequestQueries: RequestHandler = (_req, res, next) => {
	const audit = emptyQueryAudit();
	const writeHead = res.writeHead;

	res.writeHead = function (this: Response, ...headArguments: any[]) {
		const env = useEnv();

		this.setHeader(
			`${env['QUERY_AUDIT_HEADER']}`,
			formatQueryAudit(audit, {
				withStatements: env['QUERY_AUDIT_STATEMENTS'] === true,
				maxSize: parseBytesConfiguration(
					String(env['QUERY_AUDIT_HEADER_MAX_SIZE']),
				) ?? 0,
			}),
		);

		return writeHead.apply(this, headArguments as any);
	} as Response['writeHead'];

	queryAuditStore.run(audit, next);
};

export default auditRequestQueries;
