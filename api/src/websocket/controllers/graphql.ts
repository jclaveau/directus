import type { Server } from 'graphql-ws';
import { execute, subscribe, type ExecutionArgs } from 'graphql';
import { CloseCode, MessageType, makeServer } from 'graphql-ws';
import type { Server as httpServer } from 'node:http';
import type { WebSocket } from 'ws';
import type { WebSocketMessage } from '@directus/types';
import { useLogger } from '../../logger/index.js';
import { createDefaultAccountability } from '../../permissions/utils/create-default-accountability.js';
import { executingService } from '../../services/graphql/schema-cache.js';
import { bindPubSub } from '../../services/graphql/subscription.js';
import { GraphQLService } from '../../services/index.js';
import { getAddress } from '../../utils/get-address.js';
import { getSchema } from '../../utils/get-schema.js';
import { authenticateConnection } from '../authenticate.js';
import { handleWebSocketError } from '../errors.js';
import { ConnectionParams } from '../messages.js';
import type { AuthenticationState, GraphQLSocket, UpgradeContext, WebSocketClient } from '../types.js';
import { getMessageType } from '../utils/message.js';
import SocketController from './base.js';
import { registerWebSocketEvents } from './hooks.js';

const logger = useLogger();

async function createClientService(client: WebSocketClient) {
	// for now only the items will be watched, system events tbd
	return new GraphQLService({
		schema: await getSchema(),
		scope: 'items',
		accountability: client.accountability,
	});
}

function serviceOf({ contextValue }: ExecutionArgs) {
	return (contextValue as { service: GraphQLService }).service;
}

export class GraphQLSubscriptionController extends SocketController {
	gql: Server<GraphQLSocket>;
	constructor(httpServer: httpServer) {
		super(httpServer, 'WEBSOCKETS_GRAPHQL');
		registerWebSocketEvents();

		this.server.on('connection', (ws: WebSocket, auth: AuthenticationState) => {
			this.bindEvents(this.createClient(ws, auth));
		});

		this.gql = makeServer<ConnectionParams, GraphQLSocket>({
			schema: async (ctx) => {
				const service = await createClientService(ctx.extra.client);

				return service.getSchema();
			},
			// The service an operation runs as, so the resolvers of a cached schema
			// read this client's accountability, not the one that built the schema.
			context: async (ctx) => {
				return { service: await createClientService(ctx.extra.client) };
			},
			execute: (args) => {
				return executingService.run(serviceOf(args), () => execute(args));
			},
			subscribe: (args) => {
				return executingService.run(serviceOf(args), () => subscribe(args));
			},
		});

		bindPubSub();

		logger.info(`GraphQL Subscriptions started at ${getAddress(httpServer)}${this.endpoint}`);
	}

	private bindEvents(client: WebSocketClient) {
		const closedHandler = this.gql.opened(
			{
				protocol: client.protocol,
				send: (data) =>
					new Promise((resolve, reject) => {
						client.send(data, (err) => (err ? reject(err) : resolve()));
					}),
				close: (code, reason) => client.close(code, reason), // for standard closures
				onMessage: (cb) => {
					client.on('parsed-message', async (message: WebSocketMessage) => {
						try {
							if (getMessageType(message) === 'connection_init' && this.authentication.mode !== 'strict') {
								const params = ConnectionParams.parse(message['payload'] ?? {});

								if (this.authentication.mode === 'handshake') {
									if (typeof params.access_token === 'string') {
										const { accountability, expires_at } = await authenticateConnection(
											{
												access_token: params.access_token,
											},
											{
												ip: client.accountability?.ip ?? null,
												userAgent: client.accountability?.userAgent,
												origin: client.accountability?.origin,
											},
										);

										client.accountability = accountability;
										client.expires_at = expires_at;
									} else {
										client.close(CloseCode.Forbidden, 'Forbidden');
										return;
									}
								}
							} else if (this.authentication.mode === 'handshake' && !client.accountability?.user) {
								// the first message should authenticate successfully in this mode
								client.close(CloseCode.Forbidden, 'Forbidden');
								return;
							}

							await cb(JSON.stringify(message));
						} catch (error) {
							handleWebSocketError(client, error, MessageType.Error);
						}
					});
				},
			},
			{ client },
		);

		// notify server that the socket closed
		client.once('close', (code, reason) => closedHandler(code, reason.toString()));

		// check strict authentication status
		if (this.authentication.mode === 'strict' && !client.accountability?.user) {
			client.close(CloseCode.Forbidden, 'Forbidden');
		}
	}

	override setTokenExpireTimer(client: WebSocketClient) {
		if (client.auth_timer !== null) {
			clearTimeout(client.auth_timer);
			client.auth_timer = null;
		}

		if (this.authentication.mode !== 'handshake') return;

		client.auth_timer = setTimeout(() => {
			if (!client.accountability?.user) {
				client.close(CloseCode.Forbidden, 'Forbidden');
			}
		}, this.authentication.timeout);
	}

	protected override async handleHandshakeUpgrade(
		{ request, socket, head, accountabilityOverrides }: UpgradeContext,
	) {
		this.server.handleUpgrade(request, socket, head, async (ws) => {
			// Kept until connection_init authenticates, which reads the IP from here.
			const accountability = createDefaultAccountability(accountabilityOverrides);

			this.server.emit('connection', ws, { accountability, expires_at: null });
			// actual enforcement is handled by the setTokenExpireTimer function
		});
	}
}
