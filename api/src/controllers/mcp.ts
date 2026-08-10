import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { Router } from 'express';
import { useLogger } from '../logger/index.js';
import {
	handleMcpRequest,
	isAllowedMcpOrigin,
	SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from '../mcp/index.js';
import asyncHandler from '../utils/async-handler.js';

const router = Router();

/**
 * The diagnostics MCP endpoint, served at `/diagnostics/mcp`: one JSON-RPC 2.0
 * exchange per request, no session and no stream, which is all a read-only tool
 * set needs. Not `/mcp` — upstream Directus serves its own MCP there, over the
 * content API, so the two must not land on the same path.
 *
 * The caller is an admin, authenticated the way every other admin surface here
 * authenticates: a session cookie, or `Authorization: Bearer <token>` naming a
 * Directus static token on an admin user. There is no credential of its own to
 * issue, revoke or leak — `authenticate` resolves the token before this router
 * ever runs, and the tools then pass through the same service guard the REST
 * endpoints use.
 */
router.post(
	'/',
	asyncHandler(async (req, res) => {
		if (isAllowedMcpOrigin(req.headers.origin) === false) {
			throw new ForbiddenError({
				reason: `Origin '${req.headers.origin}' is not named in `
					+ 'DIAGNOSTICS_MCP_ALLOWED_ORIGINS',
			});
		}

		// The client states the revision it negotiated; one this server does not
		// implement has to fail loudly rather than be answered in a dialect the
		// caller cannot read.
		const version = req.headers['mcp-protocol-version'];

		if (
			typeof version === 'string'
			&& SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(version) === false
		) {
			throw new InvalidPayloadError({
				reason: `Unsupported MCP-Protocol-Version: ${version}`,
			});
		}

		if (req.accountability?.admin !== true) {
			throw new ForbiddenError({
				reason: 'The diagnostics MCP endpoint is admin only',
			});
		}

		const response = await handleMcpRequest(req.body, {
			accountability: req.accountability,
			schema: req.schema,
		});

		// An admin-grade read of process environments and cache contents leaves a
		// trace, so who read what is answerable afterwards.
		useLogger().info(
			{
				ip: req.accountability.ip,
				user: req.accountability.user,
				method: req.body?.method,
				tool: req.body?.params?.name,
			},
			'Diagnostics MCP request',
		);

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
 * The transport reserves GET for an SSE stream. This server has none — a
 * read-only tool set needs no server-initiated messages — and the spec's answer
 * for that is 405, not the 404 an unrouted method would produce.
 */
router.get('/', (_req, res) => {
	res.sendStatus(405);
});

export default router;
