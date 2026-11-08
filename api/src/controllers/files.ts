import { useEnv } from '@directus/env';
import { ErrorCode, InvalidPayloadError, isDirectusError } from '@directus/errors';
import formatTitle from '@directus/format-title';
import type { BusboyFileStream, PrimaryKey } from '@directus/types';
import { oneLine, toArray } from '@directus/utils';
import bytes from 'bytes';
import type { RequestHandler } from 'express';
import express from 'express';
import Joi from 'joi';
import { minimatch } from 'minimatch';
import path from 'node:path';
import { useLogger } from '../logger/index.js';
import { respond } from '../middleware/respond.js';
import useCollection from '../middleware/use-collection.js';
import { validateBatch } from '../middleware/validate-batch.js';
import { FilesService } from '../services/files.js';
import { MetaService } from '../services/meta.js';
import { answerOnce } from '../utils/answer-once.js';
import asyncHandler from '../utils/async-handler.js';
import { createBusboy } from '../utils/create-busboy.js';
import { mutationBatchingFromQuery } from '../utils/mutation-batching-from-query.js';
import { sanitizeQuery } from '../utils/sanitize-query.js';

const router = express.Router();
const env = useEnv();

router.use(useCollection('directus_files'));

export const multipartHandler: RequestHandler = (req, res, routeNext) => {
	const next = answerOnce(routeNext);

	if (req.is('multipart/form-data') === false) return next();

	let headers;

	if (req.headers['content-type']) {
		headers = req.headers;
	} else {
		headers = {
			...req.headers,
			'content-type': 'application/octet-stream',
		};
	}

	const busboy = createBusboy(req, {
		headers,
		defParamCharset: 'utf8',
		limits: {
			fileSize: bytes.parse(env['FILES_MAX_UPLOAD_SIZE'] as string) ?? undefined,
		},
	});

	const savedFiles: PrimaryKey[] = [];
	const service = new FilesService({ accountability: req.accountability, schema: req.schema });

	const existingPrimaryKey = req.params['pk'] || undefined;

	const mutationOptions = {
		mutationBatching: mutationBatchingFromQuery(req.query),
	};

	/**
	 * The order of the fields in multipart/form-data is important. We require that all fields
	 * are provided _before_ the files. This allows us to set the storage location, and create
	 * the row in directus_files async during the upload of the actual file.
	 */

	let disk: string = toArray(env['STORAGE_LOCATIONS'] as string)[0]!;
	let payload: any = {};
	let fileCount = 0;

	busboy.on('field', (fieldname, val) => {
		let fieldValue: string | null | boolean = val;

		if (typeof fieldValue === 'string' && fieldValue.trim() === 'null') fieldValue = null;
		if (typeof fieldValue === 'string' && fieldValue.trim() === 'false') fieldValue = false;
		if (typeof fieldValue === 'string' && fieldValue.trim() === 'true') fieldValue = true;

		if (fieldname === 'storage') {
			disk = val;
		}

		payload[fieldname] = fieldValue;
	});

	busboy.on('file', async (_fieldname, fileStream: BusboyFileStream, { filename, mimeType }) => {
		// a part parsed from the same chunk as a refused one
		if (busboy.destroyed) {
			return undefined;
		}

		if (!filename) {
			return busboy.emit('error', new InvalidPayloadError({ reason: `File is missing filename` }));
		}

		const allowedPatterns = toArray(env['FILES_MIME_TYPE_ALLOW_LIST'] as string | string[]);
		const mimeTypeAllowed = allowedPatterns.some((pattern) => minimatch(mimeType, pattern));

		if (mimeTypeAllowed === false) {
			return busboy.emit('error', new InvalidPayloadError({ reason: `File is of invalid content type` }));
		}

		fileCount++;

		if (!existingPrimaryKey) {
			if (!payload.title) {
				payload.title = formatTitle(path.parse(filename).name);
			}
		}

		payload.filename_download ||= filename;

		const payloadWithRequiredFields = {
			...payload,
			type: mimeType,
			storage: payload.storage || disk,
		};

		// Clear the payload for the next to-be-uploaded file
		payload = {};

		try {
			const primaryKey = await service.uploadOne(
				fileStream,
				payloadWithRequiredFields,
				existingPrimaryKey,
				mutationOptions,
			);

			savedFiles.push(primaryKey);

			if (isBodyRefused) {
				await deleteSavedFiles();
			}
			else {
				tryDone();
			}
		} catch (error: any) {
			busboy.emit('error', error);
		}

		return undefined;
	});

	let isBodyRefused = false;

	busboy.on('error', async (error: Error) => {
		isBodyRefused = true;
		await deleteSavedFiles();
		next(error);
	});

	let isParserClosed = false;

	busboy.on('close', () => {
		isParserClosed = true;
		tryDone();
	});

	req.pipe(busboy);

	// a refused body leaves no file behind; a replaced file cannot be restored
	async function deleteSavedFiles() {
		if (existingPrimaryKey) {
			return;
		}

		const createdFiles = savedFiles.splice(0);

		if (createdFiles.length === 0) {
			return;
		}

		try {
			await service.deleteMany(createdFiles);
		}
		catch (error) {
			useLogger().error(
				error,
				oneLine`Couldn't delete the files ${JSON.stringify(createdFiles)}
					of a refused upload`,
			);
		}
	}

	function tryDone() {
		// a file saved before the next one's headers arrive must not answer yet
		if (isParserClosed && savedFiles.length === fileCount) {
			if (fileCount === 0) {
				return next(new InvalidPayloadError({ reason: `No files were included in the body` }));
			}

			res.locals['savedFiles'] = savedFiles;
			return next();
		}
	}
};

router.post(
	'/',
	asyncHandler(multipartHandler),
	asyncHandler(async (req, res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let keys: PrimaryKey | PrimaryKey[] = [];

		if (req.is('multipart/form-data')) {
			keys = res.locals['savedFiles'];
		} else {
			keys = await service.createOne(req.body, {
				mutationBatching: mutationBatchingFromQuery(req.query),
			});
		}

		try {
			if (Array.isArray(keys) && keys.length > 1) {
				const records = await service.readMany(keys, req.sanitizedQuery);

				res.locals['payload'] = {
					data: records,
				};
			} else {
				const key = Array.isArray(keys) ? keys[0]! : keys;
				const record = await service.readOne(key, req.sanitizedQuery);

				res.locals['payload'] = {
					data: record,
				};
			}
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

const importSchema = Joi.object({
	url: Joi.string().required(),
	data: Joi.object(),
});

router.post(
	'/import',
	asyncHandler(async (req, res, next) => {
		const { error } = importSchema.validate(req.body);

		if (error) {
			throw new InvalidPayloadError({ reason: error.message });
		}

		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const primaryKey = await service.importOne(req.body.url, req.body.data);

		try {
			const record = await service.readOne(primaryKey, req.sanitizedQuery);
			res.locals['payload'] = { data: record || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

const readHandler = asyncHandler(async (req, res, next) => {
	const service = new FilesService({
		accountability: req.accountability,
		schema: req.schema,
	});

	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema,
	});

	let result;

	if (req.singleton) {
		result = await service.readSingleton(req.sanitizedQuery);
	} else if (req.body.keys) {
		result = await service.readMany(req.body.keys, req.sanitizedQuery);
	} else {
		result = await service.readByQuery(req.sanitizedQuery);
	}

	const meta = await metaService.getMetaForQuery('directus_files', req.sanitizedQuery);

	res.locals['payload'] = { data: result, meta };
	return next();
});

router.get('/', validateBatch('read'), readHandler, respond);
router.search('/', validateBatch('read'), readHandler, respond);

router.get(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const record = await service.readOne(req.params['pk']!, req.sanitizedQuery);
		res.locals['payload'] = { data: record || null };
		return next();
	}),
	respond,
);

router.patch(
	'/',
	validateBatch('update'),
	asyncHandler(async (req, res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const mutationOptions = {
			mutationBatching: mutationBatchingFromQuery(req.query),
		};

		let keys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			keys = await service.updateBatch(req.body, mutationOptions);
		} else if (req.body.keys) {
			keys = await service.updateMany(
				req.body.keys,
				req.body.data,
				mutationOptions,
			);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);

			keys = await service.updateByQuery(
				sanitizedQuery,
				req.body.data,
				mutationOptions,
			);
		}

		try {
			const result = await service.readMany(keys, req.sanitizedQuery);
			res.locals['payload'] = { data: result || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.patch(
	'/:pk',
	asyncHandler(multipartHandler),
	asyncHandler(async (req, res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.updateOne(req.params['pk']!, req.body, {
			mutationBatching: mutationBatchingFromQuery(req.query),
		});

		try {
			const record = await service.readOne(req.params['pk']!, req.sanitizedQuery);
			res.locals['payload'] = { data: record || null };
		} catch (error: any) {
			if (isDirectusError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.delete(
	'/',
	validateBatch('delete'),
	asyncHandler(async (req, _res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		if (Array.isArray(req.body)) {
			await service.deleteMany(req.body);
		} else if (req.body.keys) {
			await service.deleteMany(req.body.keys);
		} else {
			const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
			await service.deleteByQuery(sanitizedQuery);
		}

		return next();
	}),
	respond,
);

router.delete(
	'/:pk',
	asyncHandler(async (req, _res, next) => {
		const service = new FilesService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.deleteOne(req.params['pk']!);

		return next();
	}),
	respond,
);

export default router;
