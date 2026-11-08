import type { ActionEventParams, MutationOptions } from '@directus/types';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';
import { getSchema } from './get-schema.js';

/**
 * Clear the caches, then fire the actions the mutation held, even when the
 * clear fails: a committed change must not lose its actions to a cache store
 * error. After a commit the clear error is rethrown once they fired; after a
 * failed mutation its own error is the one that matters, so the clear error
 * is logged.
 */
export async function clearCachesThenFireActions(
	clearCaches: () => Promise<void>,
	fireActions: () => Promise<void>,
	mutationFailed: boolean,
): Promise<void> {
	try {
		await clearCaches();
	}
	catch (clearError) {
		if (!mutationFailed) {
			throw clearError;
		}

		useLogger().error(
			clearError,
			'Clearing the caches failed after a failed mutation',
		);
	}
	finally {
		await fireActions();
	}
}

/**
 * Fire the actions a schema service held, with the schema the change produced.
 */
export async function fireNestedActionEvents(
	nestedActionEvents: ActionEventParams[],
	opts?: MutationOptions,
): Promise<void> {
	if (opts?.emitEvents === false || nestedActionEvents.length === 0) {
		return;
	}

	const updatedSchema = await getSchema();

	for (const nestedActionEvent of nestedActionEvents) {
		nestedActionEvent.context.schema = updatedSchema;

		emitter.emitAction(
			nestedActionEvent.event,
			nestedActionEvent.meta,
			nestedActionEvent.context,
		);
	}
}
