import { marked } from "marked";
import sanitizeHTML from "sanitize-html";

//#region src/utils/md.ts
/**
* Render and sanitize a markdown string
*/
function md(value) {
	return sanitizeHTML(marked.parse(value));
}

//#endregion
export { md };