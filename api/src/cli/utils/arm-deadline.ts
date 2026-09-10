import { useLogger } from '../../logger/index.js';

/**
 * Kills the process when a command outruns the time a deploy step can give it. The
 * commands that need this wait on a Redis client that retries on its own schedule
 * rather than the caller's, and a deploy step that hangs is worse than one that
 * fails.
 *
 * Armed by the entrypoint rather than by the action it guards: the CLI's bootstrap
 * reads through the same Redis, so a command aimed at one that is down never
 * reaches the action in the first place.
 */
export function armDeadline(budgetMs: number | undefined, what: string): void {
	// `setTimeout(undefined)` fires on the next tick, so an unparseable budget would
	// kill every run instantly rather than never. Unbudgeted is the safer reading.
	if (typeof budgetMs !== 'number' || budgetMs <= 0) {
		useLogger().warn(`[cli] ${what} has no usable budget, so none is armed`);
		return;
	}

	const ranOutOfTime = setTimeout(() => {
		useLogger().error(`[cli] ${what} did not finish within ${budgetMs}ms`);
		process.exit(1);
	}, budgetMs);

	// Nothing waits on the deadline itself, so it must not be what keeps the process
	// alive once the command it guards is done.
	ranOutOfTime.unref();
}
