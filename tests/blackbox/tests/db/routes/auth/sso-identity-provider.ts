import getPort from 'get-port';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';

export type IdentityProfile = { sub: string } & Record<string, unknown>;

type PendingCode = { profile: IdentityProfile; nonce: string | null };

const SIGNING_KEY_ID = 'sso-mock-key';

/**
 * An identity provider answering the code flow on its own port: `/authorize`
 * hands the next login's profile a code, `/token` trades it (and refresh
 * tokens), `/userinfo` answers the profile. With `signsIdToken`, it is an
 * OpenID issuer too: discovery, JWKS, and an RS256 `id_token` on the code grant.
 *
 * A subject's refresh tokens are `<sub>-refresh-<n>`, n counting the ones it
 * was given.
 */
export class MockIdentityProvider {
	issuerUrl = '';
	nextProfile: IdentityProfile | null = null;

	private readonly httpServer: Server;
	private readonly signingKey: KeyObject;
	private readonly publicJwk: Record<string, unknown>;
	private readonly pendingCodes = new Map<string, PendingCode>();
	private readonly profileByAccessToken = new Map<string, IdentityProfile>();
	private readonly profileByRefreshToken = new Map<string, IdentityProfile>();
	private readonly refreshCountBySubject = new Map<string, number>();
	private issuedCodeCount = 0;

	constructor(
		private readonly clientId: string,
		private readonly signsIdToken: boolean,
	) {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', {
			modulusLength: 2048,
		});

		this.signingKey = privateKey;

		this.publicJwk = {
			...publicKey.export({ format: 'jwk' }),
			kid: SIGNING_KEY_ID,
			alg: 'RS256',
			use: 'sig',
		};

		this.httpServer = createServer((incoming, outgoing) => {
			this.answer(incoming, outgoing).catch((error: unknown) => {
				outgoing.writeHead(500).end(String(error));
			});
		});
	}

	async start() {
		const freePort = await getPort();

		await new Promise<void>((resolve) => {
			this.httpServer.listen(freePort, '127.0.0.1', resolve);
		});

		this.issuerUrl = `http://127.0.0.1:${freePort}`;
	}

	stop() {
		return new Promise<void>((resolve) => {
			this.httpServer.close(() => resolve());
		});
	}

	private async answer(incoming: IncomingMessage, outgoing: ServerResponse) {
		const requestUrl = new URL(incoming.url ?? '/', this.issuerUrl);

		switch (requestUrl.pathname) {
			case '/.well-known/openid-configuration':
				return sendJson(outgoing, this.discoveryDocument());
			case '/jwks':
				return sendJson(outgoing, { keys: [this.publicJwk] });
			case '/authorize':
				return this.authorize(requestUrl, outgoing);
			case '/token':
				return this.grantTokens(await readForm(incoming), outgoing);
			case '/userinfo':
				return this.sendUserInfo(incoming, outgoing);
			default:
				outgoing.writeHead(404).end();
		}
	}

	private discoveryDocument() {
		return {
			issuer: this.issuerUrl,
			authorization_endpoint: `${this.issuerUrl}/authorize`,
			token_endpoint: `${this.issuerUrl}/token`,
			userinfo_endpoint: `${this.issuerUrl}/userinfo`,
			jwks_uri: `${this.issuerUrl}/jwks`,
			response_types_supported: ['code'],
			subject_types_supported: ['public'],
			id_token_signing_alg_values_supported: ['RS256'],
		};
	}

	private authorize(requestUrl: URL, outgoing: ServerResponse) {
		if (this.nextProfile === null) {
			outgoing.writeHead(400).end('no profile for this login');
			return;
		}

		this.issuedCodeCount += 1;

		const issuedCode = `code-${this.issuedCodeCount}`;

		this.pendingCodes.set(issuedCode, {
			profile: this.nextProfile,
			nonce: requestUrl.searchParams.get('nonce'),
		});

		const callbackUrl = new URL(
			requestUrl.searchParams.get('redirect_uri') ?? '',
		);

		callbackUrl.searchParams.set('code', issuedCode);

		callbackUrl.searchParams.set(
			'state',
			requestUrl.searchParams.get('state') ?? '',
		);

		outgoing.writeHead(302, { Location: callbackUrl.toString() }).end();
	}

	private grantTokens(form: URLSearchParams, outgoing: ServerResponse) {
		if (form.get('grant_type') === 'refresh_token') {
			const refreshedProfile = this.profileByRefreshToken.get(
				form.get('refresh_token') ?? '',
			);

			if (refreshedProfile === undefined) {
				return sendJson(outgoing, { error: 'invalid_grant' }, 400);
			}

			return sendJson(outgoing, this.issueTokens(refreshedProfile));
		}

		const pendingCode = this.pendingCodes.get(form.get('code') ?? '');

		if (pendingCode === undefined) {
			return sendJson(outgoing, { error: 'invalid_grant' }, 400);
		}

		this.pendingCodes.delete(form.get('code')!);

		const issuedTokens: Record<string, unknown> = this.issueTokens(
			pendingCode.profile,
		);

		if (this.signsIdToken) {
			issuedTokens['id_token'] = this.signIdToken(pendingCode);
		}

		return sendJson(outgoing, issuedTokens);
	}

	private issueTokens(profile: IdentityProfile) {
		const refreshCount = (this.refreshCountBySubject.get(profile.sub) ?? 0) + 1;
		const refreshToken = `${profile.sub}-refresh-${refreshCount}`;
		const accessToken = `${profile.sub}-access-${refreshCount}`;

		this.refreshCountBySubject.set(profile.sub, refreshCount);
		this.profileByRefreshToken.set(refreshToken, profile);
		this.profileByAccessToken.set(accessToken, profile);

		return {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 300,
			refresh_token: refreshToken,
		};
	}

	private signIdToken({ profile, nonce }: PendingCode) {
		const issuedAt = Math.floor(Date.now() / 1000);

		const header = toBase64Url({
			alg: 'RS256',
			typ: 'JWT',
			kid: SIGNING_KEY_ID,
		});

		const claims = toBase64Url({
			iss: this.issuerUrl,
			aud: this.clientId,
			sub: profile.sub,
			nonce,
			iat: issuedAt,
			exp: issuedAt + 300,
		});

		return `${header}.${claims}.${
			sign('sha256', Buffer.from(`${header}.${claims}`), this.signingKey)
				.toString('base64url')
		}`;
	}

	private sendUserInfo(incoming: IncomingMessage, outgoing: ServerResponse) {
		const knownProfile = this.profileByAccessToken.get(
			(incoming.headers.authorization ?? '').replace(/^Bearer /, ''),
		);

		if (knownProfile === undefined) {
			return sendJson(outgoing, { error: 'invalid_token' }, 401);
		}

		return sendJson(outgoing, knownProfile);
	}
}

function toBase64Url(value: object) {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sendJson(outgoing: ServerResponse, body: object, statusCode = 200) {
	outgoing
		.writeHead(statusCode, { 'Content-Type': 'application/json' })
		.end(JSON.stringify(body));
}

async function readForm(incoming: IncomingMessage) {
	const chunks: Buffer[] = [];

	for await (const chunk of incoming) {
		chunks.push(chunk as Buffer);
	}

	return new URLSearchParams(Buffer.concat(chunks).toString());
}
