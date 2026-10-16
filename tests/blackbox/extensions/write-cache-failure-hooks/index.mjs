// Filter hooks writing through the pool, declaring purges, then failing, for
// write-cache-hook-failures.test.ts and write-cache-out-of-range-key.test.ts.
// Each acts on the body it is sent; the features list what each one does.

import { mapCreateRows } from '@directus/utils';

const outOfRangeKey = 99999999999;

export default function registerHooks({ filter }, { database }) {
	const groupSentBody = (groups, body) => {
		return groups.find((group) => group?.data?.body === body);
	};

	const refusedBody = (body) => {
		return new Error(`The body "${body}" is refused`);
	};

	filter(
		'test_wcf_update_precise.items.update',
		async (groups) => {
			const sentGroup = groupSentBody(groups, 'take-over-first');

			if (!sentGroup) {
				return groups;
			}

			const [takenOverKey, ...failingKeys] = sentGroup.keys;

			await database('test_wcf_update_precise')
				.where({ id: takenOverKey })
				.update({ body: 'taken-over' });

			return [
				{ key: takenOverKey },
				{ keys: failingKeys, data: { code: 'c' } },
			];
		},
	);

	filter(
		'test_wcf_update_coarse.items.update',
		async (groups) => {
			const sentGroup = groupSentBody(groups, 'take-over-sibling');

			if (!sentGroup) {
				return groups;
			}

			const siblingRow = await database('test_wcf_update_coarse')
				.where({ slot: 'b' })
				.first();

			await database('test_wcf_update_coarse')
				.where({ id: siblingRow.id })
				.update({ body: 'taken-over' });

			return [
				{ key: siblingRow.id },
				{ keys: sentGroup.keys, data: { code: 'c' } },
			];
		},
	);

	filter(
		'test_wcf_nested_child.items.update',
		(groups, _meta, { scopedCache }) => {
			const sentGroup = groupSentBody(groups, 'declare-foreign');

			if (!sentGroup) {
				return groups;
			}

			scopedCache.purgeBy({ collection: 'test_wcf_nested_foreign' });

			return [
				{ keys: sentGroup.keys, data: { ...sentGroup.data, code: 'b' } },
			];
		},
	);

	filter(
		'test_wcf_upsert_added.items.update',
		async (groups, _meta, { transaction }) => {
			const sentGroup = groupSentBody(groups, 'add-sibling');

			if (!sentGroup) {
				return groups;
			}

			const siblingRow = await transaction('test_wcf_upsert_added')
				.where({ slot: 'b' })
				.first();

			return groups.map((group) => {
				return group === sentGroup
					? { ...group, keys: [...group.keys, siblingRow.id] }
					: group;
			});
		},
	);

	filter(
		'test_wca_update.items.update',
		(groups, _meta, { scopedCache }) => {
			if (!groupSentBody(groups, 'take-over-out-of-range')) {
				return groups;
			}

			// The rows sent are taken over too: one left unanswered would cancel
			// the update, which the probe does not allow.
			const takenOverKeys = [
				...groups.flatMap((group) => group.keys),
				outOfRangeKey,
			];

			for (const takenOverKey of takenOverKeys) {
				scopedCache.purgeBy(
					{ collection: 'test_wca_update', pinnedScope: { slot: ['a'] } },
					{ forKey: takenOverKey },
				);
			}

			return takenOverKeys.map((takenOverKey) => ({ key: takenOverKey }));
		},
	);

	filter(
		'test_wcf_upsert_takeover.items.create',
		(entries, _meta, { scopedCache }) => {
			return mapCreateRows(entries, async (payload) => {
				if (payload?.body === 'refuse') {
					throw refusedBody(payload.body);
				}

				if (payload?.body !== 'take-over-declared') {
					return payload;
				}

				const takenOverRow = await database('test_wcf_upsert_takeover')
					.where({ slot: 'a' })
					.first();

				await database('test_wcf_upsert_takeover')
					.where({ id: takenOverRow.id })
					.update({ body: 'taken-over' });

				scopedCache.purgeBy(
					{
						collection: 'test_wcf_upsert_takeover',
						pinnedScope: { slot: ['a'] },
					},
					{ forKey: takenOverRow.id },
				);

				return takenOverRow.id;
			});
		},
	);

	filter(
		'test_wcf_upsert_declared.items.create',
		(entries, _meta, { scopedCache }) => {
			return mapCreateRows(entries, (payload) => {
				if (payload?.body !== 'refuse-declaring-foreign') {
					return payload;
				}

				scopedCache.purgeBy({ collection: 'test_wcf_upsert_foreign' });

				throw refusedBody(payload.body);
			});
		},
	);

	for (const refusingCollection of [
		'test_wcf_upsert_shared',
		'test_wcf_upsert_uncached',
	]) {
		filter(`${refusingCollection}.items.create`, (entries) => {
			return mapCreateRows(entries, (payload) => {
				if (payload?.body === 'refuse') {
					throw refusedBody(payload.body);
				}

				return payload;
			});
		});
	}

	for (const outOfRangeCollection of ['test_wca_upsert', 'test_wca_create']) {
		filter(
			`${outOfRangeCollection}.items.create`,
			(entries, _meta, { scopedCache }) => {
				return mapCreateRows(entries, (payload) => {
					if (payload?.body !== 'take-over-out-of-range') {
						return payload;
					}

					scopedCache.purgeBy(
						{
							collection: outOfRangeCollection,
							pinnedScope: { slot: ['a'] },
						},
						{ forKey: outOfRangeKey },
					);

					return outOfRangeKey;
				});
			},
		);
	}

	filter(
		'test_wcf_nested_delete_child.items.delete',
		async (keys, _meta, { scopedCache, database: hookDatabase }) => {
			const declaringRows = await hookDatabase('test_wcf_nested_delete_child')
				.whereIn('id', keys)
				.where({ body: 'declare-foreign' });

			if (declaringRows.length > 0) {
				scopedCache.purgeBy({ collection: 'test_wcf_nested_delete_foreign' });
			}

			return keys;
		},
	);

	filter(
		'test_wcf_delete.items.delete',
		async (keys, _meta, { scopedCache }) => {
			const refusedRows = await database('test_wcf_delete')
				.whereIn('id', keys)
				.where({ body: 'refuse-deletion' });

			if (refusedRows.length === 0) {
				return keys;
			}

			scopedCache.purgeBy({ collection: 'test_wcf_delete_foreign' });

			return null;
		},
	);
}
