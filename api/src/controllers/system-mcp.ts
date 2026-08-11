import {
	ForbiddenError,
	InvalidPayloadError,
	MethodNotAllowedError,
} from '@directus/errors';
import { Router } from 'express';
import { useLogger } from '../logger/index.js';
import {
	handleSystemMcpRequest,
	systemMcpAllowsOrigin,
	SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from '../system-mcp/index.js';
import asyncHandler from '../utils/async-handler.js';

const router = Router();

/**
 * The system MCP endpoint, served at `/system-mcp`: one JSON-RPC 2.0
 * exchange per request, no session and no stream, which is all a read-only tool
 * set needs. Not `/mcp` — upstream Directus serves its own MCP there, over the
 * content API, so the two must not land on the same path.
 *
 * The caller is an admin, authenticated the way every other admin surface here
 * authenticates: a session cookie, or `Authorization: Bearer <token>` naming a
 * Directus static token on an admin user. There is no credential of its own to
 * issue, revoke or leak — `authenticate` resolves the token before this router
 * ever runs, and the tools then pass through the same service guard the REST
 * endpoints use. The rate limit the MCP tool spec asks for is the one Directus
 * already applies: `rateLimiterGlobal` and `rateLimiter` are mounted ahead of
 * every router, this one included.
 */
router.post(
	'/',
	asyncHandler(async (req, res) => {
		if (systemMcpAllowsOrigin(req.headers.origin) === false) {
			throw new ForbiddenError({
				reason: `Origin '${req.headers.origin}' is not named in `
					+ 'SYSTEM_MCP_ALLOWED_ORIGINS',
			});
		}

		if (req.accountability?.admin !== true) {
			throw new ForbiddenError({
				reason: 'The system MCP endpoint is admin only',
			});
		}

		// After the credential, so an anonymous caller cannot tell a version this
		// server refuses from one it accepts. The client states the revision it
		// negotiated; one this server does not implement has to fail loudly rather
		// than be answered in a dialect the caller cannot read.
		const version = req.headers['mcp-protocol-version'];

		if (
			typeof version === 'string'
			&& SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(version) === false
		) {
			throw new InvalidPayloadError({
				reason: `Unsupported MCP-Protocol-Version: ${version}`,
			});
		}

		// Logged before the work, not after: a read that dies mid-flight is
		// exactly the one an audit trail is wanted for. A call names its tool and
		// is worth an `info`; the handshake chatter around it is not.
		const method = req.body?.method;
		const logger = useLogger();

		const trace = {
			ip: req.accountability.ip,
			user: req.accountability.user,
			method,
			tool: req.body?.params?.name,
		};

		if (method === 'tools/call') {
			logger.info(trace, 'System MCP tool call');
		}
		else {
			logger.debug(trace, 'System MCP request');
		}

		const response = await handleSystemMcpRequest(req.body, {
			accountability: req.accountability,
			schema: req.schema,
		});

		// A notification is answered with no body at all, per JSON-RPC.
		if (response === null) {
			res.status(202).end();
			return;
		}

		res.setHeader('Cache-Control', 'no-store');
		res.json(response);
	}),
);

/**
 * The transport reserves GET for an SSE stream this server does not offer — a
 * read-only tool set needs no server-initiated messages — and reserves DELETE
 * for ending a session it never opens. Both are answered 405 rather than the
 * 404 an unrouted method would give: a 404 from this endpoint tells a client
 * its session expired, and it would go and open another one.
 *
 * `MethodNotAllowedError` is how the rest of the API answers this, and its
 * handler writes the `Allow` header RFC 9110 requires of a 405.
 */
router.all('/', (req, _res, next) => {
	next(new MethodNotAllowedError({ allowed: ['POST'], current: req.method }));
});

export default router;
