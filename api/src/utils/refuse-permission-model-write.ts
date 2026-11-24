import { ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';

/**
 * Who may do what is written by an admin or by code, never by a request whose
 * permissions grant the write: such a write could hand its author more than
 * they hold (#763). Code passes no accountability.
 */
export function refusePermissionModelWrite(
	accountability: Accountability | null,
): void {
	if (accountability && !accountability.admin) {
		throw new ForbiddenError();
	}
}
