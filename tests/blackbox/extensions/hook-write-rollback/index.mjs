// Update and delete filter hooks writing through `context.transaction`, for
// hook-write-rollback.test.ts.
//
// Every extension here loads into every instance, so these react only to the
// collections named `test_hook_rollback_*_item` and hand everything else back
// untouched. For a row of such a collection they write the note
// 'written-by-hook' into the rows of its `_witness` sibling pointing at it.
// An update whose data carries the status 'repeat-key' is answered with that
// group's first key a second time, in a group of its own.

const ITEM_COLLECTION = /^test_hook_rollback_\w+_item$/;

function witnessOf(collection) {
	return collection.replace(/_item$/, '_witness');
}

export default function registerHooks({ filter }) {
	filter('items.update', async (groups, { collection }, { transaction }) => {
		if (ITEM_COLLECTION.test(collection) === false) {
			return groups;
		}

		await transaction(witnessOf(collection))
			.whereIn('item', groups.flatMap((group) => group.keys))
			.update({ note: 'written-by-hook' });

		return groups.flatMap((group) => {
			return group.data.status === 'repeat-key'
				? [group, { ...group, keys: group.keys.slice(0, 1) }]
				: [group];
		});
	});

	filter('items.delete', async (keys, { collection }, { transaction }) => {
		if (ITEM_COLLECTION.test(collection) === false) {
			return keys;
		}

		await transaction(witnessOf(collection))
			.whereIn('item', keys)
			.update({ note: 'written-by-hook' });

		return keys;
	});
}
