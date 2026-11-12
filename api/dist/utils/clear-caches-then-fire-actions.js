import { useLogger } from "../logger/index.js";
import emitter_default from "../emitter.js";
import { getSchema } from "./get-schema.js";

//#region src/utils/clear-caches-then-fire-actions.ts
/**
* Clear the caches, then fire the actions the mutation held, even when the
* clear fails: a committed change must not lose its actions to a cache store
* error. After a commit the clear error is rethrown once they fired; after a
* failed mutation its own error is the one that matters, so the clear error
* is logged.
*/
async function clearCachesThenFireActions(clearCaches, fireActions, mutationFailed) {
	try {
		await clearCaches();
	} catch (clearError) {
		if (!mutationFailed) throw clearError;
		useLogger().error(clearError, "Clearing the caches failed after a failed mutation");
	} finally {
		await fireActions();
	}
}
/**
* Fire the actions a schema service held, with the schema the change produced.
*/
async function fireNestedActionEvents(nestedActionEvents, opts) {
	if (opts?.emitEvents === false || nestedActionEvents.length === 0) return;
	const updatedSchema = await getSchema();
	for (const nestedActionEvent of nestedActionEvents) {
		nestedActionEvent.context.schema = updatedSchema;
		emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
	}
}

//#endregion
export { clearCachesThenFireActions, fireNestedActionEvents };