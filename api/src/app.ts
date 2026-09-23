import { useEnv } from '@directus/env';
import { InvalidPayloadError, ServiceUnavailableError } from '@directus/errors';
import cookieParser from 'cookie-parser';
import type { Request, RequestHandler, Response, Router } from 'express';
import express from 'express';
import type { ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'path';
import qs from 'qs';
import { registerAuthProviders } from './auth.js';
import accessRouter from './controllers/access.js';
import activityRouter from './controllers/activity.js';
import assetsRouter from './controllers/assets.js';
import authRouter from './controllers/auth.js';
import collectionsRouter from './controllers/collections.js';
import commentsRouter from './controllers/comments.js';
import dashboardsRouter from './controllers/dashboards.js';
import extensionsRouter from './controllers/extensions.js';
import fieldsRouter from './controllers/fields.js';
import filesRouter from './controllers/files.js';
import flowsRouter from './controllers/flows.js';
import foldersRouter from './controllers/folders.js';
import graphqlRouter from './controllers/graphql.js';
import itemsRouter from './controllers/items.js';
import metricsRouter from './controllers/metrics.js';
import notFoundHandler from './controllers/not-found.js';
import notificationsRouter from './controllers/notifications.js';
import operationsRouter from './controllers/operations.js';
import panelsRouter from './controllers/panels.js';
import permissionsRouter from './controllers/permissions.js';
import policiesRouter from './controllers/policies.js';
import presetsRouter from './controllers/presets.js';
import relationsRouter from './controllers/relations.js';
import revisionsRouter from './controllers/revisions.js';
import rolesRouter from './controllers/roles.js';
import schemaRouter from './controllers/schema.js';
import serverRouter from './controllers/server.js';
import settingsRouter from './controllers/settings.js';
import sharesRouter from './controllers/shares.js';
import systemMcpRouter from './controllers/system-mcp.js';
import translationsRouter from './controllers/translations.js';
import tusRouter from './controllers/tus.js';
import usersRouter from './controllers/users.js';
import utilsRouter from './controllers/utils.js';
import versionsRouter from './controllers/versions.js';
import webhooksRouter from './controllers/webhooks.js';
import {
	isInstalled,
	validateDatabaseConnection,
	validateDatabaseExtensions,
	outstandingMigrationsOrExit,
} from './database/index.js';
import { initAutoscaleDrill } from './processes/autoscale/lib/drill.js';
import { flushCachesIfBuildChanged } from './cache-build-identity.js';
import { type CoreMountPath, coreMountPaths } from './core-mounts.js';
import { initCacheConfig } from './cache-config.js';
import { PROCESSES_BOOLEAN_ENV } from './processes/lib/boolean-env.js';
import { validateBooleanEnv } from './utils/validate-env.js';
import { initSharedSettings } from './processes/lib/shared-settings.js';
import { initPoolHealthMirror } from './processes/lib/pool-health.js';
import { initSharedSettingsGuard } from './processes/lib/settings-guard.js';
import emitter from './emitter.js';
import { getExtensionManager } from './extensions/index.js';
import { getFlowManager } from './flows.js';
import { createExpressLogger, useLogger } from './logger/index.js';
import authenticate from './middleware/authenticate.js';
import cache from './middleware/cache.js';
import cors from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import extractToken from './middleware/extract-token.js';
import rateLimiterGlobal from './middleware/rate-limiter-global.js';
import rateLimiter, {
	resolvedRateLimiterCharge,
	type RateLimiterCharge,
} from './middleware/rate-limiter-ip.js';
import sanitizeQuery from './middleware/sanitize-query.js';
import schema from './middleware/schema.js';
import {
	shedUnderPressure,
	UNDER_PRESSURE_REASON,
} from './middleware/shed-under-pressure.js';
import { assertPgBouncerConnections } from './pgbouncer/index.js';
import { initProcessReports } from './processes/index.js';
import cacheAuditSchedule from './schedules/cache-audit.js';
import cacheStatsSchedule from './schedules/cache-stats.js';
import metricsSchedule from './schedules/metrics.js';
import retentionSchedule from './schedules/retention.js';
import telemetrySchedule from './schedules/telemetry.js';
import tusSchedule from './schedules/tus.js';
import {
	assertScopedCacheStoreSupported,
	startScopedCachePurgeRecovery,
} from './scoped-cache.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';
import { merge } from './utils/lodash-es-used.js';
import { Url } from './utils/url.js';
import { validateStorage } from './utils/validate-storage.js';

const require = createRequire(import.meta.url);

export default async function createApp(): Promise<express.Application> {
	const env = useEnv();
	const logger = useLogger();
	const helmet = await import('helmet');

	// Before anything is built on the value: a variable this reads as false
	// turns its feature off silently, and every line after here would run as
	// though the deployment had asked for that.
	validateBooleanEnv(PROCESSES_BOOLEAN_ENV);

	await validateDatabaseConnection();

	if ((await isInstalled()) === false) {
		logger.error(`Database doesn't have Directus tables installed.`);
		process.exit(1);
	}

	const outstanding = await outstandingMigrationsOrExit();

	if (outstanding.length > 0) {
		logger.warn(
			`Database migrations have not all been run: ${outstanding.join(', ')}`,
		);
	}

	if (!env['SECRET']) {
		logger.warn(
			`"SECRET" env variable is missing. Using a random value instead. Tokens will not persist between restarts. This is not appropriate for production usage.`,
		);
	}

	if (!new Url(env['PUBLIC_URL'] as string).isAbsolute()) {
		logger.warn('"PUBLIC_URL" should be a full URL');
	}

	await validateDatabaseExtensions();
	await validateStorage();

	assertScopedCacheStoreSupported();

	await registerAuthProviders();

	const extensionManager = getExtensionManager();
	const flowManager = getFlowManager();

	await extensionManager.initialize();
	await flowManager.initialize();

	// Extensions + core loaded; heal a redis cache left stale by a code-only deploy.
	await flushCachesIfBuildChanged(extensionManager);

	// And finish any purge that failed after its mutation committed — a previous
	// process may have exited while Redis was still unreachable.
	startScopedCachePurgeRecovery();

	const app = express();

	app.disable('x-powered-by');
	app.set('trust proxy', env['IP_TRUST_PROXY']);
	app.set('query parser', (str: string) => qs.parse(str, { depth: Number(env['QUERYSTRING_MAX_PARSE_DEPTH']) }));

	if (env['PRESSURE_LIMITER_ENABLED']) {
		const sampleInterval = Number(env['PRESSURE_LIMITER_SAMPLE_INTERVAL']);

		if (Number.isNaN(sampleInterval) === true || Number.isFinite(sampleInterval) === false) {
			throw new Error(`Invalid value for PRESSURE_LIMITER_SAMPLE_INTERVAL environment variable`);
		}

		app.use(
			shedUnderPressure({
				sampleInterval,
				maxEventLoopUtilization: env['PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION'] as number,
				maxEventLoopDelay: env['PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY'] as number,
				maxMemoryRss: env['PRESSURE_LIMITER_MAX_MEMORY_RSS'] as number,
				maxMemoryHeapUsed: env['PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED'] as number,
				error: new ServiceUnavailableError({
					service: 'api',
					reason: UNDER_PRESSURE_REASON,
				}),
				retryAfter: env['PRESSURE_LIMITER_RETRY_AFTER'] as string,
			}),
		);
	}

	app.use(
		helmet.contentSecurityPolicy(
			merge(
				{
					useDefaults: true,
					directives: {
						// Unsafe-eval is required for app extensions
						scriptSrc: ["'self'", "'unsafe-eval'"],

						// Even though this is recommended to have enabled, it breaks most local
						// installations. Making this opt-in rather than opt-out is a little more
						// friendly. Ref #10806
						upgradeInsecureRequests: null,

						// These are required for MapLibre
						workerSrc: ["'self'", 'blob:'],
						childSrc: ["'self'", 'blob:'],
						imgSrc: [
							"'self'",
							'data:',
							'blob:',
							'https://raw.githubusercontent.com',
							'https://avatars.githubusercontent.com',
						],
						mediaSrc: ["'self'"],
						connectSrc: ["'self'", 'https://*', 'wss://*'],
					},
				},
				getConfigFromEnv('CONTENT_SECURITY_POLICY_'),
			),
		),
	);

	if (env['HSTS_ENABLED']) {
		app.use(helmet.hsts(getConfigFromEnv('HSTS_', { omitPrefix: 'HSTS_ENABLED' })));
	}

	await emitter.emitInit('app.before', { app });

	await emitter.emitInit('middlewares.before', { app });

	app.use(createExpressLogger());

	app.use((_req, res, next) => {
		res.setHeader('X-Powered-By', 'Directus');
		next();
	});

	if (env['CORS_ENABLED'] === true) {
		app.use(cors);
	}

	app.use((req, res, next) => {
		(
			express.json({
				limit: env['MAX_PAYLOAD_SIZE'] as string,
			}) as RequestHandler
		)(req, res, (err: any) => {
			if (err) {
				return next(new InvalidPayloadError({ reason: err.message }));
			}

			return next();
		});
	});

	app.use(cookieParser());

	app.use(extractToken);

	app.get('/', (_req, res, next) => {
		if (env['ROOT_REDIRECT']) {
			res.redirect(env['ROOT_REDIRECT'] as string);
		} else {
			next();
		}
	});

	app.get('/robots.txt', (_, res) => {
		res.set('Content-Type', 'text/plain');
		res.status(200);
		res.send(env['ROBOTS_TXT']);
	});

	if (env['SERVE_APP']) {
		const adminPath = require.resolve('@directus/app');
		const adminUrl = new Url(env['PUBLIC_URL'] as string).addPath('admin');

		const embeds = extensionManager.getEmbeds();

		// Set the App's base path according to the APIs public URL
		const html = await readFile(adminPath, 'utf8');

		const htmlWithVars = html
			.replace(/<base \/>/, `<base href="${adminUrl.toString({ rootRelative: true })}/" />`)
			.replace('<!-- directus-embed-head -->', embeds.head)
			.replace('<!-- directus-embed-body -->', embeds.body);

		const sendHtml = (_req: Request, res: Response) => {
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Vary', 'Origin, Cache-Control');
			res.send(htmlWithVars);
		};

		const setStaticHeaders = (res: ServerResponse) => {
			res.setHeader('Cache-Control', 'max-age=31536000, immutable');
			res.setHeader('Vary', 'Origin, Cache-Control');
		};

		app.get('/admin', sendHtml);
		app.use('/admin', express.static(path.join(adminPath, '..'), { setHeaders: setStaticHeaders }));
		app.use('/admin/*', sendHtml);
	}

	// use the rate limiter - all routes for now
	if (env['RATE_LIMITER_GLOBAL_ENABLED'] === true) {
		app.use(rateLimiterGlobal);
	}

	// Where the per-IP limiter sits decides what a token buys. Above the cache it is
	// spent before the cache is consulted, so a burst of cacheable reads 429s even at
	// a 100% hit rate — the load caching exists to absorb (#340). Below the cache it
	// is spent only by requests that reach a handler, because a HIT answers from
	// `checkCacheMiddleware` without calling `next()`.
	//
	// A position can't be a branch in one place, so the limiter is offered to both
	// call sites below and taken by whichever matches the configured charge — exactly
	// one, or neither when it is disabled.
	const rateLimiterCharge = env['RATE_LIMITER_ENABLED'] === true
		? resolvedRateLimiterCharge()
		: null;

	const useRateLimiterWhenCharging = (charge: RateLimiterCharge) => {
		if (rateLimiterCharge === charge) {
			app.use(rateLimiter);
		}
	};

	useRateLimiterWhenCharging('every-request');

	app.get('/server/ping', (_req, res) => res.send('pong'));

	app.use(authenticate);

	app.use(schema);

	app.use(sanitizeQuery);

	app.use(cache);

	// Misses, mutations and everything the cache skips land here; hits never do. The
	// cache key needs `accountability` and `sanitizedQuery`, so the lookup cannot move
	// any earlier and the charge has to move later instead.
	//
	// The accepted cost: a request that THROWS above this line is never charged at
	// all, not merely charged late — express skips the rest of the chain, so
	// `consume()` never runs and no number of such requests can ever 429. That covers
	// an invalid or expired token (`authenticate` throws, and each one still costs a
	// `getAccountabilityForToken` lookup) and a malformed `?filter=` (`sanitizeQuery`
	// throws, cheaper still to send). A request with NO token is unaffected: it falls
	// through to the public accountability, reaches the cache, and pays on a miss.
	//
	// Structural rather than a placement bug — the exemption needs the cache lookup,
	// and the failure happens before one exists, so no single position does both.
	// `RATE_LIMITER_GLOBAL` is the ceiling for it; `every-request` opts out entirely.
	useRateLimiterWhenCharging('cache-misses');

	await emitter.emitInit('middlewares.after', { app });

	await emitter.emitInit('routes.before', { app });

	const coreRouters: Record<CoreMountPath, Router> = {
		'/auth': authRouter,
		'/graphql': graphqlRouter,
		'/activity': activityRouter,
		'/access': accessRouter,
		'/assets': assetsRouter,
		'/collections': collectionsRouter,
		'/comments': commentsRouter,
		'/dashboards': dashboardsRouter,
		'/extensions': extensionsRouter,
		'/fields': fieldsRouter,
		'/files/tus': tusRouter,
		'/files': filesRouter,
		'/flows': flowsRouter,
		'/folders': foldersRouter,
		'/items': itemsRouter,
		'/system-mcp': systemMcpRouter,
		'/metrics': metricsRouter,
		'/notifications': notificationsRouter,
		'/operations': operationsRouter,
		'/panels': panelsRouter,
		'/permissions': permissionsRouter,
		'/policies': policiesRouter,
		'/presets': presetsRouter,
		'/translations': translationsRouter,
		'/relations': relationsRouter,
		'/revisions': revisionsRouter,
		'/roles': rolesRouter,
		'/schema': schemaRouter,
		'/server': serverRouter,
		'/settings': settingsRouter,
		'/shares': sharesRouter,
		'/users': usersRouter,
		'/utils': utilsRouter,
		'/versions': versionsRouter,
		'/webhooks': webhooksRouter,
	};

	for (const path of coreMountPaths()) {
		app.use(path, coreRouters[path]);
	}

	// Register custom endpoints
	await emitter.emitInit('routes.custom.before', { app });
	app.use(extensionManager.getEndpointRouter());
	await emitter.emitInit('routes.custom.after', { app });

	app.use(notFoundHandler);
	app.use(errorHandler);

	await emitter.emitInit('routes.after', { app });

	await retentionSchedule();
	await telemetrySchedule();
	await tusSchedule();
	await metricsSchedule();
	await cacheStatsSchedule();
	await cacheAuditSchedule();
	await initCacheConfig();
	await initSharedSettings();
	initPoolHealthMirror();
	await initSharedSettingsGuard();
	await initProcessReports();
	initAutoscaleDrill();
	assertPgBouncerConnections();

	await emitter.emitInit('app.after', { app });

	return app;
}
