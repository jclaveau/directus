export default function registerHooks({ action }, { services }) {
	const logsCollection = 'tests_extensions_log';

	action(
		'test_items_no_relations_artists_integer.items.create',
		collectionsCallback,
	);

	action(
		'test_items_no_relations_artists_string.items.create',
		collectionsCallback,
	);

	action(
		'test_items_no_relations_artists_uuid.items.create',
		collectionsCallback,
	);

	async function collectionsCallback(data, context) {
		for (const [index, payload] of data.payload.entries()) {
			await verifyRow(data.collection, payload, data.keys[index], context);
		}
	}

	async function verifyRow(
		collection,
		payload,
		primaryKey,
		{ database, schema, accountability },
	) {
		let key = `action-verify-create/${collection}`;

		const itemService = new services.ItemsService(collection, {
			schema,
			accountability,
		});

		if (!payload.name) {
			return;
		}

		if (payload.name.startsWith('one')) {
			key += '/one';
		}
		else if (payload.name.startsWith('many')) {
			key += '/many';
		}
		else {
			return;
		}

		key += `/${primaryKey}`;

		try {
			const item = await itemService.readOne(primaryKey);

			if (item.name !== payload.name) {
				throw 'Invalid item';
			}

			await database(logsCollection).insert({ key, value: '1' });
		} catch {
			await database(logsCollection).insert({ key, value: '0' });
		}
	}
}
