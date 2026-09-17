import net from 'node:net';

// A proxy we can kill and bring back, so the API keeps its config and only the
// connection dies — what a real Redis blip looks like from the app's side.
export function createRedisProxy(upstreamPort: number, listenPort: number) {
	const sockets = new Set<net.Socket>();
	let server: net.Server | null = null;

	function open(): Promise<void> {
		server = net.createServer((client) => {
			const upstream = net.createConnection({
				host: '127.0.0.1',
				port: upstreamPort,
			});

			sockets.add(client);
			sockets.add(upstream);

			client.pipe(upstream);
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

	return { open, cut };
}
