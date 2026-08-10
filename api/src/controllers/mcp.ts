import { ForbiddenError } from '@directus/errors';
import { Router } from 'express';
import { handleMcpRequest, mcpTokenAccountability } from '../mcp/index.js';
import asyncHandler from '../utils/async-handler.js';

const router = Router();

/**
 * The diagnostics MCP endpoint, served at `/diagnostics/mcp`: one JSON-RPC 2.0
 * exchange per request, no session and no stream, which is all a read-only tool
 * set needs. Not `/mcp` — upstream Directus serves its own MCP there, over the
 * content API, so the two must not land on the same path.
 *
 * An admin session or token gets in as itself; otherwise an
 * `Authorization: Mcp <token>` header from `DIAGNOSTICS_MCP_TOKENS` does — the
 * shape `/metrics` uses for the same reason, so an agent can be given a
 * credential that is not a login.
 */
router.post(
	'/',
	asyncHandler(async (req, res) => {
		const accountability = req.accountability?.admin === true
			? req.accountability
			: mcpTokenAccountability(req.headers.authorization, req.ip ?? null);

		if (accountability === null) {
			throw new ForbiddenError({
				reason: 'The diagnostics MCP endpoint needs an admin identity, or an '
					+ '`Authorization: Mcp <token>` header naming a configured '
					+ 'DIAGNOSTICS_MCP_TOKENS value',
			});
		}

		const response = await handleMcpRequest(req.body, {
			accountability,
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

export default router;
