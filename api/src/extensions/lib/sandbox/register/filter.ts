import type { FilterHandler, PromiseCallback } from '@directus/types';
import type { Reference } from 'isolated-vm';
import { types } from 'node:util';
import emitter from '../../../../emitter.js';
import { callReference } from './call-reference.js';

export function registerFilterGenerator() {
	const unregisterFunctions: PromiseCallback[] = [];

	const registerFilter = (
		event: Reference<string>,
		cb: Reference<(payload: unknown) => unknown | Promise<unknown>>,
	) => {
		if (event.typeof !== 'string') throw new TypeError('Filter event has to be of type string');
		if (cb.typeof !== 'function') throw new TypeError('Filter handler has to be of type function');

		const eventCopied = event.copySync();

		const handler: FilterHandler = async (payload) => {
			// A grouped event hands its list behind a Proxy, which the copy into the
			// isolate cannot serialize.
			const copyablePayload = types.isProxy(payload) && Array.isArray(payload)
				? Array.from(payload)
				: payload;

			const response = await callReference(cb, [copyablePayload]);

			return response.copy();
		};

		emitter.onFilter(eventCopied, handler);

		unregisterFunctions.push(() => {
			emitter.offFilter(eventCopied, handler);
		});
	};

	return { register: registerFilter, unregisterFunctions };
}
