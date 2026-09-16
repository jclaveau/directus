import { useEnv } from '@directus/env';
import jwt from 'jsonwebtoken';
import type Keyv from 'keyv';
import http from 'node:http';
import pLimit from 'p-limit';
import { getCache, getCacheValue } from './cache.js';
import {
	advanceCacheAuditQueue,
	type CacheAnomalyReason,
	type CacheAuditDescriptor,
	type CacheEntryPurgeRecord,
	cacheStatsConfigured,
	claimCacheAnomalyThrottleSlot,
	evictCacheEntry,
	listPurgesCoveringEntry,
	queueCacheAnomaly,
	readCacheAuditQueue,
	readScopedCacheEntryTags,
} from './cache-events.js';
import getDatabase from './database/index.js';
import {
	CACHE_AUDIT_REPLAY_HEADER,
	CACHE_AUDIT_TAGS_HEADER,
	cacheAuditReplayToken,
} from './utils/cache-audit-replay.js';
import { decompress } from './utils/compress.js';
import { getSecret } from './utils/get-secret.js';

/**
 * Every scoped-cache guarantee is a proof by construction: a read derives tags,
 * a write derives a purge set, and the suites witness that the two meet for the
 * shapes we thought of. This is the check that reasons from none of that: for
 * every entry alive in the cache, is the stored body what the database answers
 * NOW? The request that filled it is replayed through the running app — the
 * controller, every read hook, GraphQL — as the user it was filled for, and the
 * two bodies are compared (https://github.com/jclaveau/directus/issues/498).
 *
 * The entries come off the descriptor table, least recently verified first
 * (an audit, or a fill where that came later — a fill reads the database,
 * so it matched then), and the cache is asked for their bodies: only a
 * described entry can be replayed, and a table orders, pages and remembers
 * where a `SCAN` does none of it. A run with a `limit` examines that many
 * and stops; the next one resumes behind them, so a schedule audits the
 * whole cache in slices sized to the load each may put on the database.
 *
 *   - fresh:         the replay answered the stored body.
 *   - stale:         a diff that held across two fresh reads. `purgesSinceFilled`
 *                    says which side lost it: a purge that covered the entry's
 *                    tags and left it alive, or no purge at all because the tags
 *                    never named what the write touched.
 *   - tag_drift:     same body, but the replay pinned other tags — the read plan
 *                    is not a pure function of the request, and the entry is one
 *                    write to the uncovered tag from stale.
 *   - raced:         the entry was purged or refilled while it was being
 *                    replayed. The purge doing its job, not staleness.
 *   - time_varying:  two fresh reads disagreed with each other ($NOW, a random
 *                    sort). Not decidable, not counted against the cache.
 *   - expired:       past its expiry and not yet evicted.
 *   - unreplayable:  nothing to replay it from; `reason` says why. An entry
 *                    with no descriptor at all is not in the queue: filled
 *                    while stats were off, it waits for its next fill.
 */
export type CacheAuditVerdict =
	| 'fresh'
	| 'stale'
	| 'tag_drift'
	| 'raced'
	| 'time_varying'
	| 'expired'
	| 'unreplayable';

export const CACHE_AUDIT_VERDICTS: readonly CacheAuditVerdict[] = [
	'fresh',
	'stale',
	'tag_drift',
	'raced',
	'time_varying',
	'expired',
	'unreplayable',
];

export interface CacheAuditReplayRequest {
	method: 'GET' | 'POST';
	path: string;
	headers: Record<string, string>;
	body?: string | undefined;
}

export interface CacheAuditReplayResponse {
	status: number;
	headers: Record<string, string | undefined>;
	body: string;
}

export type CacheAuditReplayer = (
	request: CacheAuditReplayRequest,
) => Promise<CacheAuditReplayResponse>;

export interface CacheAuditOptions {
	/** Stop after this many entries have been examined; the next run resumes. */
	limit?: number | undefined;
	/** Only the entries filled for this user id. */
	user?: string | undefined;
	/** Only the entries whose root collection is this one. */
	collection?: string | undefined;
	/** JSON-pointer globs to ignore in a diff, on top of CACHE_AUDIT_IGNORE_PATHS. */
	ignore?: string[] | undefined;
	/** Evict the `stale` and `tag_drift` entries once reported. */
	purge?: boolean | undefined;
	/** Where a replay goes; the app's own listener unless told otherwise. */
	replay?: CacheAuditReplayer | undefined;
}

export interface CacheAuditFinding {
	verdict: CacheAuditVerdict;
	/** The `unreplayable` reason, or what a replay answered instead of a body. */
	reason: string | null;
	redisKey: string;
	cacheKey: string;
	method: string;
	url: string;
	/** A GET's query string as sent; a GraphQL read's document and variables. */
	query: string;
	/** Null for a public fill. */
	user: string | null;
	collection: string | null;
	filledAt: number;
	ageMs: number;
	/** The tags it was filled under. */
	tags: string[];
	/** The tags the replay pinned, where one answered. */
	replayTags: string[] | null;
	/** JSON pointers to the first differences, stored body against fresh. */
	diff: string[] | null;
	purgesSinceFilled: CacheEntryPurgeRecord[] | null;
}

export interface CacheAuditReport {
	scanned: number;
	counts: Record<CacheAuditVerdict, number>;
	/** One per entry that is not `fresh`. */
	findings: CacheAuditFinding[];
	evicted: number;
	durationMs: number;
}

// Entries in flight at once. Each is one uncached read of the app, so this is
// the load the audit puts on the database, not a throughput knob.
const REPLAY_CONCURRENCY = 4;
// Descriptors read per page of the queue; most describe an entry the cache
// has already dropped, and those cost one `EXISTS` each and nothing more.
const QUEUE_PAGE = 500;
const DIFF_PATHS_REPORTED = 20;
// Enough diff paths to find one an ignore glob does not cover.
const DIFF_PATHS_COMPARED = 500;
const REPLAY_TOKEN_TTL = '60s';

interface LiveEntry {
	descriptor: CacheAuditDescriptor;
	raw: unknown;
}

interface EntrySnapshot {
	body: unknown;
	createdAt: number | null;
	expiresAt: number | null;
}

interface ReplayPlan {
	request: CacheAuditReplayRequest;
	url: string;
}

interface ReplayUser {
	id: string;
	role: string | null;
}

type Verdict =
	| { verdict: 'fresh' }
	| { verdict: 'expired' }
	| { verdict: 'raced' }
	| { verdict: 'unreplayable'; reason: string }
	| { verdict: 'time_varying'; diff: string[]; replayTags: string[] }
	| { verdict: 'tag_drift'; replayTags: string[] }
	| {
		verdict: 'stale';
		reason: string | null;
		diff: string[] | null;
		replayTags: string[] | null;
	};

export async function auditCache(
	options: CacheAuditOptions = {},
): Promise<CacheAuditReport> {
	const startedAt = Date.now();
	const { cache } = getCache();

	const report: CacheAuditReport = {
		scanned: 0,
		counts: emptyCounts(),
		findings: [],
		evicted: 0,
		durationMs: 0,
	};

	if (!cache) {
		report.durationMs = Date.now() - startedAt;

		return report;
	}

	if (!cacheStatsConfigured()) {
		throw new Error(
			'The cache audit replays the request descriptors: CACHE_STATS_ENABLED is off',
		);
	}

	const audit = new CacheAudit(cache, options);
	const limit = pLimit(REPLAY_CONCURRENCY);
	// What this run stamps is stamped after it began, so a read bounded by its
	// start never wraps around into its own pages.
	const before = new Date(startedAt);
	const filter = { user: options.user, collection: options.collection };

	for (;;) {
		const room = options.limit === undefined
			? Number.POSITIVE_INFINITY
			: options.limit - report.scanned;

		if (room <= 0) {
			break;
		}

		const due = await readCacheAuditQueue(QUEUE_PAGE, before, filter);

		if (due.length === 0) {
			break;
		}

		// Asked whether each is held before any body is fetched: a descriptor
		// whose entry is gone is passed over, not examined — it describes
		// nothing until the next fill — and a page can hold more live entries
		// than the limit has room for; those stay unstamped for the next run.
		// Only what will be examined has its body and tags read.
		const held = await cache.hasMany(due.map((row) => row.redisKey));
		const passed: string[] = [];
		const taken: typeof due = [];

		due.forEach((row, index) => {
			if (held[index] !== true) {
				passed.push(row.cacheKey);
			}
			else if (taken.length < room) {
				taken.push(row);
			}
		});

		const [raws, tags] = await Promise.all([
			cache.getMany(taken.map((row) => row.redisKey)),
			readScopedCacheEntryTags(taken.map((row) => row.cacheKey)),
		]);

		// A body gone between the two asks is re-read by the judge and found
		// missing: raced, as any entry that moves under the audit.
		const batch: LiveEntry[] = taken.map((row, index) => {
			return {
				descriptor: { ...row, scopedCacheTags: tags.get(row.cacheKey) ?? [] },
				raw: raws[index],
			};
		});

		await advanceCacheAuditQueue(
			[...passed, ...batch.map((entry) => entry.descriptor.cacheKey)],
			new Date(),
		);

		for (const finding of await audit.examine(batch, limit)) {
			report.scanned += 1;
			report.counts[finding.verdict] += 1;

			if (finding.verdict !== 'fresh') {
				report.findings.push(finding);
			}
		}
	}

	if (options.purge === true) {
		for (const finding of report.findings) {
			if (finding.verdict === 'stale' || finding.verdict === 'tag_drift') {
				await evictCacheEntry(cache, finding.redisKey);
				report.evicted += 1;
			}
		}
	}

	report.durationMs = Date.now() - startedAt;

	return report;
}

function emptyCounts(): Record<CacheAuditVerdict, number> {
	return Object.fromEntries(
		CACHE_AUDIT_VERDICTS.map((verdict) => [verdict, 0]),
	) as Record<CacheAuditVerdict, number>;
}

class CacheAudit {
	private readonly replay: CacheAuditReplayer;
	private readonly ignore: string[][];
	private readonly users = new Map<string, Promise<ReplayUser | null>>();

	constructor(
		private readonly cache: Keyv,
		options: CacheAuditOptions,
	) {
		this.replay = options.replay ?? loopbackReplayer();

		this.ignore = [
			...((useEnv()['CACHE_AUDIT_IGNORE_PATHS'] as string[] | undefined) ?? []),
			...(options.ignore ?? []),
		].map((glob) => glob.split('/').slice(1));
	}

	async examine(
		batch: LiveEntry[],
		limit: ReturnType<typeof pLimit>,
	): Promise<CacheAuditFinding[]> {
		return Promise.all(batch.map((entry) => limit(() => this.examineEntry(entry))));
	}

	private async examineEntry(entry: LiveEntry): Promise<CacheAuditFinding> {
		const { descriptor } = entry;
		const verdict = await this.judge(entry);
		const now = Date.now();

		const finding: CacheAuditFinding = {
			verdict: verdict.verdict,
			reason: 'reason' in verdict
				? verdict.reason
				: null,
			redisKey: descriptor.redisKey,
			cacheKey: descriptor.cacheKey,
			method: descriptor.method,
			url: descriptorUrl(descriptor),
			query: descriptor.query,
			user: descriptor.userId,
			collection: descriptor.collection,
			filledAt: descriptor.lastFilled.getTime(),
			ageMs: Math.max(now - descriptor.lastFilled.getTime(), 0),
			tags: descriptor.scopedCacheTags,
			replayTags: 'replayTags' in verdict
				? verdict.replayTags
				: null,
			diff: 'diff' in verdict
				? verdict.diff
				: null,
			purgesSinceFilled: null,
		};

		if (verdict.verdict === 'stale') {
			finding.purgesSinceFilled = await listPurgesCoveringEntry(
				descriptor.cacheKey,
				descriptor.lastFilled,
			);

			await this.recordAnomaly(
				descriptor,
				'stale_entry',
				verdict.diff?.join(' ') ?? verdict.reason,
			);
		}

		if (verdict.verdict === 'tag_drift') {
			await this.recordAnomaly(
				descriptor,
				'tag_drift',
				`filled under ${descriptor.scopedCacheTags.join(',') || '(none)'}, `
				+ `replay pinned ${verdict.replayTags.join(',') || '(none)'}`,
			);
		}

		return finding;
	}

	private async judge(entry: LiveEntry): Promise<Verdict> {
		const { descriptor } = entry;
		const { redisKey } = descriptor;
		let snapshot = await this.snapshot(redisKey, entry.raw);

		if (snapshot === null) {
			return { verdict: 'raced' };
		}

		if (snapshot.body === undefined) {
			return { verdict: 'unreplayable', reason: 'unreadable' };
		}

		if (snapshot.expiresAt !== null && snapshot.expiresAt <= Date.now()) {
			return { verdict: 'expired' };
		}

		const plan = replayPlan(descriptor);

		if ('reason' in plan) {
			return { verdict: 'unreplayable', reason: plan.reason };
		}

		const authorization = await this.authorizationFor(descriptor.userId);

		if (authorization === null) {
			return { verdict: 'unreplayable', reason: 'user_gone' };
		}

		if (authorization !== '') {
			plan.request.headers['authorization'] = authorization;
		}

		// A diff is only staleness once the entry is known not to have moved
		// under the replay; the retry re-reads it and replays once more.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const fresh = await this.replayBody(plan.request);

			if ('verdict' in fresh) {
				return fresh;
			}

			const diff = this.diff(snapshot.body, fresh.body);

			if (diff.length === 0) {
				return sameTags(descriptor.scopedCacheTags, fresh.tags)
					? { verdict: 'fresh' }
					: { verdict: 'tag_drift', replayTags: fresh.tags };
			}

			const moved = await this.movedSince(redisKey, snapshot);

			if (moved === 'gone') {
				return { verdict: 'raced' };
			}

			if (moved === 'refilled') {
				snapshot = await this.snapshot(redisKey, undefined);

				if (snapshot === null || snapshot.body === undefined) {
					return { verdict: 'raced' };
				}

				continue;
			}

			const again = await this.replayBody(plan.request);

			if ('verdict' in again) {
				return again;
			}

			if (this.diff(fresh.body, again.body).length > 0) {
				return { verdict: 'time_varying', diff, replayTags: fresh.tags };
			}

			return {
				verdict: 'stale',
				reason: null,
				diff,
				replayTags: fresh.tags,
			};
		}

		return { verdict: 'raced' };
	}

	/**
	 * The body as the page read handed it, or re-read from the cache when a
	 * retry needs the current one, with what its expiry sidecar says in one
	 * read. Null once the key is gone; `undefined` body for a value that does
	 * not decompress.
	 */
	private async snapshot(
		redisKey: string,
		raw: unknown,
	): Promise<EntrySnapshot | null> {
		let stored = raw;

		if (stored === undefined) {
			stored = await this.cache.get(redisKey);

			if (stored === undefined) {
				return null;
			}
		}

		let body: unknown;

		try {
			body = await decompress(stored as Parameters<typeof decompress>[0]);
		}
		catch {
			body = undefined;
		}

		const expiry = await getCacheValue(this.cache, `${redisKey}__expires_at`);

		return {
			body,
			createdAt: typeof expiry?.createdAt === 'number'
				? expiry.createdAt
				: null,
			expiresAt: typeof expiry?.exp === 'number'
				? expiry.exp
				: null,
		};
	}

	private async createdAt(redisKey: string): Promise<number | null> {
		const expiry = await getCacheValue(this.cache, `${redisKey}__expires_at`);

		return typeof expiry?.createdAt === 'number'
			? expiry.createdAt
			: null;
	}

	// An entry filled before the expiry sidecar carried `createdAt` cannot be
	// told to have moved, and is judged on its diff alone.
	private async movedSince(
		redisKey: string,
		snapshot: EntrySnapshot,
	): Promise<'held' | 'refilled' | 'gone'> {
		if (!(await this.cache.has(redisKey))) {
			return 'gone';
		}

		if (snapshot.createdAt === null) {
			return 'held';
		}

		return (await this.createdAt(redisKey)) === snapshot.createdAt
			? 'held'
			: 'refilled';
	}

	private async replayBody(
		request: CacheAuditReplayRequest,
	): Promise<{ body: unknown; tags: string[] } | Verdict> {
		const response = await this.replay(request);

		// A 403 is what the user would now be served instead of the entry: the
		// entry is stale for them, whichever permission moved.
		if (response.status === 403) {
			return {
				verdict: 'stale',
				reason: 'replay_status_403',
				diff: null,
				replayTags: null,
			};
		}

		if (response.status < 200 || response.status >= 300) {
			return { verdict: 'unreplayable', reason: `status_${response.status}` };
		}

		const tagged = response.headers[CACHE_AUDIT_TAGS_HEADER];

		if (typeof tagged !== 'string') {
			return { verdict: 'unreplayable', reason: 'replay_unrecognized' };
		}

		try {
			return {
				body: JSON.parse(response.body),
				tags: tagged.split(',').filter(Boolean),
			};
		}
		catch {
			return { verdict: 'unreplayable', reason: 'body' };
		}
	}

	private diff(stored: unknown, fresh: unknown): string[] {
		const paths: string[] = [];

		diffPaths(canonical(stored), canonical(fresh), '', paths);

		return paths
			.filter((path) => !this.ignored(path))
			.slice(0, DIFF_PATHS_REPORTED);
	}

	private ignored(path: string): boolean {
		const segments = path.split('/').slice(1);

		return this.ignore.some((glob) => globMatches(glob, segments));
	}

	/**
	 * A minted access token for the user the entry was filled for, `''` for a
	 * public fill, null for a user that no longer exists. `{ id, role }` is all
	 * the token needs to carry: the app rebuilds the rest from the database, as
	 * it does for any access token.
	 */
	private async authorizationFor(userId: string | null): Promise<string | null> {
		if (userId === null) {
			return '';
		}

		let lookup = this.users.get(userId);

		if (lookup === undefined) {
			lookup = getDatabase()('directus_users')
				.where({ id: userId })
				.first('id', 'role')
				.then((row: ReplayUser | undefined) => row ?? null);

			this.users.set(userId, lookup);
		}

		const user = await lookup;

		if (user === null) {
			return null;
		}

		// The access claims are required to be present and read from nowhere:
		// `getAccountabilityForToken` recomputes both from the database, which is
		// the point — the replay runs as the user is today, not as it was.
		const token = jwt.sign(
			{ id: user.id, role: user.role, app_access: false, admin_access: false },
			getSecret(),
			{ expiresIn: REPLAY_TOKEN_TTL, issuer: 'directus' },
		);

		return `Bearer ${token}`;
	}

	private async recordAnomaly(
		descriptor: CacheAuditDescriptor,
		reason: CacheAnomalyReason,
		detail: string | null,
	): Promise<void> {
		if (await claimCacheAnomalyThrottleSlot(reason, descriptor.cacheKey)) {
			queueCacheAnomaly({ cacheKey: descriptor.cacheKey, reason, detail });
		}
	}
}

function descriptorUrl(descriptor: CacheAuditDescriptor): string {
	if (descriptor.query === '' || descriptor.path.startsWith('/graphql')) {
		return descriptor.path;
	}

	return `${descriptor.path}?${descriptor.query}`;
}

/**
 * The request a descriptor describes, rebuilt as it was sent. A GraphQL read
 * is replayed as a POST of its stored document whichever method filled it: the
 * document is what the descriptor kept, the query string it may have travelled
 * in is not.
 */
function replayPlan(
	descriptor: CacheAuditDescriptor,
): ReplayPlan | { reason: string } {
	const headers: Record<string, string> = {
		accept: 'application/json',
		[CACHE_AUDIT_REPLAY_HEADER]: cacheAuditReplayToken(),
	};

	if (descriptor.path.startsWith('/graphql')) {
		let document: unknown;

		try {
			document = JSON.parse(descriptor.query);
		}
		catch {
			return { reason: 'document' };
		}

		if (typeof document !== 'object' || document === null) {
			return { reason: 'document' };
		}

		headers['content-type'] = 'application/json';

		return {
			url: descriptor.path,
			request: {
				method: 'POST',
				path: descriptor.path,
				headers,
				body: JSON.stringify(document),
			},
		};
	}

	if (descriptor.method.toUpperCase() !== 'GET') {
		return { reason: 'method' };
	}

	// A row written before `query` held the raw string carries the sanitized
	// JSON reading of it instead, which rebuilds no URL.
	if (descriptor.query.startsWith('{')) {
		return { reason: 'query' };
	}

	const url = descriptorUrl(descriptor);

	return { url, request: { method: 'GET', path: url, headers } };
}

function sameTags(filled: string[], replayed: string[]): boolean {
	const a = [...new Set(filled)].sort();
	const b = [...new Set(replayed)].sort();

	return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

// A JSON round trip: what a HIT serves is the stored body serialized, and what
// the replay answered is a body parsed, so both sides are compared as JSON.
function canonical(value: unknown): unknown {
	return value === undefined
		? undefined
		: JSON.parse(JSON.stringify(value));
}

function diffPaths(a: unknown, b: unknown, path: string, out: string[]): void {
	if (out.length >= DIFF_PATHS_COMPARED) {
		return;
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		const length = Math.max(a.length, b.length);

		for (let index = 0; index < length; index += 1) {
			if (index >= a.length || index >= b.length) {
				out.push(`${path}/${index}`);
			}
			else {
				diffPaths(a[index], b[index], `${path}/${index}`, out);
			}
		}

		return;
	}

	if (isRecord(a) && isRecord(b)) {
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (!(key in a) || !(key in b)) {
				out.push(`${path}/${key}`);
			}
			else {
				diffPaths(a[key], b[key], `${path}/${key}`, out);
			}
		}

		return;
	}

	if (a !== b) {
		out.push(path || '/');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `*` stands for one segment, `**` for the rest of the pointer.
function globMatches(glob: string[], segments: string[]): boolean {
	for (let index = 0; index < glob.length; index += 1) {
		if (glob[index] === '**') {
			return true;
		}

		if (index >= segments.length) {
			return false;
		}

		if (glob[index] !== '*' && glob[index] !== segments[index]) {
			return false;
		}
	}

	return glob.length === segments.length;
}

export interface LoopbackTarget {
	host?: string | undefined;
	port?: number | undefined;
	socketPath?: string | undefined;
}

/**
 * A replayer speaking to the app's own listener, never through PUBLIC_URL: the
 * audit asks what THIS deployment would answer, and a proxy or a CDN in front
 * of it is exactly the kind of cache it must not be answered by.
 */
export function loopbackReplayer(
	target: LoopbackTarget = loopbackTarget(),
): CacheAuditReplayer {
	return (request) => {
		return new Promise((resolve, reject) => {
			const outgoing = http.request(
				{
					...target,
					method: request.method,
					path: request.path,
					headers: request.headers,
				},
				(incoming) => {
					const chunks: Buffer[] = [];

					incoming.on('data', (chunk: Buffer) => chunks.push(chunk));

					incoming.on('end', () => {
						resolve({
							status: incoming.statusCode ?? 0,
							headers: Object.fromEntries(
								Object.entries(incoming.headers).map(([name, value]) => {
									return [name, Array.isArray(value)
										? value.join(', ')
										: value];
								}),
							),
							body: Buffer.concat(chunks).toString('utf8'),
						});
					});

					incoming.on('error', reject);
				},
			);

			outgoing.on('error', reject);
			outgoing.end(request.body);
		});
	};
}

// Where this process listens: the server binds HOST, and a wildcard bind is
// reached on the loopback address of its family, any other address on itself.
export function loopbackTarget(): LoopbackTarget {
	const env = useEnv();

	if (env['UNIX_SOCKET_PATH']) {
		return { socketPath: String(env['UNIX_SOCKET_PATH']) };
	}

	const host = String(env['HOST'] ?? '');

	if (host === '' || host === '0.0.0.0') {
		return { host: '127.0.0.1', port: Number(env['PORT']) };
	}

	if (host === '::') {
		return { host: '::1', port: Number(env['PORT']) };
	}

	return { host, port: Number(env['PORT']) };
}
