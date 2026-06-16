import { ItemsService } from "./items.js";
import { getFlowManager } from "../flows.js";

//#region src/services/operations.ts
var OperationsService = class extends ItemsService {
	constructor(options) {
		super("directus_operations", options);
	}
	async createOne(data, opts) {
		const result = await super.createOne(data, opts);
		await getFlowManager().reload();
		return result;
	}
	async updateMany(keys, data, opts) {
		const result = await super.updateMany(keys, data, opts);
		await getFlowManager().reload();
		return result;
	}
	async deleteMany(keys, opts) {
		const result = await super.deleteMany(keys, opts);
		await getFlowManager().reload();
		return result;
	}
};

//#endregion
export { OperationsService };