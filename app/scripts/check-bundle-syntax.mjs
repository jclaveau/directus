// Parses every JavaScript chunk of the built app as an ES module, without running
// it. A chunk the browser can't parse leaves the whole admin blank, and nothing
// else in the build or the unit tests reads the emitted code: the dynamic import
// preload wrapper once moved an `await` into a non-async arrow and every page
// failed with `SyntaxError: await is a reserved identifier`.
// Needs `--experimental-vm-modules` for vm.SourceTextModule.
/* eslint-disable no-console -- a build step reports on the console */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceTextModule } from 'node:vm';

const assetsDirectory = process.argv[2] ?? 'dist/assets';

const chunkFiles = readdirSync(assetsDirectory)
	.filter((fileName) => fileName.endsWith('.js'));

const unparsableChunks = [];

for (const chunkFile of chunkFiles) {
	const chunkPath = join(assetsDirectory, chunkFile);
	const chunkSource = readFileSync(chunkPath, 'utf8');

	try {
		new SourceTextModule(chunkSource, { identifier: chunkPath });
	}
	catch (parseError) {
		const parseFailure = `${parseError.name}: ${parseError.message}`;

		unparsableChunks.push(`${JSON.stringify(chunkPath)}: ${parseFailure}`);
	}
}

if (chunkFiles.length === 0) {
	const assetsName = JSON.stringify(assetsDirectory);

	console.error(`No .js chunk in ${assetsName}: was the app built?`);
	process.exit(1);
}

if (unparsableChunks.length > 0) {
	const chunkReport = unparsableChunks.join('\n');

	console.error(
		`${unparsableChunks.length} app chunk(s) a browser can't parse:\n${chunkReport}`,
	);

	process.exit(1);
}

console.info(`Parsed ${chunkFiles.length} app chunks as ES modules`);
