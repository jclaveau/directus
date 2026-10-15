// A signal rewrites entries behind the items service, then declares only their
// `account` key: the purge must read the account back to reach `account.owner`.

import { mapCreateRows } from '@directus/utils';

const ACCOUNT = 'readback_account';
const ENTRY = 'readback_entry';
const SIGNAL = 'readback_signal';

export default function registerHooks({ filter }) {
	filter(`${SIGNAL}.items.create`, (entries, _meta, context) => {
		return mapCreateRows(entries, async (payload) => {
			if (payload.rewritten_ids) {
				await context.transaction(ENTRY)
					.whereIn('id', payload.rewritten_ids)
					.update(payload.rewritten_values);
			}

			if (payload.deleted_account) {
				await context.transaction(ENTRY)
					.where({ account: payload.deleted_account })
					.delete();

				await context.transaction(ACCOUNT)
					.where({ id: payload.deleted_account })
					.delete();
			}

			context.scopedCache?.purgeBy(payload.declared.map((pinnedScope) => {
				return { collection: ENTRY, pinnedScope };
			}));

			return payload;
		});
	});
}
