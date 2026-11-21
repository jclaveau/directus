import { InvalidPayloadError } from '@directus/errors';
import express, {
	type ErrorRequestHandler,
	type Router,
} from 'express';
import { WEBHOOK_MOUNT_PATH } from '../constants.js';

/**
 * Providers sign the exact bytes they send, so the webhook path is read raw
 * before Directus' JSON parser, which then skips the already-read body.
 */
export function mountRawBody(
	expressApp: Pick<Router, 'use'>,
	maxPayloadSize: string,
): void {
	const rejectUnreadableBody: ErrorRequestHandler = (
		parseError: Error,
		_request,
		_response,
		next,
	) => {
		next(new InvalidPayloadError(
			{ reason: parseError.message },
			{ cause: parseError },
		));
	};

	expressApp.use(
		WEBHOOK_MOUNT_PATH,
		express.raw({ type: () => true, limit: maxPayloadSize }),
		rejectUnreadableBody,
	);
}

export function readMaxPayloadSize(env: Record<string, unknown>): string {
	const maxPayloadSize = env['MAX_PAYLOAD_SIZE'];

	if (typeof maxPayloadSize !== 'string') {
		throw new Error(
			'"MAX_PAYLOAD_SIZE" must be a string, got'
			+ ` ${JSON.stringify(maxPayloadSize)}`,
		);
	}

	return maxPayloadSize;
}
