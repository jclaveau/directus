import type { AbstractServiceOptions } from '@directus/types';
import { ItemsService } from './items.js';

/**
 * An invite of a user to a role, one row per inviter: `user_created` is the
 * inviting user, or null from a service naming none (#746, D8). The invite
 * code writes it with the user's `managed_by: invite` memberships, which a
 * write made here does not sync; once the user accepts, the rows are history.
 */
export class InvitesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_invites', options);
	}
}
