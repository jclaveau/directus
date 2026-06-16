import { useLogger } from "../logger/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { transaction } from "../utils/transaction.js";
import { parseFields } from "../database/get-ast-from-query/lib/parse-fields.js";
import { FilesService } from "./files.js";
import { destroyPipedStream } from "../utils/destroy-piped-stream.js";
import { getService } from "../utils/get-service.js";
import { useStore } from "../utils/store.js";
import { Url } from "../utils/url.js";
import { userName } from "../utils/user-name.js";
import { UsersService } from "./users.js";
import { NotificationsService } from "./notifications.js";
import { appendFile } from "node:fs/promises";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, LimitExceededError, ServiceUnavailableError, TimeoutError, UnsupportedMediaTypeError, createError } from "@directus/errors";
import { getDateTimeFormatted, parseJSON, toArray } from "@directus/utils";
import { set } from "lodash-es";
import { createTmpFile } from "@directus/utils/node";
import ms from "ms";
import { isSystemCollection } from "@directus/system-data";
import { createReadStream, createWriteStream } from "node:fs";
import { queue } from "async";
import { dump } from "js-yaml";
import { parse } from "js2xmlparser";
import { Parser, transforms } from "json2csv";
import Papa from "papaparse";
import StreamArray from "stream-json/streamers/StreamArray.js";

//#region src/services/import-export.ts
const env = useEnv();
const logger = useLogger();
const MAX_IMPORT_ERRORS = env["MAX_IMPORT_ERRORS"];
function createErrorTracker() {
	let genericError;
	const fieldErrors = /* @__PURE__ */ new Map();
	let capturedErrorCount = 0;
	let isLimitReached = false;
	function convertToRanges(rows, minRangeSize = 4) {
		const sorted = Array.from(new Set(rows)).sort((a, b) => a - b);
		const result = [];
		if (sorted.length === 0) return [];
		let start = sorted[0];
		let prev = sorted[0];
		let count = 1;
		const nonConsecutive = [];
		const flush = () => {
			if (count >= minRangeSize) result.push({
				type: "range",
				start,
				end: prev
			});
			else for (let i = start; i <= prev; i++) nonConsecutive.push(i);
		};
		for (let i = 1; i < sorted.length; i++) {
			const current = sorted[i];
			if (current === prev + 1) {
				prev = current;
				count++;
			} else {
				flush();
				start = prev = current;
				count = 1;
			}
		}
		flush();
		if (nonConsecutive.length > 0) result.push({
			type: "lines",
			rows: nonConsecutive
		});
		return result;
	}
	function addCapturedError(err, rowNumber) {
		const field = err.extensions?.field;
		if (field) {
			const type = err.extensions?.type;
			const substring = err.extensions?.substring;
			const valid = err.extensions?.valid;
			const invalid = err.extensions?.invalid;
			let key = type ? `${field}|${type}` : field;
			if (substring !== void 0) key += `|substring:${substring}`;
			if (valid !== void 0) key += `|valid:${JSON.stringify(valid)}`;
			if (invalid !== void 0) key += `|invalid:${JSON.stringify(invalid)}`;
			if (!fieldErrors.has(err.code)) fieldErrors.set(err.code, /* @__PURE__ */ new Map());
			const errorsByCode = fieldErrors.get(err.code);
			if (!errorsByCode.has(key)) errorsByCode.set(key, {
				message: err.message,
				rowNumbers: []
			});
			errorsByCode.get(key).rowNumbers.push(rowNumber);
		} else genericError = err;
		capturedErrorCount++;
		if (capturedErrorCount >= MAX_IMPORT_ERRORS) isLimitReached = true;
	}
	function hasGenericError() {
		return genericError !== void 0;
	}
	function buildFinalErrors() {
		if (genericError) return [genericError];
		return Array.from(fieldErrors.entries()).flatMap(([code, fieldMap]) => Array.from(fieldMap.entries()).map(([compositeKey, errorData]) => {
			const parts = compositeKey.split("|");
			const field = parts[0];
			const type = parts[1];
			const extensions = {};
			for (let i = 2; i < parts.length; i++) {
				const [paramType, paramValue] = parts[i]?.split(":", 2) ?? [];
				if (!paramType || paramValue === void 0) continue;
				try {
					extensions[paramType] = JSON.parse(paramValue);
				} catch {
					extensions[paramType] = paramValue;
				}
			}
			return new (createError(code, errorData.message, 400))({
				field,
				type,
				...extensions,
				rows: convertToRanges(errorData.rowNumbers)
			});
		}));
	}
	return {
		addCapturedError,
		buildFinalErrors,
		getCount: () => capturedErrorCount,
		hasErrors: () => capturedErrorCount > 0 || hasGenericError(),
		shouldStop: () => isLimitReached || hasGenericError(),
		hasGenericError
	};
}
const store = useStore(String(env["IMPORT_EXPORT_NAMESPACE"]), { ttl: ms(env["IMPORT_TIMEOUT"] ?? "1h") });
var ImportService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async import(collection, mimetype, stream, options) {
		if (this.accountability?.admin !== true && isSystemCollection(collection)) throw new ForbiddenError();
		if (this.accountability) {
			await validateAccess({
				accountability: this.accountability,
				action: "create",
				collection
			}, {
				schema: this.schema,
				knex: this.knex
			});
			await validateAccess({
				accountability: this.accountability,
				action: "update",
				collection
			}, {
				schema: this.schema,
				knex: this.knex
			});
		}
		if ([
			"application/json",
			"text/csv",
			"application/vnd.ms-excel"
		].includes(mimetype) === false) throw new UnsupportedMediaTypeError({
			mediaType: mimetype,
			where: "file import"
		});
		if (await store(async (store$1) => {
			const count = await store$1.get("importCount") ?? 0;
			if (count >= Number(env["IMPORT_MAX_CONCURRENCY"])) return true;
			await store$1.set("importCount", count + 1);
			return false;
		})) throw new LimitExceededError({ category: "Concurrent import" });
		let promise;
		const decrementImportCount = async () => {
			try {
				await store(async (store$1) => {
					const count = await store$1.get("importCount") ?? 0;
					await store$1.set("importCount", count - 1);
				});
			} catch (error) {
				logger.error(error, `Failed to decrement importCount`);
			}
		};
		if (mimetype === "application/json") promise = this.importJSON(collection, stream);
		else promise = this.importCSV(collection, stream);
		if (options?.background) {
			const notify = async (subject, message) => {
				try {
					if (!this.accountability?.user) return;
					const notificationsService = new NotificationsService({ schema: this.schema });
					const user = await new UsersService({ schema: this.schema }).readOne(this.accountability.user, { fields: [
						"first_name",
						"last_name",
						"email"
					] });
					await notificationsService.createOne({
						recipient: this.accountability.user,
						sender: this.accountability.user,
						subject,
						message: `Hello ${userName(user)},\n\n${message}\n`
					});
				} catch (error) {
					logger.error(error, `Failed to notify user`);
				}
			};
			promise.then(async () => {
				await notify("Your import has been successful", `Your import in ${collection} has been successful.`);
			}).catch(async (error) => {
				logger.error(error, `Background import to ${collection} failed`);
				await notify("Your import has failed", `Your import in ${collection} has failed.\n\n${error.message ?? ""}`);
			}).finally(async () => await decrementImportCount());
		} else try {
			await promise;
		} finally {
			await decrementImportCount();
		}
	}
	async importJSON(collection, stream) {
		const extractJSON = StreamArray.withParser();
		const nestedActionEvents = [];
		const errorTracker = createErrorTracker();
		const isSingleton = this.schema.collections[collection]?.singleton ?? false;
		let timeout;
		return transaction(this.knex, async (trx) => {
			const service = getService(collection, {
				knex: trx,
				schema: this.schema,
				accountability: this.accountability
			});
			try {
				await new Promise((resolve, reject) => {
					let rowNumber = 1;
					const saveQueue = queue(async (task) => {
						if (errorTracker.shouldStop()) return;
						try {
							if (isSingleton) return await service.upsertSingleton(task.data, { bypassEmitAction: (params) => nestedActionEvents.push(params) });
							else return await service.upsertOne(task.data, { bypassEmitAction: (params) => nestedActionEvents.push(params) });
						} catch (error) {
							for (const err of toArray(error)) {
								errorTracker.addCapturedError(err, task.rowNumber);
								if (errorTracker.shouldStop()) break;
							}
							if (errorTracker.shouldStop()) {
								saveQueue.kill();
								destroyPipedStream(extractJSON, stream);
								reject();
							}
							return;
						}
					});
					stream.pipe(extractJSON);
					extractJSON.on("data", ({ value }) => {
						if (isSingleton && rowNumber > 1) {
							saveQueue.kill();
							destroyPipedStream(extractJSON, stream);
							reject(new InvalidPayloadError({ reason: `Cannot import multiple records into singleton collection ${collection}` }));
							return;
						}
						saveQueue.push({
							data: value,
							rowNumber: rowNumber++
						});
					});
					extractJSON.on("error", (err) => {
						destroyPipedStream(extractJSON, stream);
						reject(new InvalidPayloadError({ reason: err.message }));
					});
					extractJSON.on("end", () => {
						if (!saveQueue.started) return resolve();
						saveQueue.drain(() => {
							if (errorTracker.hasErrors()) return reject();
							for (const nestedActionEvent of nestedActionEvents) emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
							return resolve();
						});
					});
					const duration = ms(env["IMPORT_TIMEOUT"]);
					timeout = setTimeout(() => {
						saveQueue.kill();
						destroyPipedStream(extractJSON, stream);
						reject(new TimeoutError({
							category: "Import",
							duration
						}));
					}, duration);
				});
			} catch (error) {
				if (!error && errorTracker.hasErrors()) throw errorTracker.buildFinalErrors();
				throw error;
			} finally {
				clearTimeout(timeout);
			}
		});
	}
	async importCSV(collection, stream) {
		const tmpFile = await createTmpFile().catch(() => null);
		if (!tmpFile) throw new Error("Failed to create temporary file for import");
		const nestedActionEvents = [];
		const errorTracker = createErrorTracker();
		const isSingleton = this.schema.collections[collection]?.singleton ?? false;
		let timeout;
		return transaction(this.knex, async (trx) => {
			const service = getService(collection, {
				knex: trx,
				schema: this.schema,
				accountability: this.accountability
			});
			try {
				await new Promise((resolve, reject) => {
					const streams = [stream];
					let rowNumber = 0;
					const cleanup = (destroy = true) => {
						if (destroy) for (const stream$1 of streams) stream$1.destroy();
						tmpFile.cleanup().catch(() => {
							logger.warn(`Failed to cleanup temporary import file (${tmpFile.path})`);
						});
					};
					const saveQueue = queue(async (task) => {
						if (errorTracker.shouldStop()) return;
						try {
							if (isSingleton) return await service.upsertSingleton(task.data, { bypassEmitAction: (action) => nestedActionEvents.push(action) });
							else return await service.upsertOne(task.data, { bypassEmitAction: (action) => nestedActionEvents.push(action) });
						} catch (error) {
							for (const err of toArray(error)) {
								errorTracker.addCapturedError(err, task.rowNumber);
								if (errorTracker.shouldStop()) break;
							}
							if (errorTracker.shouldStop()) {
								saveQueue.kill();
								cleanup(true);
								reject();
							}
							return;
						}
					});
					const fileWriteStream = createWriteStream(tmpFile.path).on("error", (error) => {
						cleanup();
						reject(new Error("Error while writing import data to temporary file", { cause: error }));
					}).on("finish", () => {
						const fileReadStream = createReadStream(tmpFile.path).on("error", (error) => {
							cleanup();
							reject(new Error("Error while reading import data from temporary file", { cause: error }));
						});
						streams.push(fileReadStream);
						fileReadStream.pipe(Papa.parse(Papa.NODE_STREAM_INPUT, {
							header: true,
							transformHeader: (header) => header.trim(),
							transform: (value) => {
								if (value.length === 0) return;
								try {
									const parsedJson = parseJSON(value);
									if (typeof parsedJson === "number") return value;
									return parsedJson;
								} catch {
									return value;
								}
							}
						})).on("data", (obj) => {
							rowNumber++;
							if (isSingleton && rowNumber > 1) {
								saveQueue.kill();
								cleanup(true);
								reject(new InvalidPayloadError({ reason: `Cannot import multiple records into singleton collection ${collection}` }));
								return;
							}
							const result = {};
							for (const field in obj) if (obj[field] !== void 0) set(result, field, obj[field]);
							saveQueue.push({
								data: result,
								rowNumber
							});
						}).on("error", (error) => {
							cleanup();
							reject(new InvalidPayloadError({ reason: error.message }));
						}).on("end", () => {
							if (!saveQueue.started) {
								cleanup(false);
								return resolve();
							}
							saveQueue.drain(() => {
								if (!errorTracker.shouldStop()) cleanup(false);
								if (errorTracker.hasErrors()) return reject();
								for (const nestedActionEvent of nestedActionEvents) emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
								return resolve();
							});
						});
					});
					streams.push(fileWriteStream);
					const duration = ms(env["IMPORT_TIMEOUT"]);
					timeout = setTimeout(() => {
						saveQueue.kill();
						destroyPipedStream(fileWriteStream, stream);
						reject(new TimeoutError({
							category: "Import",
							duration
						}));
					}, duration);
					stream.on("error", (error) => {
						cleanup();
						reject(new Error("Error while retrieving import data", { cause: error }));
					}).pipe(fileWriteStream);
				});
			} catch (error) {
				if (!error && errorTracker.hasErrors()) throw errorTracker.buildFinalErrors();
				throw error;
			} finally {
				clearTimeout(timeout);
			}
		});
	}
};
var ExportService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	/**
	* Export the query results as a named file. Will query in batches, and keep appending a tmp file
	* until all the data is retrieved. Uploads the result as a new file using the regular
	* FilesService upload method.
	*/
	async exportToFile(collection, query, format, options) {
		const { createTmpFile: createTmpFile$1 } = await import("@directus/utils/node");
		const tmpFile = await createTmpFile$1().catch(() => null);
		try {
			if (!tmpFile) throw new Error("Failed to create temporary file for export");
			const mimeTypes = {
				csv: "text/csv",
				csv_utf8: "text/csv; charset=utf-8",
				json: "application/json",
				xml: "text/xml",
				yaml: "text/yaml"
			};
			const database = database_default();
			await transaction(database, async (trx) => {
				const service = getService(collection, {
					accountability: this.accountability,
					schema: this.schema,
					knex: trx
				});
				const { primary } = this.schema.collections[collection];
				const sort = query.sort ?? [];
				if (sort.includes(primary) === false) sort.push(primary);
				const totalCount = await service.readByQuery({
					...query,
					aggregate: { count: ["*"] }
				}).then((result) => Number(result?.[0]?.["count"] ?? 0));
				const count = query.limit && query.limit > -1 ? Math.min(totalCount, query.limit) : totalCount;
				const requestedLimit = query.limit ?? -1;
				const batchesRequired = Math.ceil(count / env["EXPORT_BATCH_SIZE"]);
				let readCount = 0;
				for (let batch = 0; batch < batchesRequired; batch++) {
					let limit = env["EXPORT_BATCH_SIZE"];
					if (requestedLimit > 0 && env["EXPORT_BATCH_SIZE"] > requestedLimit - readCount) limit = requestedLimit - readCount;
					const result = await service.readByQuery({
						...query,
						sort,
						limit,
						offset: batch * env["EXPORT_BATCH_SIZE"]
					});
					readCount += result.length;
					if (result.length) {
						let csvHeadings = null;
						if (format.startsWith("csv")) {
							if (!query.fields) query.fields = ["*"];
							csvHeadings = getHeadingsForCsvExport(await parseFields({
								parentCollection: collection,
								fields: query.fields,
								query,
								accountability: this.accountability
							}, {
								schema: this.schema,
								knex: database
							}));
						}
						await appendFile(tmpFile.path, this.transform(result, format, {
							includeHeader: batch === 0,
							includeFooter: batch + 1 === batchesRequired,
							fields: csvHeadings
						}));
					}
				}
			});
			const filesService = new FilesService({
				accountability: this.accountability,
				schema: this.schema
			});
			const title = `export-${collection}-${getDateTimeFormatted()}`;
			const filename = `${title}.${format}`;
			const fileWithDefaults = {
				...options?.file ?? {},
				title: options?.file?.title ?? title,
				filename_download: options?.file?.filename_download ?? filename,
				type: mimeTypes[format]
			};
			const savedFile = await filesService.uploadOne(createReadStream(tmpFile.path), fileWithDefaults);
			if (this.accountability?.user) {
				const notificationsService = new NotificationsService({ schema: this.schema });
				const user = await new UsersService({ schema: this.schema }).readOne(this.accountability.user, { fields: [
					"first_name",
					"last_name",
					"email"
				] });
				const href = new Url(env["PUBLIC_URL"]).addPath("admin", "files", savedFile).toString();
				const message = `
Hello ${userName(user)},

Your export of ${collection} is ready. <a href="${href}">Click here to view.</a>
`;
				await notificationsService.createOne({
					recipient: this.accountability.user,
					sender: this.accountability.user,
					subject: `Your export of ${collection} is ready`,
					message,
					collection: `directus_files`,
					item: savedFile
				});
			}
		} catch (err) {
			logger.error(err, `Couldn't export ${collection}: ${err.message}`);
			if (this.accountability?.user) await new NotificationsService({ schema: this.schema }).createOne({
				recipient: this.accountability.user,
				sender: this.accountability.user,
				subject: `Your export of ${collection} failed`,
				message: `Please contact your system administrator for more information.`
			});
		} finally {
			await tmpFile?.cleanup();
		}
	}
	/**
	* Transform a given input object / array to the given type
	*/
	transform(input, format, options) {
		if (format === "json") {
			let string = JSON.stringify(input || null, null, "	");
			if (options?.includeHeader === false) string = string.split("\n").slice(1).join("\n");
			if (options?.includeFooter === false) {
				const lines = string.split("\n");
				string = lines.slice(0, lines.length - 1).join("\n");
				string += ",\n";
			}
			return string;
		}
		if (format === "xml") {
			let string = parse("data", input);
			if (options?.includeHeader === false) string = string.split("\n").slice(2).join("\n");
			if (options?.includeFooter === false) {
				const lines = string.split("\n");
				string = lines.slice(0, lines.length - 1).join("\n");
				string += "\n";
			}
			return string;
		}
		if (format.startsWith("csv")) {
			if (input.length === 0) return "";
			const transforms$1 = [transforms.flatten({ separator: "." })];
			const header = options?.includeHeader !== false;
			const withBOM = format === "csv_utf8";
			let string = new Parser(options?.fields ? {
				transforms: transforms$1,
				header,
				fields: options?.fields,
				withBOM
			} : {
				transforms: transforms$1,
				header,
				withBOM
			}).parse(input);
			if (options?.includeHeader === false) string = "\n" + string;
			return string;
		}
		if (format === "yaml") return dump(input);
		throw new ServiceUnavailableError({
			service: "export",
			reason: `Illegal export type used: "${format}"`
		});
	}
};
function getHeadingsForCsvExport(nodes, prefix = "") {
	let fieldNames = [];
	if (!nodes) return fieldNames;
	nodes.forEach((node) => {
		switch (node.type) {
			case "field":
			case "functionField":
			case "o2m":
			case "a2o":
				fieldNames.push(prefix ? `${prefix}.${node.fieldKey}` : node.fieldKey);
				break;
			case "m2o": fieldNames = fieldNames.concat(getHeadingsForCsvExport(node.children, prefix ? `${prefix}.${node.fieldKey}` : node.fieldKey));
		}
	});
	return fieldNames;
}

//#endregion
export { ExportService, ImportService, createErrorTracker, getHeadingsForCsvExport };