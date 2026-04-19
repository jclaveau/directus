import { useLogger } from "../logger/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { getDateFormatted } from "../utils/get-date-formatted.js";
import { parseFields } from "../database/get-ast-from-query/lib/parse-fields.js";
import { transaction } from "../utils/transaction.js";
import { FilesService } from "./files.js";
import { Url } from "../utils/url.js";
import { userName } from "../utils/user-name.js";
import { UsersService } from "./users.js";
import { NotificationsService } from "./notifications.js";
import { getService } from "../utils/get-service.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError, ServiceUnavailableError, UnsupportedMediaTypeError } from "@directus/errors";
import { appendFile } from "node:fs/promises";
import { parseJSON, toArray } from "@directus/utils";
import { isSystemCollection } from "@directus/system-data";
import { createTmpFile } from "@directus/utils/node";
import { queue } from "async";
import destroyStream from "destroy";
import { dump } from "js-yaml";
import { parse } from "js2xmlparser";
import { Parser, transforms } from "json2csv";
import { createReadStream, createWriteStream } from "node:fs";
import Papa from "papaparse";
import StreamArray from "stream-json/streamers/StreamArray.js";

//#region src/services/import-export.ts
const env = useEnv();
const logger = useLogger();
var ImportService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async import(collection, mimetype, stream) {
		if (this.accountability?.admin !== true && isSystemCollection(collection)) throw new ForbiddenError({
			reason: `'${this.accountability?.user}' can't import to '${collection}' as not being an admin`,
			values: {
				collection,
				mimetype,
				accountability: this.accountability
			}
		});
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
		switch (mimetype) {
			case "application/json": return await this.importJSON(collection, stream);
			case "text/csv":
			case "application/vnd.ms-excel": return await this.importCSV(collection, stream);
			default: throw new UnsupportedMediaTypeError({
				mediaType: mimetype,
				where: "file import"
			});
		}
	}
	async importJSON(collection, stream) {
		const extractJSON = StreamArray.withParser();
		const nestedActionEvents = [];
		return transaction(this.knex, (trx) => {
			const service = getService(collection, {
				knex: trx,
				schema: this.schema,
				accountability: this.accountability
			});
			const saveQueue = queue(async (value) => {
				return await service.upsertOne(value, { bypassEmitAction: (params) => nestedActionEvents.push(params) });
			});
			return new Promise((resolve, reject) => {
				stream.pipe(extractJSON);
				extractJSON.on("data", ({ value }) => {
					saveQueue.push(value);
				});
				extractJSON.on("error", (err) => {
					destroyStream(stream);
					destroyStream(extractJSON);
					reject(new InvalidPayloadError({ reason: err.message }));
				});
				saveQueue.error((err) => {
					reject(err);
				});
				extractJSON.on("end", () => {
					saveQueue.drain(() => {
						for (const nestedActionEvent of nestedActionEvents) emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
						return resolve();
					});
				});
			});
		});
	}
	async importCSV(collection, stream) {
		const tmpFile = await createTmpFile().catch(() => null);
		if (!tmpFile) throw new Error("Failed to create temporary file for import");
		const nestedActionEvents = [];
		return transaction(this.knex, (trx) => {
			const service = getService(collection, {
				knex: trx,
				schema: this.schema,
				accountability: this.accountability
			});
			const saveQueue = queue(async (value) => {
				return await service.upsertOne(value, { bypassEmitAction: (action) => nestedActionEvents.push(action) });
			});
			const transform = (value) => {
				if (value.length === 0) return;
				try {
					const parsedJson = parseJSON(value);
					if (typeof parsedJson === "number") return value;
					return parsedJson;
				} catch {
					return value;
				}
			};
			const PapaOptions = {
				header: true,
				transformHeader: (header) => header.trim(),
				transform
			};
			return new Promise((resolve, reject) => {
				const streams = [stream];
				const cleanup = (destroy = true) => {
					if (destroy) for (const stream$1 of streams) destroyStream(stream$1);
					tmpFile.cleanup().catch(() => {
						logger.warn(`Failed to cleanup temporary import file (${tmpFile.path})`);
					});
				};
				saveQueue.error((error) => {
					reject(error);
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
					fileReadStream.pipe(Papa.parse(Papa.NODE_STREAM_INPUT, PapaOptions)).on("data", (obj) => {
						for (const field in obj) if (obj[field] === void 0) delete obj[field];
						saveQueue.push(obj);
					}).on("error", (error) => {
						cleanup();
						reject(new InvalidPayloadError({ reason: error.message }));
					}).on("end", () => {
						cleanup(false);
						if (!saveQueue.started) return resolve();
						saveQueue.drain(() => {
							for (const nestedActionEvent of nestedActionEvents) emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
							return resolve();
						});
					});
				});
				streams.push(fileWriteStream);
				stream.on("error", (error) => {
					cleanup();
					reject(new Error("Error while retrieving import data", { cause: error }));
				}).pipe(fileWriteStream);
			});
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
						if (format === "csv") {
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
			const storage = toArray(env["STORAGE_LOCATIONS"])[0];
			const title = `export-${collection}-${getDateFormatted()}`;
			const filename = `${title}.${format}`;
			const fileWithDefaults = {
				...options?.file ?? {},
				title: options?.file?.title ?? title,
				filename_download: options?.file?.filename_download ?? filename,
				storage: options?.file?.storage ?? storage,
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
		if (format === "csv") {
			if (input.length === 0) return "";
			const transforms$1 = [transforms.flatten({ separator: "." })];
			const header = options?.includeHeader !== false;
			let string = new Parser(options?.fields ? {
				transforms: transforms$1,
				header,
				fields: options?.fields
			} : {
				transforms: transforms$1,
				header
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
export { ExportService, ImportService, getHeadingsForCsvExport };