import type {
	AbstractServiceOptions,
	FlowRaw,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { getFlowManager } from '../flows.js';
import { ItemsService } from './items.js';

export class FlowsService extends ItemsService<FlowRaw> {
	constructor(options: AbstractServiceOptions) {
		super('directus_flows', options);
	}

	override async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		const result = await super.createOne(data, opts);

		const flowManager = getFlowManager();
		await flowManager.reload();

		return result;
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		const result = await super.updateGroups(groups, opts);

		const flowManager = getFlowManager();
		await flowManager.reload();

		return result;
	}

	override async deleteMany(keys: PrimaryKey[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		// this is to prevent foreign key constraint error on directus_operations resolve/reject during cascade deletion
		await this.knex('directus_operations').update({ resolve: null, reject: null }).whereIn('flow', keys);

		const result = await super.deleteMany(keys, opts);

		const flowManager = getFlowManager();
		await flowManager.reload();

		return result;
	}
}
