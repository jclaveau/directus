import type { Accountability } from '@directus/types';

export function createDefaultAccountability(overrides?: Partial<Accountability>): Accountability {
	return {
		user: null,
		memberRoles: [],
		roles: [],
		admin: false,
		app: false,
		ip: null,
		...overrides,
	};
}
