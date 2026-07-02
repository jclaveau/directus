import { createRequire } from "node:module";
import fse from "fs-extra";
import path from "path";
import { createHash } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { join } from "node:path";

//#region node/array-helpers.ts
function isIn(value, array) {
	return array.includes(value);
}
function isTypeIn(object, array) {
	if (!object.type) return false;
	return array.includes(object.type);
}

//#endregion
//#region node/get-node-env.ts
/**
* Get the configured Node Environment (eg "production", "development", etc)
*/
const getNodeEnv = () => process.env["NODE_ENV"];

//#endregion
//#region node/is-readable-stream.ts
const isReadableStream = (input) => {
	return input !== null && typeof input === "object" && typeof input.pipe === "function" && typeof input._read === "function" && typeof input._readableState === "object" && input.readable !== false;
};

//#endregion
//#region node/list-folders.ts
async function listFolders(location, options) {
	const fullPath = path.resolve(location);
	const files = await fse.readdir(fullPath);
	const directories = [];
	for (const file of files) {
		if (options?.ignoreHidden && file.startsWith(".")) continue;
		const filePath = path.join(fullPath, file);
		if ((await fse.stat(filePath)).isDirectory()) directories.push(file);
	}
	return directories;
}

//#endregion
//#region node/path-to-relative-url.ts
function pathToRelativeUrl(filePath, root = ".") {
	return path.relative(root, filePath).split(path.sep).join(path.posix.sep);
}

//#endregion
//#region node/pluralize.ts
function pluralize(str) {
	return `${str}s`;
}
function depluralize(str) {
	return str.slice(0, -1);
}

//#endregion
//#region node/process-id.ts
const _cache = { id: void 0 };
/**
* Return a unique hash for the current process on the current machine. Will be different after a
* restart
*/
const processId = () => {
	if (_cache.id) return _cache.id;
	const parts = [
		hostname(),
		process.pid,
		(/* @__PURE__ */ new Date()).getTime()
	];
	_cache.id = createHash("md5").update(parts.join("")).digest("hex");
	return _cache.id;
};

//#endregion
//#region node/readable-stream-to-string.ts
const readableStreamToString = async (stream) => {
	const chunks = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
};

//#endregion
//#region node/require-yaml.ts
const requireYaml = (filepath) => {
	const yamlRaw = readFileSync(filepath, "utf8");
	return yaml.load(yamlRaw);
};

//#endregion
//#region node/resolve-package.ts
const require = createRequire(import.meta.url);
function resolvePackage(name, root) {
	return path.dirname(require.resolve(`${name}/package.json`, root !== void 0 ? { paths: [root] } : void 0));
}

//#endregion
//#region node/tmp.ts
async function createTmpDirectory() {
	const path$1 = await fs.mkdtemp(join(tmpdir(), "directus-"));
	async function cleanup() {
		return await fs.rmdir(path$1);
	}
	return {
		path: path$1,
		cleanup
	};
}
async function createTmpFile() {
	const dir = await createTmpDirectory();
	const filename = createHash("sha1").update((/* @__PURE__ */ new Date()).toString()).digest("hex").substring(0, 8);
	const path$1 = join(dir.path, filename);
	try {
		await (await fs.open(path$1, "wx")).close();
	} catch (err) {
		await dir.cleanup();
		throw err;
	}
	async function cleanup() {
		await fs.unlink(path$1);
		await dir.cleanup();
	}
	return {
		path: path$1,
		cleanup
	};
}

//#endregion
export { _cache, createTmpFile, depluralize, getNodeEnv, isIn, isReadableStream, isTypeIn, listFolders, pathToRelativeUrl, pluralize, processId, readableStreamToString, requireYaml, resolvePackage };