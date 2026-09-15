//#region src/services/files/utils/parse-image-metadata.ts
const IPTC_ENTRY_TYPES = new Map([
	[120, "caption"],
	[110, "credit"],
	[25, "keywords"],
	[55, "dateCreated"],
	[80, "byline"],
	[85, "bylineTitle"],
	[122, "captionWriter"],
	[105, "headline"],
	[116, "copyright"],
	[15, "category"]
]);
const IPTC_ENTRY_MARKER = Buffer.from([28, 2]);
function parseIptc(buffer) {
	if (!Buffer.isBuffer(buffer)) return {};
	const iptc = {};
	let lastIptcEntryPos = buffer.indexOf(IPTC_ENTRY_MARKER);
	while (lastIptcEntryPos !== -1) {
		lastIptcEntryPos = buffer.indexOf(IPTC_ENTRY_MARKER, lastIptcEntryPos + IPTC_ENTRY_MARKER.byteLength);
		const iptcBlockTypePos = lastIptcEntryPos + IPTC_ENTRY_MARKER.byteLength;
		const iptcBlockSizePos = iptcBlockTypePos + 1;
		const iptcBlockDataPos = iptcBlockSizePos + 2;
		const iptcBlockType = buffer.readUInt8(iptcBlockTypePos);
		const iptcBlockSize = buffer.readUInt16BE(iptcBlockSizePos);
		if (!IPTC_ENTRY_TYPES.has(iptcBlockType)) continue;
		const iptcBlockTypeId = IPTC_ENTRY_TYPES.get(iptcBlockType);
		const iptcData = buffer.subarray(iptcBlockDataPos, iptcBlockDataPos + iptcBlockSize).toString();
		if (iptcBlockTypeId) if (iptc[iptcBlockTypeId] == null) iptc[iptcBlockTypeId] = iptcData;
		else if (Array.isArray(iptc[iptcBlockTypeId])) iptc[iptcBlockTypeId].push(iptcData);
		else iptc[iptcBlockTypeId] = [iptc[iptcBlockTypeId], iptcData];
	}
	return iptc;
}
function parseXmp(buffer) {
	const xmp = {};
	[
		"title",
		"description",
		"rights",
		"creator",
		"subject"
	].forEach((x) => {
		const tagMatches = new RegExp(`<dc:${x}>(.*?)</dc:${x}>`, "smig").exec(buffer.toString());
		if (!tagMatches || tagMatches.length === 0) return;
		const value = tagMatches[1]?.trim();
		if (value?.toLowerCase().indexOf("<rdf:bag>") === 0) {
			const r = new RegExp("<rdf:li>(.*?)</rdf:li>", "smig");
			let match = r.exec(value);
			const result = [];
			while (match) {
				result.push(match[1]);
				match = r.exec(value);
			}
			xmp[x] = result;
		} else xmp[x] = value?.replace(/<[^>]*>?/gm, "").trim();
	});
	return xmp;
}

//#endregion
export { parseIptc, parseXmp };