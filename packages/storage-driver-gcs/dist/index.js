import { DEFAULT_CHUNK_SIZE } from "@directus/constants";
import { normalizePath } from "@directus/utils";
import { Storage } from "@google-cloud/storage";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

//#region src/index.ts
const MINIMUM_CHUNK_SIZE = 262144;
var DriverGCS = class {
	root;
	bucket;
	preferredChunkSize;
	constructor(config) {
		const { bucket, root, tus,...storageOptions } = config;
		this.root = root ? normalizePath(root, { removeLeading: true }) : "";
		this.bucket = new Storage(storageOptions).bucket(bucket);
		this.preferredChunkSize = tus?.chunkSize || DEFAULT_CHUNK_SIZE;
		if (tus?.enabled && (this.preferredChunkSize < MINIMUM_CHUNK_SIZE || Math.log2(this.preferredChunkSize) % 1 !== 0)) throw new Error("Invalid chunkSize provided");
	}
	fullPath(filepath) {
		return normalizePath(join(this.root, filepath));
	}
	file(filepath) {
		return this.bucket.file(filepath);
	}
	async read(filepath, options) {
		const { range } = options || {};
		const stream_options = {};
		if (range?.start) stream_options.start = range.start;
		if (range?.end) stream_options.end = range.end;
		return this.file(this.fullPath(filepath)).createReadStream(stream_options);
	}
	async write(filepath, content) {
		await pipeline(content, this.file(this.fullPath(filepath)).createWriteStream({ resumable: false }));
	}
	async delete(filepath) {
		await this.file(this.fullPath(filepath)).delete();
	}
	async stat(filepath) {
		const [{ size, updated }] = await this.file(this.fullPath(filepath)).getMetadata();
		return {
			size,
			modified: new Date(updated)
		};
	}
	async exists(filepath) {
		return (await this.file(this.fullPath(filepath)).exists())[0];
	}
	async move(src, dest) {
		await this.file(this.fullPath(src)).move(this.file(this.fullPath(dest)));
	}
	async copy(src, dest) {
		await this.file(this.fullPath(src)).copy(this.file(this.fullPath(dest)));
	}
	async *list(prefix = "") {
		let query = {
			prefix: this.fullPath(prefix),
			autoPaginate: false,
			maxResults: 500
		};
		while (query) {
			const [files, nextQuery] = await this.bucket.getFiles(query);
			for (const file of files) yield file.name.substring(this.root.length);
			query = nextQuery;
		}
	}
	get tusExtensions() {
		return [
			"creation",
			"termination",
			"expiration"
		];
	}
	async createChunkedUpload(filepath, context) {
		const [uri] = await this.file(this.fullPath(filepath)).createResumableUpload();
		context.metadata["uri"] = uri;
		return context;
	}
	async writeChunk(filepath, content, offset, context) {
		const stream = this.file(this.fullPath(filepath)).createWriteStream({
			chunkSize: this.preferredChunkSize,
			uri: context.metadata["uri"],
			offset,
			isPartialUpload: true,
			resumeCRC32C: context.metadata["hash"],
			metadata: { contentLength: context.size || 0 }
		});
		stream.on("crc32c", (hash) => {
			context.metadata["hash"] = hash;
		});
		let bytesUploaded = offset || 0;
		content.on("data", (chunk) => {
			bytesUploaded += chunk.length;
		});
		await pipeline(content, stream);
		return bytesUploaded;
	}
	async finishChunkedUpload(_filepath, _context) {}
	async deleteChunkedUpload(filepath, _context) {
		await this.delete(filepath);
	}
};
var src_default = DriverGCS;

//#endregion
export { DriverGCS, src_default as default };