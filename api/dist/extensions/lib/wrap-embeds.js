//#region src/extensions/lib/wrap-embeds.ts
/**
* Wraps an array of passed strings in a set of HTML comments with the given label
*/
const wrapEmbeds = (label, content) => {
	if (content.length === 0) return "";
	return `<!-- Start ${label} -->\n${content.join("\n")}\n<!-- End ${label} -->`;
};

//#endregion
export { wrapEmbeds };