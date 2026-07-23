// Two WRITE-side scoped-cache POISONING limits (#292). A mutation hook whose side
// effect writes to another collection self-purges it ONLY when the write goes
// through ItemsService with its purge on (see cache-nested-write.test.ts). Two ways
// to defeat that and leave the target a STALE HIT: write via raw knex (bypasses the
// purge pipeline), or via ItemsService with `autoPurgeCache: false` (suppresses it).
// Both need an explicit `purgeBy` the author here deliberately omits. These are
// author-contract limits, NOT framework bugs.

const P2_SOURCE = 'p_raw_source';
const P2_TARGET = 'p_raw_target';
const P3_SOURCE = 'p_nopurge_source';
const P3_TARGET = 'p_nopurge_target';

export default function registerHooks({ filter }, { services }) {
	// P2 — raw knex write to P2_TARGET, bypassing ItemsService entirely. No purge
	// runs, no purgeBy declared, so P2_TARGET's cached reads go stale.
	filter(`${P2_SOURCE}.items.update`, async (payload, _meta, context) => {
		await context
			.database(P2_TARGET)
			.where({ space: 'x' })
			.update({ tally: 1 });

		return payload;
	});

	// P3 — write to P3_TARGET via ItemsService with autoPurgeCache off, suppressing
	// its purge. No purgeBy declared, so P3_TARGET's cached reads go stale.
	filter(`${P3_SOURCE}.items.update`, async (payload, _meta, context) => {
		const targetService = new services.ItemsService(P3_TARGET, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const rows = await targetService.readByQuery(
			{ filter: { space: { _eq: 'x' } }, fields: ['id'], limit: -1 },
			{ emitEvents: false },
		);

		const keys = rows.map((row) => row.id);

		if (keys.length > 0) {
			await targetService.updateMany(keys, { tally: 1 }, { autoPurgeCache: false });
		}

		return payload;
	});
}
