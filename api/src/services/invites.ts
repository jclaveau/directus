import { ForbiddenError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { ItemsService } from './items.js';

/**
 * An invite of an email to a role, one row per inviter: the `inviter` column
 * is the inviter, or null from a service naming none (#746). The roles wait
 * here until the invite is accepted, which turns them into memberships of the
 * account it creates, or of the logged-in user. A request
 * writes them through `/users/invite` only, which checks the inviter's
 * permissions on this collection: written straight, only an admin's request
 * writes one, whatever the permissions say.
 */
export class InvitesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_invites', options);
	}

	private refuseNonAdminWrite(): void {
		if (this.accountability && this.accountability.admin !== true) {
			throw new ForbiddenError();
		}
	}

	override async createMany(
		data: Partial<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		this.refuseNonAdminWrite();

		return await super.createMany(data, opts);
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		this.refuseNonAdminWrite();

		return await super.updateGroups(groups, opts);
	}

	override async deleteMany(
		keys: PrimaryKey[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		this.refuseNonAdminWrite();

		return await super.deleteMany(keys, opts);
	}
}
