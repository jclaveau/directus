import { useEnv } from '@directus/env';
import { toArray } from '@directus/utils';
import type { RequestHandler } from 'express';

/**
 * A strangler mount: one route group at a time is handed to Hono while the rest
 * of the API stays on Express, so the two can be compared on the same process
 * under the same load instead of against a hello-world benchmark (#458).
 *
 * `/server/ping` goes first because it is the only route in the API that reads
 * neither `req.accountability`, `req.schema` nor `req.sanitizedQuery` — moving
 * it moves the framework and nothing else.
 */

export type HonoMount = '/server/ping';

export const honoDelegated = (mount: HonoMount): boolean =>
	toArray(useEnv()['HONO_ROUTES'] ?? []).includes(mount);

/**
 * Imported only once a group is actually delegated, so an install that never
 * opts in pays neither the module load nor the resident memory.
 */
export const honoPing = async (): Promise<RequestHandler> => {
	const [{ Hono }, { getRequestListener }] = await Promise.all([
		import('hono'),
		import('@hono/node-server'),
	]);

	const app = new Hono();

	// Express has already stripped the mount path by the time the listener runs.
	app.get('/', (c) => c.text('pong'));

	const listener = getRequestListener(app.fetch);

	return (req, res) => {
		void listener(req, res);
	};
};
