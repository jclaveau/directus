// `items.created` and `items.updated` filter hooks, for items-written-hooks.test.ts.
//
// Every extension here loads into every instance, so these react only to the
// collections named `test_items_written_*_item` and answer nothing for
// everything else. For each row they are handed they read the row back through
// `context.transaction`, so the note proves the write is visible to them, and
// insert into the `_witness` sibling the note `<event>:<status>:<children>`,
// the count of `_child` rows pointing at it. Then a row whose status is
// 'refuse' makes them throw, one whose status is 'answer' makes them answer
// other rows, and one whose status is 'echo' makes them answer the rows they
// were handed: each way the note was written first, so it proves the rollback.

const ITEM_COLLECTION = /^test_items_written_\w+_item$/;

function siblingOf(collection, suffix) {
	return collection.replace(/_item$/, suffix);
}

async function noteWrittenRows(writtenEvent, keys, collection, transaction) {
	for (const key of keys) {
		const writtenRow = await transaction(collection)
			.where('id', key)
			.first();

		const [{ childCount }] = await transaction(siblingOf(collection, '_child'))
			.where('item', key)
			.count('* as childCount');

		await transaction(siblingOf(collection, '_witness')).insert({
			item: key,
			note: `${writtenEvent}:${writtenRow.status}:${Number(childCount)}`,
		});

		if (writtenRow.status === 'refuse') {
			throw new Error(`The ${writtenEvent} hook refused the row ${key}`);
		}
	}
}

async function answerOf(writtenRows, keys, collection, transaction) {
	const answeringRow = await transaction(collection)
		.whereIn('id', keys)
		.whereIn('status', ['answer', 'echo'])
		.first();

	if (answeringRow?.status === 'answer') {
		return [{ status: 'other' }];
	}

	if (answeringRow?.status === 'echo') {
		return writtenRows;
	}

	return undefined;
}

export default function registerHooks({ filter }) {
	filter('items.created', async (rows, { keys, collection }, { transaction }) => {
		if (ITEM_COLLECTION.test(collection) === false) {
			return undefined;
		}

		await noteWrittenRows('created', keys, collection, transaction);

		return answerOf(rows, keys, collection, transaction);
	});

	filter('items.updated', async (groups, { keys, collection }, { transaction }) => {
		if (ITEM_COLLECTION.test(collection) === false) {
			return undefined;
		}

		await noteWrittenRows('updated', keys, collection, transaction);

		return answerOf(groups, keys, collection, transaction);
	});
}
