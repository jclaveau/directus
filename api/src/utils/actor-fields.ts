import type { Accountability } from '@directus/types';

/**
 * The columns of an activity row that say who acted, shared by every writer of
 * `directus_activity` so a new actor attribute lands in one place.
 */
export function actorFields(accountability: Accountability | null | undefined) {
	return {
		user: accountability?.user ?? null,
		ip: accountability?.ip ?? null,
		user_agent: accountability?.userAgent ?? null,
		origin: accountability?.origin ?? null,
	};
}
