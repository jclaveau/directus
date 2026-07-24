// UNDECLARED take-over that MOVES a junction row between slices — the poison the
// coarse fallback exists for (cache-takeover-scope.test.ts). A parent update nests
// `tags.create`; on the resulting junction create this hook finds the existing link
// for that tag and re-assigns it to the new post (an UPDATE in the mutation trx),
// then returns its PK — a take-over that is really an upsert-move.
//
// It declares NOTHING. Its old slice (the previous post) is unrecoverable from the
// post-commit re-read, so the framework MUST purge coarse; a narrow guess leaves the
// old post's cached read stale. This proves the coarse fallback holds.

const JUNCTION = 'test_items_post_tag';
const POST_FK = 'test_items_post_id';
const TAG_FK = 'test_items_tag_id';

export default function registerHooks({ filter }, { services }) {
	filter(`${JUNCTION}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(JUNCTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const [existing] = await itemsService.readByQuery(
			{ filter: { [TAG_FK]: { _eq: payload[TAG_FK] } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		if (!existing) {
			return payload;
		}

		// Re-assign the existing link to the new post — the row moves slices. A raw
		// update on the trx knex, so it doesn't recurse through the service purge.
		await context
			.database(JUNCTION)
			.where({ id: existing.id })
			.update({ [POST_FK]: payload[POST_FK] });

		return existing.id;
	});
}
