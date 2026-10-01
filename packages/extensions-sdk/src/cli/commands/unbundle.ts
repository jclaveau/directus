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
	let mapPath = bundle.endsWith('.map')
		? bundle
		: `${bundle}.map`;

	// a build that named its map something else says so in the bundle's last line
	if (!(await fse.pathExists(mapPath)) && (await fse.pathExists(bundle))) {
		const tail = (await fse.readFile(bundle, 'utf8')).slice(-2048);
		const named = /[#@]\s*sourceMappingURL=(\S+)/.exec(tail);

		if (named?.[1] && !named[1].startsWith('data:')) {
			mapPath = path.resolve(path.dirname(bundle), named[1]);
		}
	}

	if (!(await fse.pathExists(mapPath))) {
		log(`No source map at ${path.resolve(mapPath)}.`, 'error');
		log(`Build the extension with --sourcemap to get one.`, 'error');

		process.exit(1);
	}

	// the map is parsed as one string, so a big one needs a heap to match rather than
	// the bare "out of memory" it would otherwise die with
	const { size } = await fse.stat(mapPath);

	if (size > 200e6) {
		log(
			`${path.resolve(mapPath)} is ${(size / 1e6).toFixed(0)} MB;`
			+ ` node may need --max-old-space-size to parse it.`,
			'warn',
		);
	}

	// leftovers from an earlier extraction are indistinguishable from this one's, and
	// reading a file that belongs to another build is the whole failure this avoids
	const existing = await fse.readdir(directory).catch(() => []);

	if (existing.length > 0) {
		log(`${path.resolve(directory)} already holds files.`, 'error');
		log(`Point at a new directory, or empty this one first.`, 'error');

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
	let unmapped = 0;
	let collided = 0;

	for (const [index, source] of sources.entries()) {
		const content = contents[index];

		// json modules arrive named but empty, so an empty string is an absent source
		// rather than an empty file
		if (typeof content !== 'string' || content === '') {
			contentless++;
			continue;
		}

		// the paths are the author's, so they can be absolute, carry a windows drive or
		// climb out of the map's own directory: every segment that would leave the
		// target is dropped, never followed
		let relative = path.posix
			.join(map.sourceRoot ?? '', source)
			.replaceAll('\\', '/')
			.split('/')
			.filter((segment) => {
				const walks = segment === '' || segment === '.' || segment === '..';

				return !walks && !/^[a-z]:$/i.test(segment);
			})
			.join('/');

		// nothing of the path survived, but the content did, and dropping it silently
		// is how a source goes missing without anyone being told
		if (relative === '') {
			relative = `_unmapped/source-${index}`;
			unmapped++;
		}

		// two sanitised paths can meet (/tmp/a.ts and tmp/a.ts), and the second must
		// not take the first one's content with it
		let target = relative;
		let attempt = 1;

		while (taken.has(target)) {
			const extension = path.posix.extname(relative);
			const stem = relative.slice(0, relative.length - extension.length);

			attempt++;
			target = `${stem}-${attempt}${extension}`;
		}

		if (target !== relative) {
			collided++;
		}

		taken.add(target);

		await fse.outputFile(path.resolve(directory, target), content);
		written++;
	}

	log(`Wrote ${written} source file(s) to ${path.resolve(directory)}`);

	if (contentless > 0) {
		log(`${contentless} source(s) the map names carry no content.`, 'warn');
	}

	if (unmapped > 0) {
		log(
			`${unmapped} source(s) had no usable path, written under _unmapped/.`,
			'warn',
		);
	}

	if (collided > 0) {
		log(
			`${collided} source(s) shared a path; the later ones carry a suffix.`,
			'warn',
		);
	}
}
