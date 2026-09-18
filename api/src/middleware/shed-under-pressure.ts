import { handlePressure } from '@directus/pressure';
import type { RequestHandler } from 'express';
import { isCacheAuditReplay } from '../utils/cache-audit-replay.js';

// What the limiter's 503 says, and what the audit reads a replay's 503 for.
export const UNDER_PRESSURE_REASON = 'Under pressure';

/**
 * The pressure limiter, with the cache audit's own replays let through. A
 * replay is the audit asking this very process what it would answer, over its
 * loopback, four at a time: a run's bookkeeping — a page of retirements, the
 * queue read — stalls the loop the limiter samples, and shedding the replays
 * reported a whole page `unreplayable status_503` from a process answering
 * every other request fine (jclaveau/directus#508). Shedding the instrument
 * protects nothing: a replay has no client to keep away, and the four in
 * flight are bounded whatever the limiter reads.
 */
export function shedUnderPressure(
	options: Parameters<typeof handlePressure>[0],
): RequestHandler {
	const shed = handlePressure(options);

	return (req, res, next) => {
		if (isCacheAuditReplay(req)) {
			return next();
		}

		return shed(req, res, next);
	};
}
