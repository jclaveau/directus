// The in-flight window of `cache-read-inflight-flush`, opened by the flushes the
// system services run on their own: a permission, policy, role, access or user
// change, a field or collection edit, a manual sort, GraphQL's `utils_cache_clear`.
// Each of them drops the response cache with a raw `cache.clear()` rather than the
// flush `/utils/cache/clear` runs, and that flush is what moves the wholesale purge
// counter a read in flight compares against. Without the move the read compares
// equal and stores the rows it fetched before the change — a user whose permission
// was just revoked keeps HITting what they could see before it, for the whole TTL.
//
// One write per slot, so every service is raced by a read of its own. The row's
// `target` carries whatever id the write needs, planted by the spec before the read.

const COLLECTION = 'read_inflight_system_flush';

// The blackbox admin fixture (`USER.ADMIN.TOKEN`), which an extension cannot import.
const ADMIN_TOKEN = 'AdminToken';

const fired = new Set();

async function callApi(method, path, body) {
	const response = await fetch(`http://127.0.0.1:${process.env['PORT']}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${ADMIN_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	// Surfaced rather than swallowed: a write that never landed leaves no flush to
	// race, and the read would then cache for a reason the spec is not about.
	if (!response.ok) {
		throw new Error(
			`${method} ${path} answered ${response.status}: ${await response.text()}`,
		);
	}
}

const writeOf = {
	permission: (rows) => {
		return callApi('POST', '/permissions', {
			policy: rows[0].target,
			collection: COLLECTION,
			action: 'read',
		});
	},
	policy: (rows) => {
		return callApi('PATCH', `/policies/${rows[0].target}`, { ip_access: null });
	},
	role: (rows) => {
		return callApi('PATCH', `/roles/${rows[0].target}`, { parent: null });
	},
	access: (rows) => {
		const [role, policy] = rows[0].target.split('/');

		return callApi('POST', '/access', { role, policy });
	},
	user: (rows) => {
		return callApi('PATCH', `/users/${rows[0].target}`, { role: null });
	},
	field: () => {
		return callApi('PATCH', `/fields/${COLLECTION}/target`, {
			meta: { note: 'flushed' },
		});
	},
	collection: () => {
		return callApi('PATCH', `/collections/${COLLECTION}`, {
			meta: { note: 'flushed' },
		});
	},
	sort: (rows) => {
		return callApi('POST', `/utils/sort/${COLLECTION}`, {
			item: rows[0].id,
			to: rows[1].id,
		});
	},
	graphql: () => {
		return callApi('POST', '/graphql/system', {
			query: 'mutation { utils_cache_clear }',
		});
	},
};

export default function registerHooks({ filter }) {
	filter(`${COLLECTION}.items.read`, async (payload, meta) => {
		const slot = meta?.query?.filter?.slot?._eq;

		// Set before the await so the write's own reads cannot re-enter, and so the
		// test's second read runs against an untouched hook.
		if (!(slot in writeOf) || fired.has(slot)) {
			return payload;
		}

		fired.add(slot);

		await writeOf[slot](payload);

		return payload;
	});
}
