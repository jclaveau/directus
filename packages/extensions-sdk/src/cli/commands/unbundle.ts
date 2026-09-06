import fse from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger.js';

type SourceMap = {
	sources?: string[];
	sourcesContent?: (string | null)[];
	sourceRoot?: string;
};

/**
 * Writes the original sources a bundle's map carries back out as a directory tree. A
 * built extension ships without them, so the map is the only place left to read what
 * a stack trace points at — or to patch a single module of a deployed extension.
 */
export default async function unbundle(
	bundle: string,
	directory: string,
): Promise<void> {
	const mapPath = bundle.endsWith('.map')
		? bundle
		: `${bundle}.map`;

	if (!(await fse.pathExists(mapPath))) {
		log(`No source map at ${path.resolve(mapPath)}.`, 'error');
		log(`Build the extension with --sourcemap to get one.`, 'error');

		process.exit(1);
	}

	let map: SourceMap;

	try {
		map = await fse.readJson(mapPath);
	}
	catch {
		log(`${path.resolve(mapPath)} is not a readable source map.`, 'error');

		process.exit(1);
	}

	const sources = map.sources ?? [];
	const contents = map.sourcesContent ?? [];

	if (contents.length === 0) {
		log(`${path.resolve(mapPath)} carries no source content.`, 'error');
		log(`It maps positions only, so there is nothing to write out.`, 'error');

		process.exit(1);
	}

	const taken = new Set<string>();
	let written = 0;
	let contentless = 0;
	let collided = 0;

	for (const [index, source] of sources.entries()) {
		const content = contents[index];

		// json modules arrive named but empty, so an empty string is an absent source
		// rather than an empty file
		if (typeof content !== 'string' || content === '') {
			contentless++;
			continue;
		}

		// the paths are the author's, so they can be absolute or climb out of the map's
		// own directory: every segment that would leave the target is dropped, never
		// followed
		const relative = path.posix
			.join(map.sourceRoot ?? '', source)
			.replaceAll('\\', '/')
			.split('/')
			.filter((segment) => {
				return segment !== '' && segment !== '.' && segment !== '..';
			})
			.join('/');

		if (relative === '') {
			contentless++;
			continue;
		}

		if (taken.has(relative)) {
			collided++;
		}

		taken.add(relative);

		await fse.outputFile(path.resolve(directory, relative), content);
		written++;
	}

	log(`Wrote ${written} source file(s) to ${path.resolve(directory)}`);

	if (contentless > 0) {
		log(`${contentless} source(s) the map names carry no content.`, 'warn');
	}

	if (collided > 0) {
		log(`${collided} source(s) landed on a path another one had taken.`, 'warn');
	}
}
