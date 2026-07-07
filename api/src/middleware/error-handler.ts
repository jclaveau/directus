import { ErrorCode, InternalServerError, isDirectusError } from '@directus/errors';
import type { DeepPartial } from '@directus/types';
import { isObject } from '@directus/utils';
import { getNodeEnv } from '@directus/utils/node';
import type { ErrorRequestHandler } from 'express';
import getDatabase, { getConnectionNameForAccountability } from '../database/index.js';
import { extractDatabaseError } from '../database/errors/translate.js';
import type { SQLError } from '../database/errors/dialects/types.js';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';

type ApiError = {
	message: string;
	extensions: {
		code: string;
		[key: string]: any;
	};
};

const FALLBACK_ERROR = new InternalServerError();

export const errorHandler = asyncErrorHandler(async (err, req, res) => {
	const logger = useLogger();

	let errors: ApiError[] = [];
	let status: number | null = null;

	// It can be assumed that at least one error is given
	const rawErrors: unknown[] = Array.isArray(err)
		? err
		: [err];

	// Route every unknown error through the DB dialect translator: it turns a raw driver error
	// (constraint OR pool exhaustion, on reads or writes) into the dedicated Directus error, and
	// returns non-DB errors untouched — so nothing is missed and the `database.error` hook (write
	// path only) never fires here. Pool errors get the routed connection tier tagged on — only the
	// request knows it.
	const receivedErrors: unknown[] = await Promise.all(
		rawErrors.map(async (error) => {
			if (isDirectusError(error)) {
				return error;
			}

			const translated = await extractDatabaseError(error as SQLError, {});

			if (!isDirectusError(translated)) {
				return error;
			}

			if (isDirectusError(translated, ErrorCode.DatabasePoolExhausted)) {
				const extensions = translated.extensions as { connection: string | null };
				extensions.connection = getConnectionNameForAccountability(req.accountability);
			}

			return translated;
		}),
	);

	for (const error of receivedErrors) {
		// In dev mode, if available, expose stack trace under error's extensions data
		if (getNodeEnv() === 'development' && error instanceof Error && error.stack) {
			((error as DeepPartial<ApiError>).extensions ??= {})['stack'] = error.stack;
		}

		if (isDirectusError(error)) {
			logger.debug(error);

			if (status === null) {
				// Use current error status as response status
				status = error.status;
			} else if (status !== error.status) {
				// Fallback if status has already been set by a preceding error
				// and doesn't match the current one
				status = FALLBACK_ERROR.status;
			}

			errors.push({
				message: error.message,
				extensions: {
					...(error.extensions ?? {}),
					// Expose error code under error's extensions data
					code: error.code,
				},
			});

			if (isDirectusError(error, ErrorCode.MethodNotAllowed)) {
				res.header('Allow', error.extensions.allowed.join(', '));
			}

			if (isDirectusError(error, ErrorCode.DatabasePoolExhausted)) {
				res.header('Retry-After', '1'); // seconds; pool exhaustion is transient
			}
		} else {
			logger.error(error);

			status = FALLBACK_ERROR.status;

			if (req.accountability?.admin === true) {
				const localError = isObject(error) ? error : {};

				// Use 'message' prop if available, otherwise if 'error' is a string use that
				const message =
					(typeof localError['message'] === 'string' ? localError['message'] : null) ??
					(typeof error === 'string' ? error : null);

				errors = [
					{
						message: message || FALLBACK_ERROR.message,
						extensions: {
							code: FALLBACK_ERROR.code,
							...(localError['extensions'] ?? {}),
						},
					},
				];
			} else {
				// Don't expose unknown errors to non-admin users
				errors = [{ message: FALLBACK_ERROR.message, extensions: { code: FALLBACK_ERROR.code } }];
			}
		}
	}

	res.status(status ?? FALLBACK_ERROR.status);

	const updatedErrors = await emitter.emitFilter(
		'request.error',
		errors,
		{},
		{
			database: getDatabase(),
			schema: req.schema,
			accountability: req.accountability ?? null,
		},
	);

	return res.json({ errors: updatedErrors });
});

function asyncErrorHandler(
	fn: (...args: Parameters<ErrorRequestHandler>) => Promise<any>,
): (...args: Parameters<ErrorRequestHandler>) => Promise<ReturnType<ErrorRequestHandler>> {
	return (err, req, res, next) =>
		fn(err, req, res, next).catch((error) => {
			// To be on the safe side and ensure this doesn't lead to an unhandled (potentially crashing) error
			try {
				const logger = useLogger();
				logger.error(error, 'Unexpected error in error handler');
			} catch {
				// Ignore
			}

			// Delegate to default error handler to close the connection
			if (res.headersSent) return next(err);

			res.status(FALLBACK_ERROR.status);
			return res.json({ errors: [{ message: FALLBACK_ERROR.message, extensions: { code: FALLBACK_ERROR.code } }] });
		});
}
