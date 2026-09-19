import { useLogger } from "../../../logger/index.js";
import { createServer } from "../../../server.js";
import { CACHE_AUDIT_VERDICTS, loopbackReplayer } from "../../../cache-audit.js";
import { cacheAuditEnabled } from "../../../utils/cache-audit-enabled.js";
import { runCacheAudit } from "../../../cache-audit-runs.js";
import { drainStdout } from "../../utils/drain-stdout.js";

//#region src/cli/commands/cache/audit.ts
/**
* `directus cache audit`: the same audit `POST /utils/cache/audit` runs, from a
* shell. It boots the app the way `start` does — extensions, hooks, GraphQL —
* on a loopback-only ephemeral port, and replays every live entry through
* that, so a replay exercises exactly what filled the entry.
*
* Exit 0 when nothing is stale, 1 on any `stale` or `tag_drift` entry, and 2
* when `--strict` and an entry could not be replayed at all.
*/
async function cacheAudit(options) {
	const logger = useLogger();
	let report;
	if (!cacheAuditEnabled()) {
		logger.error("CACHE_AUDIT_ENABLED is false on this node: nothing to run");
		await exitWhenPrinted(1);
		return;
	}
	const limit = options.limit === void 0 ? void 0 : Number(options.limit);
	if (limit !== void 0 && (!Number.isInteger(limit) || limit < 1)) {
		logger.error(`--limit has to be a whole number of 1 or more, not "${options.limit}"`);
		await exitWhenPrinted(1);
		return;
	}
	try {
		const server = await createServer();
		const port = await new Promise((resolve, reject) => {
			server.listen({
				host: "127.0.0.1",
				port: 0
			}, () => {
				resolve(server.address().port);
			}).once("error", reject);
		});
		report = await runCacheAudit("cli", {
			limit,
			user: options.user,
			collection: options.collection,
			purge: options.purge,
			replay: loopbackReplayer({
				host: "127.0.0.1",
				port
			})
		});
	} catch (error) {
		logger.error(error);
	}
	if (report === void 0) {
		await exitWhenPrinted(1);
		return;
	}
	process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
	await exitWhenPrinted(exitCodeFor(report, options.strict === true));
}
function exitCodeFor(report, strict) {
	if (report.counts.stale > 0 || report.counts.tag_drift > 0) return 1;
	if (strict && report.counts.unreplayable > 0) return 2;
	return 0;
}
function renderReport(report) {
	const lines = [`${report.scanned} entries audited in ${report.durationMs}ms${report.evicted > 0 ? `, ${report.evicted} evicted` : ""}`, ...CACHE_AUDIT_VERDICTS.map((verdict) => {
		return `  ${verdict.padEnd(13)} ${report.counts[verdict]}`;
	})];
	if (report.timedOut) lines.push("stopped on CACHE_AUDIT_MAX_DURATION; the next run resumes behind it");
	for (const finding of report.findings) lines.push("", ...renderFinding(finding));
	return `${lines.join("\n")}\n`;
}
function renderFinding(finding) {
	const lines = [
		`${finding.reason === null ? finding.verdict : `${finding.verdict}:${finding.reason}`}  ${finding.method} ${finding.url}`,
		`  key ${finding.redisKey}`,
		`  user ${finding.user ?? "public"}  collection ${finding.collection ?? "-"}  age ${Math.round(finding.ageMs / 1e3)}s`,
		`  tags ${finding.tags.join(", ") || "-"}`
	];
	if (finding.replayTags !== null) lines.push(`  replay tags ${finding.replayTags.join(", ") || "-"}`);
	if (finding.url.startsWith("/graphql")) lines.push(`  document ${finding.query}`);
	if (finding.diff !== null) lines.push(`  diff ${finding.diff.join(" ")}`);
	if (finding.purgesSinceFilled !== null) {
		lines.push(finding.purgesSinceFilled.length === 0 ? "  no purge covered it since the fill: its tags never named the write" : "  purged since the fill and still held:");
		for (const purge of finding.purgesSinceFilled) lines.push(`    ${new Date(purge.time).toISOString()} ${purge.mode} ${purge.scopedCacheTag ?? purge.collection ?? "*"}`);
	}
	return lines;
}
async function exitWhenPrinted(code) {
	await drainStdout();
	process.exit(code);
}

//#endregion
export { cacheAudit as default, exitCodeFor, renderReport };