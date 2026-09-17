import { useEnv } from '@directus/env';
import type { Accountability } from '@directus/types';
import { getOperationAST, GraphQLError, parse } from 'graphql';
import type { SubscribePayload } from 'graphql-ws';

/**
 * graphql-ws runs a mutation like any query, and the HTTP guards never see a
 * socket: an impersonated one is refused here while writes are off. A document
 * that does not parse is left to the server, which reports that itself.
 */
export function refuseImpersonatedMutation(
	accountability: Accountability | null,
	payload: SubscribePayload,
): GraphQLError[] | undefined {
	if (!accountability?.impersonator || useEnv()['IMPERSONATION_WRITES'] === true) {
		return undefined;
	}

	let operation;

	try {
		operation = getOperationAST(parse(payload.query), payload.operationName);
	}
	catch {
		return undefined;
	}

	if (operation?.operation !== 'mutation') {
		return undefined;
	}

	return [
		new GraphQLError('An impersonation is read-only: impersonation_read_only'),
	];
}
