import type { Request } from 'express';
import { pick } from './lodash-es-used.js';

export function getGraphqlQueryAndVariables(req: Request) {
	const isGet = req.method?.toLowerCase() === 'get';
	return pick(isGet ? req.query : req.body, ['query', 'variables']);
}
