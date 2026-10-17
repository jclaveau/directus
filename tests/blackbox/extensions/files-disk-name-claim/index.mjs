// A file whose description reads `claim-disk-name:<name>` has its
// filename_disk rewritten to <name> by the create and update filters, after
// the request's payload was checked (files-disk-name.feature).

import { mapCreateRows, mapUpdateRows } from '@directus/utils';

const CLAIM_PREFIX = 'claim-disk-name:';

function withClaimedDiskName(payload) {
	if (typeof payload.description !== 'string'
		|| !payload.description.startsWith(CLAIM_PREFIX)) {
		return payload;
	}

	return {
		...payload,
		filename_disk: payload.description.slice(CLAIM_PREFIX.length),
	};
}

export default function registerHooks({ filter }) {
	filter('files.create', (entries) => {
		return mapCreateRows(entries, withClaimedDiskName);
	});

	filter('files.update', (groups) => {
		return mapUpdateRows(groups, withClaimedDiskName);
	});
}
