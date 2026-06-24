import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import { useLogger } from "./logger/index.js";
import database_default from "./database/index.js";
import { fetchPolicies } from "./permissions/lib/fetch-policies.js";
import { fetchPermissions } from "./permissions/lib/fetch-permissions.js";
import emitter_default from "./emitter.js";
import { scheduleSynchronizedJob, validateCron } from "./utils/schedule.js";
import { ActivityService } from "./services/activity.js";
import { getService } from "./utils/get-service.js";
import { getSchema } from "./utils/get-schema.js";
import { FlowsService } from "./services/flows.js";
import { RevisionsService } from "./services/revisions.js";
import { constructFlowTree } from "./utils/construct-flow-tree.js";
import { redactObject } from "./utils/redact-object.js";
import { services_exports } from "./services/index.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { applyOptionsData, deepMap, getRedactedString, isValidJSON, parseJSON, toArray } from "@directus/utils";
import { pick } from "lodash-es";
import { Action } from "@directus/constants";
import { isSystemCollection } from "@directus/system-data";
import PQueue from "p-queue";
import { get as get$1 } from "micromustache";

//#region src/flows.ts
let flowManager;
function getFlowManager() {
	if (flowManager) return flowManager;
	flowManager = new FlowManager();
	return flowManager;
}
const TRIGGER_KEY = "$trigger";
const ACCOUNTABILITY_KEY = "$accountability";
const LAST_KEY = "$last";
const ENV_KEY = "$env";
var FlowManager = class {
	isLoaded = false;
	flows = {};
	operations = /* @__PURE__ */ new Map();
	triggerHandlers = [];
	operationFlowHandlers = {};
	webhookFlowHandlers = {};
	reloadQueue = new PQueue({ concurrency: 1 });
	envs;
	constructor() {
		const env = useEnv();
		this.envs = env["FLOWS_ENV_ALLOW_LIST"] ? pick(env, toArray(env["FLOWS_ENV_ALLOW_LIST"])) : {};
		const messenger = useBus();
		const logger = useLogger();
		messenger.subscribe("flows", (event) => {
			if (event.type === "reload") this.reloadQueue.add(async () => {
				if (this.isLoaded) {
					await this.unload();
					await this.load();
				} else logger.warn("Flows have to be loaded before they can be reloaded");
			});
		});
	}
	async initialize() {
		if (!this.isLoaded) await this.load();
	}
	async reload() {
		useBus().publish("flows", { type: "reload" });
	}
	addOperation(id, operation) {
		this.operations.set(id, operation);
	}
	removeOperation(id) {
		this.operations.delete(id);
	}
	async runOperationFlow(id, data, context) {
		if (this.reloadQueue.pending > 0) await this.reloadQueue.onIdle();
		const logger = useLogger();
		if (!(id in this.operationFlowHandlers)) {
			logger.warn(`Couldn't find operation triggered flow with id "${id}"`);
			return null;
		}
		const handler = this.operationFlowHandlers[id];
		return handler(data, context);
	}
	async runWebhookFlow(id, data, context) {
		if (this.reloadQueue.pending > 0) await this.reloadQueue.onIdle();
		const logger = useLogger();
		if (!(id in this.webhookFlowHandlers)) {
			logger.warn(`Couldn't find webhook or manual triggered flow with id "${id}"`);
			throw new ForbiddenError();
		}
		const handler = this.webhookFlowHandlers[id];
		return handler(data, context);
	}
	getFlow(id) {
		return this.flows[id];
	}
	async load() {
		const logger = useLogger();
		const flowTrees = (await new FlowsService({
			knex: database_default(),
			schema: await getSchema()
		}).readByQuery({
			filter: { status: { _eq: "active" } },
			fields: ["*", "operations.*"],
			limit: -1
		})).map((flow) => constructFlowTree(flow));
		for (const flow of flowTrees) {
			this.flows[flow.id] = flow;
			if (flow.trigger === "event") {
				let events = [];
				if (flow.options?.["scope"]) events = toArray(flow.options["scope"]).map((scope) => {
					if ([
						"items.create",
						"items.update",
						"items.delete"
					].includes(scope)) {
						if (!flow.options?.["collections"]) return [];
						return toArray(flow.options["collections"]).map((collection) => {
							if (isSystemCollection(collection)) {
								const action = scope.split(".")[1];
								return collection.substring(9) + "." + action;
							}
							return `${collection}.${scope}`;
						});
					}
					return scope;
				}).flat();
				if (flow.options["type"] === "filter") {
					const handler = (payload, meta, context) => this.executeFlow(flow, {
						payload,
						...meta
					}, {
						accountability: context["accountability"],
						database: context["database"],
						getSchema: context["schema"] ? () => context["schema"] : getSchema
					});
					events.forEach((event) => emitter_default.onFilter(event, handler));
					this.triggerHandlers.push({
						id: flow.id,
						events: events.map((event) => ({
							type: "filter",
							name: event,
							handler
						}))
					});
				} else if (flow.options["type"] === "action") {
					const handler = (meta, context) => this.executeFlow(flow, meta, {
						accountability: context["accountability"],
						database: database_default(),
						getSchema: context["schema"] ? () => context["schema"] : getSchema
					});
					events.forEach((event) => emitter_default.onAction(event, handler));
					this.triggerHandlers.push({
						id: flow.id,
						events: events.map((event) => ({
							type: "action",
							name: event,
							handler
						}))
					});
				}
			} else if (flow.trigger === "schedule") if (validateCron(flow.options["cron"])) {
				const job = scheduleSynchronizedJob(flow.id, flow.options["cron"], async () => {
					try {
						await this.executeFlow(flow);
					} catch (error) {
						logger.error(error);
					}
				});
				this.triggerHandlers.push({
					id: flow.id,
					events: [{
						type: flow.trigger,
						job
					}]
				});
			} else logger.warn(`Couldn't register cron trigger. Provided cron is invalid: ${flow.options["cron"]}`);
			else if (flow.trigger === "operation") {
				const handler = (data, context) => this.executeFlow(flow, data, context);
				this.operationFlowHandlers[flow.id] = handler;
			} else if (flow.trigger === "webhook") {
				const method = flow.options?.["method"] ?? "GET";
				const handler = async (data, context) => {
					let cacheEnabled = true;
					if (method === "GET") cacheEnabled = flow.options["cacheEnabled"] !== false;
					if (flow.options["async"]) {
						this.executeFlow(flow, data, context);
						return {
							result: void 0,
							cacheEnabled
						};
					} else return {
						result: await this.executeFlow(flow, data, context),
						cacheEnabled
					};
				};
				flow.options["return"] = flow.options["return"] ?? "$last";
				this.webhookFlowHandlers[`${method}-${flow.id}`] = handler;
			} else if (flow.trigger === "manual") {
				const handler = async (data, context) => {
					const enabledCollections = flow.options?.["collections"] ?? [];
					const requireSelection = flow.options?.["requireSelection"] ?? true;
					const targetCollection = data?.["body"].collection;
					const targetKeys = data?.["body"].keys;
					if (!targetCollection) {
						logger.warn(`Manual trigger requires "collection" to be specified in the payload`);
						throw new ForbiddenError();
					}
					if (enabledCollections.length === 0) {
						logger.warn(`There is no collections configured for this manual trigger`);
						throw new ForbiddenError();
					}
					if (!enabledCollections.includes(targetCollection)) {
						logger.warn(`Specified collection must be one of: ${enabledCollections.join(", ")}.`);
						throw new ForbiddenError();
					}
					if (requireSelection && (!targetKeys || !Array.isArray(targetKeys))) {
						logger.warn(`Manual trigger requires "keys" to be specified in the payload`);
						throw new ForbiddenError();
					}
					if (requireSelection && targetKeys.length === 0) {
						logger.warn(`Manual trigger requires at least one key to be specified in the payload`);
						throw new ForbiddenError();
					}
					const accountability = context?.["accountability"];
					if (!accountability) {
						logger.warn(`Manual flows are only triggerable when authenticated`);
						throw new ForbiddenError();
					}
					if (accountability.admin === false) {
						const database = context["database"] ?? database_default();
						const schema = context["schema"] ?? await getSchema({ database });
						if ((await fetchPermissions({
							policies: await fetchPolicies(accountability, {
								schema,
								knex: database
							}),
							accountability,
							action: "read",
							collections: [targetCollection]
						}, {
							schema,
							knex: database
						})).length === 0) {
							logger.warn(`Triggering ${targetCollection} is not allowed`);
							throw new ForbiddenError();
						}
						if (Array.isArray(targetKeys) && targetKeys.length > 0) {
							const service = getService(targetCollection, {
								schema,
								accountability,
								knex: database
							});
							const primaryField = schema.collections[targetCollection].primary;
							const allowedKeys = (await service.readMany(targetKeys, { fields: [primaryField] }, { emitEvents: false })).map((key) => String(key[primaryField]));
							if (targetKeys.some((key) => !allowedKeys.includes(String(key)))) {
								logger.warn(`Triggering keys ${targetKeys} is not allowed`);
								throw new ForbiddenError();
							}
						}
					}
					if (flow.options["async"]) {
						this.executeFlow(flow, data, context);
						return { result: void 0 };
					} else return { result: await this.executeFlow(flow, data, context) };
				};
				flow.options["return"] = "$last";
				this.webhookFlowHandlers[`POST-${flow.id}`] = handler;
			}
		}
		this.isLoaded = true;
	}
	async unload() {
		for (const trigger of this.triggerHandlers) for (const event of trigger.events) switch (event.type) {
			case "filter":
				emitter_default.offFilter(event.name, event.handler);
				break;
			case "action":
				emitter_default.offAction(event.name, event.handler);
				break;
			case "schedule":
				await event.job.stop();
				break;
		}
		this.flows = {};
		this.triggerHandlers = [];
		this.operationFlowHandlers = {};
		this.webhookFlowHandlers = {};
		this.isLoaded = false;
	}
	async executeFlow(flow, data = null, context = {}) {
		const database = context["database"] ?? database_default();
		const schema = context["schema"] ?? await getSchema({ database });
		const keyedData = {
			[TRIGGER_KEY]: data,
			[LAST_KEY]: data,
			[ACCOUNTABILITY_KEY]: context?.["accountability"] ?? null,
			[ENV_KEY]: this.envs
		};
		context["flow"] ??= flow;
		let nextOperation = flow.operation;
		let lastOperationStatus = "unknown";
		const steps = [];
		while (nextOperation !== null) {
			const { successor, data: data$1, status, options } = await this.executeOperation(nextOperation, keyedData, context);
			keyedData[nextOperation.key] = data$1;
			keyedData[LAST_KEY] = data$1;
			lastOperationStatus = status;
			steps.push({
				operation: nextOperation.id,
				key: nextOperation.key,
				status,
				options
			});
			nextOperation = successor;
		}
		if (flow.accountability !== null) {
			const activityService = new ActivityService({
				knex: database,
				schema
			});
			const accountability = context?.["accountability"];
			const activity = await activityService.createOne({
				action: Action.RUN,
				user: accountability?.user ?? null,
				collection: "directus_flows",
				ip: accountability?.ip ?? null,
				user_agent: accountability?.userAgent ?? null,
				origin: accountability?.origin ?? null,
				item: flow.id
			});
			if (flow.accountability === "all") await new RevisionsService({
				knex: database,
				schema
			}).createOne({
				activity,
				collection: "directus_flows",
				item: flow.id,
				data: {
					steps: steps.map((step) => redactObject(step, { values: this.envs }, getRedactedString)),
					data: redactObject(keyedData, {
						keys: [
							[
								"**",
								"headers",
								"authorization"
							],
							[
								"**",
								"headers",
								"cookie"
							],
							[
								"**",
								"query",
								"access_token"
							],
							[
								"**",
								"payload",
								"password"
							],
							[
								"**",
								"payload",
								"token"
							],
							[
								"**",
								"payload",
								"tfa_secret"
							],
							[
								"**",
								"payload",
								"external_identifier"
							],
							[
								"**",
								"payload",
								"auth_data"
							],
							[
								"**",
								"payload",
								"credentials"
							],
							[
								"**",
								"payload",
								"ai_openai_api_key"
							],
							[
								"**",
								"payload",
								"ai_anthropic_api_key"
							],
							[
								"**",
								"payload",
								"ai_google_api_key"
							],
							[
								"**",
								"payload",
								"ai_openai_compatible_api_key"
							]
						],
						values: this.envs
					}, getRedactedString)
				}
			});
		}
		if ((flow.trigger === "manual" || flow.trigger === "webhook") && flow.options["async"] !== true && flow.options["error_on_reject"] === true && lastOperationStatus === "reject") throw keyedData[LAST_KEY];
		if (flow.trigger === "event" && flow.options["type"] === "filter" && lastOperationStatus === "reject") throw keyedData[LAST_KEY];
		if (flow.options["return"] === "$all") return keyedData;
		else if (flow.options["return"]) return get$1(keyedData, flow.options["return"]);
	}
	async executeOperation(operation, keyedData, context = {}) {
		const logger = useLogger();
		if (!this.operations.has(operation.type)) {
			logger.warn(`Couldn't find operation ${operation.type}`);
			return {
				successor: null,
				status: "unknown",
				data: null,
				options: null
			};
		}
		const handler = this.operations.get(operation.type);
		let optionData = keyedData;
		if (operation.type === "log") optionData = redactObject(keyedData, { keys: [
			[
				"**",
				"headers",
				"authorization"
			],
			[
				"**",
				"headers",
				"cookie"
			],
			[
				"**",
				"query",
				"access_token"
			],
			[
				"**",
				"payload",
				"password"
			],
			[
				"**",
				"payload",
				"token"
			],
			[
				"**",
				"payload",
				"tfa_secret"
			],
			[
				"**",
				"payload",
				"external_identifier"
			],
			[
				"**",
				"payload",
				"auth_data"
			],
			[
				"**",
				"payload",
				"credentials"
			],
			[
				"**",
				"payload",
				"ai_openai_api_key"
			],
			[
				"**",
				"payload",
				"ai_anthropic_api_key"
			],
			[
				"**",
				"payload",
				"ai_google_api_key"
			],
			[
				"**",
				"payload",
				"ai_openai_compatible_api_key"
			]
		] }, getRedactedString);
		let options = operation.options;
		try {
			options = applyOptionsData(options, optionData);
			let result = await handler(options, {
				services: services_exports,
				env: useEnv(),
				database: database_default(),
				logger,
				getSchema,
				data: keyedData,
				accountability: null,
				...context
			});
			JSON.stringify(result ?? null);
			if (typeof result === "object" && result !== null) result = deepMap(result, (value) => value === void 0 ? null : value);
			return {
				successor: operation.resolve,
				status: "resolve",
				data: result ?? null,
				options
			};
		} catch (error) {
			let data;
			if (error instanceof Error) {
				delete error.stack;
				data = error;
			} else if (typeof error === "string") data = isValidJSON(error) ? parseJSON(error) : error;
			else data = error ?? null;
			return {
				successor: operation.reject,
				status: "reject",
				data,
				options
			};
		}
	}
};

//#endregion
export { getFlowManager };