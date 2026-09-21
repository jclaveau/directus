import net from 'node:net';

// A RESP inline `SET` as node-redis frames it, at the head of its argument list.
// A value cannot carry it: JSON escapes its newlines, base64 has none.
const SET_COMMAND = '$3\r\nSET\r\n';

// A proxy we can kill and bring back, so the API keeps its config and only the
// connection dies — what a real Redis blip looks like from the app's side. It
// can also hold every `SET` back for a while, which is what a slow Redis looks
// like from the app's side, and the only way to make a fill measurably long.
export function createRedisProxy(upstreamPort: number, listenPort: number) {
	const sockets = new Set<net.Socket>();
	let server: net.Server | null = null;
	let setDelayMs = 0;

	function open(): Promise<void> {
		server = net.createServer((client) => {
			const upstream = net.createConnection({
				host: '127.0.0.1',
				port: upstreamPort,
			});

			sockets.add(client);
			sockets.add(upstream);

			// Forwarded by hand rather than piped so a chunk can wait. What waits
			// holds everything after it on the connection: a value spans chunks,
			// and a chunk let past one still waiting would land inside it.
			let forwarding: Promise<void> = Promise.resolve();

			client.on('data', (chunk: Buffer) => {
				forwarding = forwarding.then(async () => {
					if (setDelayMs > 0 && chunk.includes(SET_COMMAND)) {
						await new Promise((resolve) => setTimeout(resolve, setDelayMs));
					}

					if (!upstream.destroyed) {
						upstream.write(chunk);
					}
				});
			});

			upstream.pipe(client);

			// Either side going away takes the pair with it; without this a half-open
			// socket keeps `server.close()` waiting.
			const drop = () => {
				client.destroy();
				upstream.destroy();
				sockets.delete(client);
				sockets.delete(upstream);
			};

			client.on('error', drop);
			upstream.on('error', drop);
			client.on('close', drop);
			upstream.on('close', drop);
		});

		return new Promise((resolve) => {
			server!.listen(listenPort, () => resolve());
		});
	}

	function cut(): Promise<void> {
		for (const socket of sockets) {
			socket.destroy();
		}

		sockets.clear();

		// Already down: the cleanup calls this too, and a case that failed before
		// reopening would otherwise throw here and bury the real failure.
		if (server === null) {
			return Promise.resolve();
		}

		const listening = server;

		return new Promise((resolve) => {
			listening.close(() => {
				server = null;
				resolve();
			});
		});
	}

	function delaySets(ms: number): void {
		setDelayMs = ms;
	}

	return { open, cut, delaySets };
}
