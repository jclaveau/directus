import { useEnv } from '@directus/env';
import type { WebSocketMessage } from '@directus/types';
import { parse as parseBytesConfiguration } from 'bytes';
import {
	auditAskOf,
	auditAskRefusalOf,
	closeQueryAudit,
	discardAuditedStatements,
	emptyQueryAudit,
	formatQueryAudit,
	levelCarriesBindings,
	type QueryAudit,
	type QueryAuditLevel,
	queryAuditEnabled,
	queryAuditStore,
} from '../database/query-audit.js';
import { WebSocketError, handleWebSocketError } from './errors.js';
import type { WebSocketClient } from './types.js';
import { getMessageType } from './utils/message.js';

type MessageAudit = {
	client: WebSocketClient;
	uid: string;
	level: QueryAuditLevel;
	timings: boolean;
};

const messageAudits = new WeakMap<QueryAudit, MessageAudit>();

const unrepliedAudits = new WeakMap<WebSocketClient, Set<QueryAudit>>();

/**
 * Dev-only, the websocket side of QUERY_AUDIT_HEADER: a frame has no headers,
 * so the SQL a message ran is reported in its reply, the first message sent to
 * its client with its `uid`, as `query_audit`, the JSON the header carries.
 * A message without a `uid` has no reply to find and is not audited. The
 * message picks the level and timings in its own `query_audit` field, the
 * header's words; bound values go to an admin alone, anyone else gets
 * `statements`. What the reply's handling pushes to subscriptions belongs to
 * no reply, so it never carries the audit.
 */
export async function auditMessageQueries(
	client: WebSocketClient,
	message: WebSocketMessage,
	handleMessage: () => Promise<void>,
): Promise<void> {
	if (!queryAuditEnabled() || message.uid === undefined) {
		return handleMessage();
	}

	const askedValue = message['query_audit'];

	// A header carries a string alone: any other value is refused the same.
	const auditAsk = askedValue === undefined || typeof askedValue === 'string'
		? auditAskOf(askedValue, useEnv()['QUERY_AUDIT_LEVEL'])
		: undefined;

	if (auditAsk === undefined) {
		return handleWebSocketError(client, new WebSocketError(
			getMessageType(message),
			'INVALID_QUERY',
			auditAskRefusalOf('query_audit'),
			message.uid,
		));
	}

	const audit = emptyQueryAudit(auditAsk.level, () => {
		return client.accountability?.admin === true;
	});

	messageAudits.set(audit, {
		client,
		uid: String(message.uid),
		...auditAsk,
	});

	unrepliedAuditsOf(client).add(audit);

	return queryAuditStore.run(audit, handleMessage);
}

/**
 * Add its message's audit to each reply sent to `client`, and close the
 * audits still waiting for a reply when it disconnects.
 */
export function reportQueryAuditInReplies(client: WebSocketClient): void {
	if (!queryAuditEnabled()) {
		return;
	}

	const sendMessage = client.send.bind(client) as (
		...sendArguments: unknown[]
	) => void;

	client.send = ((sentData: unknown, ...sendArguments: unknown[]) => {
		sendMessage(repliedDataOf(client, sentData), ...sendArguments);
	}) as WebSocketClient['send'];

	client.once('close', () => {
		for (const audit of unrepliedAuditsOf(client)) {
			closeQueryAudit(audit);
			discardAuditedStatements(audit);
		}

		unrepliedAuditsOf(client).clear();
	});
}

// Every reply is a JSON object in a text frame: other data is sent as is.
function repliedDataOf(client: WebSocketClient, sentData: unknown): unknown {
	const audit = queryAuditStore.getStore();
	const messageAudit = audit && messageAudits.get(audit);

	if (
		audit === undefined
		|| messageAudit === undefined
		|| messageAudit.client !== client
		|| audit.closed
		|| typeof sentData !== 'string'
	) {
		return sentData;
	}

	const reply = JSON.parse(sentData);

	if (String(reply.uid) !== messageAudit.uid) {
		return sentData;
	}

	closeQueryAudit(audit);
	unrepliedAuditsOf(client).delete(audit);

	const formattedAudit = formatQueryAudit(audit, {
		level: levelCarriesBindings(messageAudit.level)
			&& client.accountability?.admin !== true
			? 'statements'
			: messageAudit.level,
		maxSize: parseBytesConfiguration(
			String(useEnv()['QUERY_AUDIT_HEADER_MAX_SIZE']),
		) ?? 0,
		timings: messageAudit.timings,
	});

	discardAuditedStatements(audit);

	return JSON.stringify({ ...reply, query_audit: JSON.parse(formattedAudit) });
}

function unrepliedAuditsOf(client: WebSocketClient): Set<QueryAudit> {
	const clientAudits = unrepliedAudits.get(client) ?? new Set<QueryAudit>();

	unrepliedAudits.set(client, clientAudits);

	return clientAudits;
}
