import { createError, DatabasePoolExhaustedError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import axios, { AxiosError } from 'axios';
import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import getDatabase, {
	getConnectionNameForAccountability,
	getDatabaseForAccountability,
} from '../database/index.js';
import { extractDatabaseError } from '../database/errors/translate.js';
import { useLogger } from '../logger/index.js';
import * as errorHandlerMod from './error-handler.js';

vi.mock('../database/index');
vi.mock('../database/errors/translate.js');
vi.mock('../logger/index');

let mockRequest: Request;
let mockResponse: Response;
const nextFunction = vi.fn();
let mockLogger: Logger;

beforeEach(() => {
	mockRequest = {} as Request;

	mockResponse = {
		status: vi.fn(),
		json: vi.fn(),
		header: vi.fn(),
	} as unknown as Response;

	mockLogger = {
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as Logger;

	vi.mocked(useLogger).mockReturnValue(mockLogger);
});

const FALLBACK_ERROR = {
	extensions: {
		code: 'INTERNAL_SERVER_ERROR',
	},
	message: 'An unexpected error occurred.',
};

const FALLBACK_STATUS = 500;

describe('Error handler behaves correctly in express app', () => {
	const startApp = (routeHandler: RequestHandler) =>
		new Promise<number>((resolve, reject) => {
			const app = express();

			const server = http.createServer(app);
			server.on('error', (error) => reject(error));

			app.get('/', (req, res, next) => {
				server.close();
				routeHandler(req, res, next);
			});

			app.use(errorHandlerMod.errorHandler);

			server.listen(() => {
				const { port } = server.address() as AddressInfo;
				resolve(port);
			});
		});

	const error = new (createError('NOT_FOUND', `Rabbit not found`, 404))();

	test('Handler is called in case of express route error', async () => {
		const spy = vi.spyOn(errorHandlerMod, 'errorHandler');

		const port = await startApp(() => {
			// Error in route
			throw error;
		});

		expect.assertions(2);

		try {
			await axios(`http://0:${port}`);
		} catch (axiosError) {
			expect((axiosError as AxiosError).response?.data).toMatchObject({
				errors: [
					{
						extensions: {
							code: error.code,
						},
						message: error.message,
					},
				],
			});
		}

		expect(spy.mock.calls[0]?.[0]).toBe(error);
	});

	test('Handler catches the case where headers have already been sent', async () => {
		const spy = vi.spyOn(errorHandlerMod, 'errorHandler');

		const response = { data: { carrots: 1000 } };

		const port = await startApp((_req, res) => {
			res.json(response);
			// Error after response has already be sent
			throw error;
		});

		const { data } = await axios(`http://0:${port}`);

		expect(data).toMatchObject(response);
		expect(spy.mock.calls[0]?.[0]).toBe(error);

		expect(mockLogger.error).toHaveBeenLastCalledWith(
			expect.objectContaining({
				message: 'Cannot set headers after they are sent to the client',
				code: 'ERR_HTTP_HEADERS_SENT',
			}),
			'Unexpected error in error handler',
		);
	});
});

describe('DirectusError', () => {
	const error1 = new (createError('IM_A_RABBIT', `I'm a rabbit`, 418))();
	const error2 = new (createError('OUT_OF_CARROTS', 'Temporarily out of carrots', 503))();

	test('Respond with data from single error', async () => {
		await errorHandlerMod.errorHandler(error1, mockRequest, mockResponse, nextFunction);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					extensions: {
						code: error1.code,
					},
					message: error1.message,
				},
			],
		});
	});

	test('Respond with data from multiple errors', async () => {
		await errorHandlerMod.errorHandler([error1, error2], mockRequest, mockResponse, nextFunction);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					extensions: {
						code: error1.code,
					},
					message: error1.message,
				},
				{
					extensions: {
						code: error2.code,
					},
					message: error2.message,
				},
			],
		});
	});

	test('Respond with fallback error if one of the errors is unknown', async () => {
		await errorHandlerMod.errorHandler([error1, new Error()], mockRequest, mockResponse, nextFunction);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [FALLBACK_ERROR],
		});
	});

	test('Respond with status from error', async () => {
		await errorHandlerMod.errorHandler(error1, mockRequest, mockResponse, nextFunction);

		expect(mockResponse.status).toHaveBeenCalledWith(error1.status);
	});

	test('Respond with status from multiple errors if they match', async () => {
		await errorHandlerMod.errorHandler([error1, error1], mockRequest, mockResponse, nextFunction);

		expect(mockResponse.status).toHaveBeenCalledWith(error1.status);
	});

	test('Respond with fallback status if error statuses do not match', async () => {
		await errorHandlerMod.errorHandler([error1, error2], mockRequest, mockResponse, nextFunction);

		expect(mockResponse.status).toHaveBeenCalledWith(FALLBACK_STATUS);
	});
});

describe('Database pool exhaustion', () => {
	test('Translates a pool-acquire timeout to a 429 error', async () => {
		vi.mocked(extractDatabaseError).mockResolvedValueOnce(
			new DatabasePoolExhaustedError({
				reason: 'client_pool_timeout',
				connection: null,
			}),
		);

		vi.mocked(getConnectionNameForAccountability).mockReturnValue('premium');

		await errorHandlerMod.errorHandler(
			new Error('Timeout acquiring a connection'),
			mockRequest,
			mockResponse,
			nextFunction,
		);

		expect(mockResponse.status).toHaveBeenCalledWith(429);
		expect(mockResponse.header).toHaveBeenCalledWith('Retry-After', '1');

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					message: expect.stringContaining('Database connection pool exhausted'),
					extensions: {
						code: 'DATABASE_POOL_EXHAUSTED',
						reason: 'client_pool_timeout',
						connection: 'premium',
					},
				},
			],
		});
	});

	test('Attaches the connection name to a write-path pool error', async () => {
		// Write sites throw the DatabasePoolExhaustedError directly (already a
		// DirectusError, connection null), so it skips extractDatabaseError — the
		// handler must still tag the tier, same as the read path above.
		vi.mocked(getConnectionNameForAccountability).mockReturnValue('premium');

		await errorHandlerMod.errorHandler(
			new DatabasePoolExhaustedError({
				reason: 'pool_queue_timeout',
				connection: null,
			}),
			mockRequest,
			mockResponse,
			nextFunction,
		);

		expect(mockResponse.status).toHaveBeenCalledWith(429);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					message: expect.stringContaining('Database connection pool exhausted'),
					extensions: {
						code: 'DATABASE_POOL_EXHAUSTED',
						reason: 'pool_queue_timeout',
						connection: 'premium',
					},
				},
			],
		});
	});

	test('Keeps a connection tier already set on the error', async () => {
		// A pre-tagged pool error is left as-is — the resolver never overwrites it
		// (decoy return value proves the guard, not a coincidence).
		vi.mocked(getConnectionNameForAccountability).mockReturnValue('default');

		await errorHandlerMod.errorHandler(
			new DatabasePoolExhaustedError({
				reason: 'too_many_connections',
				connection: 'free',
			}),
			mockRequest,
			mockResponse,
			nextFunction,
		);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					message: expect.stringContaining('Database connection pool exhausted'),
					extensions: {
						code: 'DATABASE_POOL_EXHAUSTED',
						reason: 'too_many_connections',
						connection: 'free',
					},
				},
			],
		});
	});

	test('Falls back to base pool if the routed build throws', async () => {
		// A misconfigured named connection makes getDatabaseForAccountability throw
		// during error handling; the handler must fall back to the base pool and
		// still translate, not mask the original error behind a generic 500.
		const baseKnex = { client: {} } as unknown as Knex;

		vi.mocked(getDatabaseForAccountability).mockImplementationOnce(() => {
			throw new Error('bad DB_CONNECTION_PREMIUM_* config');
		});

		vi.mocked(getDatabase).mockReturnValue(baseKnex);

		vi.mocked(extractDatabaseError).mockResolvedValueOnce(
			new DatabasePoolExhaustedError({
				reason: 'too_many_connections',
				connection: null,
			}),
		);

		vi.mocked(getConnectionNameForAccountability).mockReturnValue('premium');

		await errorHandlerMod.errorHandler(
			new Error('too many connections'),
			mockRequest,
			mockResponse,
			nextFunction,
		);

		// Translated on the fallback pool → 429, not a masked 500.
		expect(extractDatabaseError).toHaveBeenCalledWith(
			expect.any(Error),
			{},
			baseKnex,
		);

		expect(mockResponse.status).toHaveBeenCalledWith(429);
	});
});

describe('Unknown errors', () => {
	const error = new Error('Lost in rabbit hole');

	test('Respond with data from error for admin users', async () => {
		mockRequest.accountability = { admin: true } as Accountability;

		await errorHandlerMod.errorHandler(error, mockRequest, mockResponse, nextFunction);

		expect(mockResponse.json).toHaveBeenCalledWith({
			errors: [
				{
					extensions: {
						code: FALLBACK_ERROR.extensions.code,
					},
					message: error.message,
				},
			],
		});
	});

	test('Do not expose error data to non-admin users', async () => {
		await errorHandlerMod.errorHandler(error, mockRequest, mockResponse, nextFunction);

		expect(mockResponse.json).toHaveBeenCalledWith({ errors: [FALLBACK_ERROR] });
	});
});

test('Catch error within the handler and respond with fallback error', async () => {
	// Provoke error within handler
	const handlerError = new Error('Unexpected error');

	mockResponse.json = vi.fn().mockImplementationOnce(() => {
		throw handlerError;
	});

	const appError = new (createError('TOO_EARLY', `Rabbit still sleeping`, 425))();

	await errorHandlerMod.errorHandler(appError, mockRequest, mockResponse, nextFunction);

	expect(mockLogger.error).toHaveBeenLastCalledWith(handlerError, 'Unexpected error in error handler');

	expect(mockResponse.status).toHaveBeenCalledWith(FALLBACK_STATUS);
	expect(mockResponse.json).toHaveBeenCalledWith({ errors: [FALLBACK_ERROR] });
});
