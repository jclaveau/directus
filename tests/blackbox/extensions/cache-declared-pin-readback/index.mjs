// A signal rewrites entries behind the items service, then declares only their
// `account` key: the purge must read the account back to reach `account.owner`.

const ACCOUNT = 'readback_account';
const ENTRY = 'readback_entry';
const SIGNAL = 'readback_signal';

export default function registerHooks({ filter }) {
	filter(`${SIGNAL}.items.create`, async (payload, _meta, context) => {
		if (payload.rewritten_ids) {
			await context.database(ENTRY)
				.whereIn('id', payload.rewritten_ids)
				.update(payload.rewritten_values);
		}

		if (payload.deleted_account) {
			await context.database(ENTRY)
				.where({ account: payload.deleted_account })
				.delete();

			await context.database(ACCOUNT)
				.where({ id: payload.deleted_account })
				.delete();
		}

		context.scopedCache?.purgeBy(payload.declared.map((pinnedScope) => {
			return { collection: ENTRY, pinnedScope };
		}));

		return payload;
	});
}
