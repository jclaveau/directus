// A `<coll>.items.delete` filter that REWRITES the key array instead of returning
// null to cancel. The statement, the access check and the activity rows all keep the
// original keys, so a cache snapshot taken off this return purges the
// surviving row's slice and leaves the deleted one cached.

const COLLECTION = 'del_rewrite_scoped';

export default function registerHooks({ filter }, { services }) {
	filter(`${COLLECTION}.items.delete`, async (keys, _meta, context) => {
		const [decoy] = await new services.ItemsService(COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		}).readByQuery(
			{ filter: { slot: { _eq: 'b' } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		if (!decoy) {
			return keys;
		}

		return [decoy.id];
	});
}
