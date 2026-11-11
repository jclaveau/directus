import { useLogger } from "../../logger/index.js";

//#region src/cli/utils/arm-deadline.ts
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
function armDeadline(budgetMs, what) {
	if (typeof budgetMs !== "number" || budgetMs <= 0) {
		useLogger().warn(`[cli] ${what} has no usable budget, so none is armed`);
		return;
	}
	setTimeout(() => {
		useLogger().error(`[cli] ${what} did not finish within ${budgetMs}ms`);
		process.exit(1);
	}, budgetMs).unref();
}

//#endregion
export { armDeadline };