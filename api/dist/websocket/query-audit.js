import { auditAskOf, auditAskRefusalOf, closeQueryAudit, discardAuditedStatements, emptyQueryAudit, formatQueryAudit, levelCarriesBindings, queryAuditEnabled, queryAuditStore } from "../database/query-audit.js";
import { WebSocketError, handleWebSocketError } from "./errors.js";
import { getMessageType } from "./utils/message.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";

//#region src/websocket/query-audit.ts
const messageAudits = /* @__PURE__ */ new WeakMap();
const unrepliedAudits = /* @__PURE__ */ new WeakMap();
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
async function auditMessageQueries(client, message, handleMessage) {
	if (!queryAuditEnabled() || message.uid === void 0) return handleMessage();
	const askedValue = message["query_audit"];
	const auditAsk = askedValue === void 0 || typeof askedValue === "string" ? auditAskOf(askedValue, useEnv()["QUERY_AUDIT_LEVEL"]) : void 0;
	if (auditAsk === void 0) return handleWebSocketError(client, new WebSocketError(getMessageType(message), "INVALID_QUERY", auditAskRefusalOf("query_audit"), message.uid));
	const audit = emptyQueryAudit(auditAsk.level, () => {
		return client.accountability?.admin === true;
	});
	messageAudits.set(audit, {
		client,
		uid: String(message.uid),
		...auditAsk
	});
	unrepliedAuditsOf(client).add(audit);
	try {
		return await queryAuditStore.run(audit, handleMessage);
	} finally {
		if (unrepliedAuditsOf(client).delete(audit)) {
			closeQueryAudit(audit);
			discardAuditedStatements(audit);
		}
	}
}
/**
* Add its message's audit to each reply sent to `client`, and close the
* audits whose handler is still running when it disconnects.
*/
function reportQueryAuditInReplies(client) {
	if (!queryAuditEnabled()) return;
	const sendMessage = client.send.bind(client);
	client.send = ((sentData, ...sendArguments) => {
		sendMessage(repliedDataOf(client, sentData), ...sendArguments);
	});
	client.once("close", () => {
		for (const audit of unrepliedAuditsOf(client)) {
			closeQueryAudit(audit);
			discardAuditedStatements(audit);
		}
		unrepliedAuditsOf(client).clear();
	});
}
function repliedDataOf(client, sentData) {
	const audit = queryAuditStore.getStore();
	const messageAudit = audit && messageAudits.get(audit);
	if (audit === void 0 || messageAudit === void 0 || messageAudit.client !== client || audit.closed || typeof sentData !== "string") return sentData;
	const reply = JSON.parse(sentData);
	if (String(reply.uid) !== messageAudit.uid) return sentData;
	closeQueryAudit(audit);
	unrepliedAuditsOf(client).delete(audit);
	const formattedAudit = formatQueryAudit(audit, {
		level: levelCarriesBindings(messageAudit.level) && client.accountability?.admin !== true ? "statements" : messageAudit.level,
		maxSize: parse(String(useEnv()["QUERY_AUDIT_HEADER_MAX_SIZE"])) ?? 0,
		timings: messageAudit.timings
	});
	discardAuditedStatements(audit);
	return JSON.stringify({
		...reply,
		query_audit: JSON.parse(formattedAudit)
	});
}
function unrepliedAuditsOf(client) {
	const clientAudits = unrepliedAudits.get(client) ?? /* @__PURE__ */ new Set();
	unrepliedAudits.set(client, clientAudits);
	return clientAudits;
}

//#endregion
export { auditMessageQueries, reportQueryAuditInReplies };