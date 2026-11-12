import { useEnv } from "@directus/env";
import { MutationBatchingModes } from "@directus/types";
import { oneLine } from "@directus/utils";

//#region src/utils/resolve-mutation-batching.ts
/**
* The batching a write runs with: the caller's `mutationBatching`, else
* `DEFAULT_MUTATION_BATCHING`, else `preserveMutationOrder` (an env missing the
* var, which `useEnv`'s defaults never leave out). A value outside
* `MutationBatchingModes` is refused, never read as the default. So is
* `refuseChildJoiningSeveralRows` under `disableBatching`: each row is written
* on its own there, so no row could see another one's children.
*/
function resolveMutationBatching(opts) {
	const source = opts.mutationBatching === void 0 ? "DEFAULT_MUTATION_BATCHING" : "mutationBatching";
	const mutationBatching = opts.mutationBatching ?? useEnv()["DEFAULT_MUTATION_BATCHING"] ?? "preserveMutationOrder";
	if (!MutationBatchingModes.includes(mutationBatching)) throw new Error(oneLine`
			"${source}" must be one of ${MutationBatchingModes.join(", ")},
			got ${JSON.stringify(mutationBatching)}
		`);
	if (mutationBatching === "disableBatching" && opts.refuseChildJoiningSeveralRows) throw new Error(oneLine`
			"refuseChildJoiningSeveralRows" cannot run under disableBatching
			(from "${source}")
		`);
	return mutationBatching;
}

//#endregion
export { resolveMutationBatching };