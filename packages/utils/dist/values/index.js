//#region shared/array-helpers.ts
function isIn(value, array) {
	return array.includes(value);
}
function isTypeIn(object, array) {
	if (!object.type) return false;
	return array.includes(object.type);
}

//#endregion
//#region shared/compress.ts
var Types = /* @__PURE__ */ function(Types$1) {
	Types$1["NULL"] = "null";
	Types$1["UNDEFINED"] = "undefined";
	Types$1["STRING"] = "string";
	Types$1["INTEGER"] = "integer";
	Types$1["FLOAT"] = "float";
	Types$1["BOOLEAN"] = "boolean";
	Types$1["EMPTY"] = "empty";
	return Types$1;
}(Types || {});
var Tokens = /* @__PURE__ */ function(Tokens$1) {
	Tokens$1[Tokens$1["TRUE"] = -1] = "TRUE";
	Tokens$1[Tokens$1["FALSE"] = -2] = "FALSE";
	Tokens$1[Tokens$1["NULL"] = -3] = "NULL";
	Tokens$1[Tokens$1["EMPTY"] = -4] = "EMPTY";
	Tokens$1[Tokens$1["UNDEFINED"] = -5] = "UNDEFINED";
	return Tokens$1;
}(Tokens || {});
/**
* Compress any input object or array down to a minimal size reproduction in a string
* Inspired by `jsonpack`
*/
function compress(obj) {
	const strings = /* @__PURE__ */ new Map();
	const integers = /* @__PURE__ */ new Map();
	const floats = /* @__PURE__ */ new Map();
	const getAst = (part) => {
		if (part === null) return {
			type: Types.NULL,
			index: Tokens.NULL
		};
		if (part === void 0) return {
			type: Types.UNDEFINED,
			index: Tokens.UNDEFINED
		};
		if (Array.isArray(part)) return ["@", ...part.map((subPart) => getAst(subPart))];
		if (part instanceof Date) {
			const value = encode(part.toJSON());
			if (strings.has(value)) return {
				type: Types.STRING,
				index: strings.get(value)
			};
			const index = strings.size;
			strings.set(value, index);
			return {
				type: Types.STRING,
				index
			};
		}
		if (typeof part === "object") return ["$", ...Object.entries(part).map(([key, value]) => [getAst(key), getAst(value)]).flat()];
		if (part === "") return {
			type: Types.EMPTY,
			index: Tokens.EMPTY
		};
		if (typeof part === "string") {
			const value = encode(part);
			if (strings.has(value)) return {
				type: Types.STRING,
				index: strings.get(value)
			};
			const index = strings.size;
			strings.set(value, index);
			return {
				type: Types.STRING,
				index
			};
		}
		if (typeof part === "number" && Number.isInteger(part)) {
			const value = to36(part);
			if (integers.has(value)) return {
				type: Types.INTEGER,
				index: integers.get(value)
			};
			const index = integers.size;
			integers.set(value, index);
			return {
				type: Types.INTEGER,
				index
			};
		}
		if (typeof part === "number") {
			if (floats.has(part)) return {
				type: Types.FLOAT,
				index: floats.get(part)
			};
			const index = floats.size;
			floats.set(part, index);
			return {
				type: Types.FLOAT,
				index
			};
		}
		if (typeof part === "boolean") return {
			type: Types.BOOLEAN,
			index: part ? Tokens.TRUE : Tokens.FALSE
		};
		throw new Error(`Unexpected argument of type ${typeof part}`);
	};
	const ast = getAst(obj);
	const getCompressed = (part) => {
		if (Array.isArray(part)) {
			let compressed$1 = part.shift();
			part.forEach((subPart) => compressed$1 += getCompressed(subPart) + "|");
			if (compressed$1.endsWith("|")) compressed$1 = compressed$1.slice(0, -1);
			return compressed$1 + "]";
		}
		const { type, index } = part;
		switch (type) {
			case Types.STRING: return to36(index);
			case Types.INTEGER: return to36(strings.size + index);
			case Types.FLOAT: return to36(strings.size + integers.size + index);
			default: return index;
		}
	};
	let compressed = mapToSortedArray(strings).join("|");
	compressed += "^" + mapToSortedArray(integers).join("|");
	compressed += "^" + mapToSortedArray(floats).join("|");
	compressed += "^" + getCompressed(ast);
	return compressed;
}
function decompress(input) {
	const parts = input.split("^");
	if (parts.length !== 4) throw new Error(`Invalid input string given`);
	const values = [];
	if (parts[0]) values.push(...parts[0].split("|").map((part) => decode(part)));
	if (parts[1]) values.push(...parts[1].split("|").map((part) => to10(part)));
	if (parts[2]) values.push(...parts[2].split("|").map((part) => parseFloat(part)));
	let num36Buffer = "";
	const tokens = [];
	parts[3].split("").forEach((symbol) => {
		if ([
			"|",
			"$",
			"@",
			"]"
		].includes(symbol)) {
			if (num36Buffer) {
				tokens.push(to10(num36Buffer));
				num36Buffer = "";
			}
			if (symbol !== "|") tokens.push(symbol);
		} else num36Buffer += symbol;
	});
	let tokenIndex = 0;
	const getDecompressed = () => {
		const type = tokens[tokenIndex++];
		if (type === "$") {
			const node = {};
			for (; tokenIndex < tokens.length; tokenIndex++) {
				const rawKey = tokens[tokenIndex];
				if (rawKey === "]") return node;
				const rawValue = tokens[++tokenIndex];
				const key = values[rawKey];
				if (rawValue === "$" || rawValue === "@") node[key] = getDecompressed();
				else node[key] = values[rawValue] ?? getValueForToken(rawValue);
			}
		}
		if (type === "@") {
			const node = [];
			for (; tokenIndex < tokens.length; tokenIndex++) {
				const rawValue = tokens[tokenIndex];
				if (rawValue === "]") return node;
				if (rawValue === "$" || rawValue === "@") node.push(getDecompressed());
				else {
					const value = values[tokens[tokenIndex]] ?? getValueForToken(tokens[tokenIndex]);
					node.push(value);
				}
			}
		}
		throw new Error("Bad token: " + type);
	};
	return getDecompressed();
}
function mapToSortedArray(map) {
	const output = [];
	map.forEach((index, value) => {
		output[index] = value;
	});
	return output;
}
function encode(str) {
	return str.replace(/[+ |^%]/g, (a) => {
		switch (a) {
			case " ": return "+";
			case "+": return "%2B";
			case "|": return "%7C";
			case "^": return "%5E";
			case "%":
			default: return "%25";
		}
	});
}
function decode(str) {
	return str.replace(/\+|%2B|%7C|%5E|%25/g, (a) => {
		switch (a) {
			case "%25": return "%";
			case "%2B": return "+";
			case "%7C": return "|";
			case "%5E": return "^";
			case "+":
			default: return " ";
		}
	});
}
function to36(num) {
	return num.toString(36).toUpperCase();
}
function to10(str) {
	return parseInt(str, 36);
}
function getValueForToken(token) {
	switch (token) {
		case Tokens.TRUE: return true;
		case Tokens.FALSE: return false;
		case Tokens.NULL: return null;
		case Tokens.EMPTY: return "";
		case Tokens.UNDEFINED: return;
	}
}

//#endregion
//#region shared/get-filter-operators-for-type.ts
function getFilterOperatorsForType(type, opts) {
	const validationOnlyStringFilterOperators = opts?.includeValidation ? ["regex"] : [];
	switch (type) {
		case "binary":
		case "string":
		case "text":
		case "csv": return [
			"contains",
			"ncontains",
			"icontains",
			"starts_with",
			"nstarts_with",
			"istarts_with",
			"nistarts_with",
			"ends_with",
			"nends_with",
			"iends_with",
			"niends_with",
			"eq",
			"neq",
			"empty",
			"nempty",
			"null",
			"nnull",
			"in",
			"nin",
			...validationOnlyStringFilterOperators
		];
		case "hash": return [
			"empty",
			"nempty",
			"null",
			"nnull"
		];
		case "uuid": return [
			"eq",
			"neq",
			"null",
			"nnull",
			"in",
			"nin"
		];
		case "json": return ["null", "nnull"];
		case "boolean": return [
			"eq",
			"neq",
			"null",
			"nnull"
		];
		case "bigInteger":
		case "integer":
		case "decimal":
		case "float": return [
			"eq",
			"neq",
			"lt",
			"lte",
			"gt",
			"gte",
			"between",
			"nbetween",
			"null",
			"nnull",
			"in",
			"nin"
		];
		case "dateTime":
		case "date":
		case "time": return [
			"eq",
			"neq",
			"lt",
			"lte",
			"gt",
			"gte",
			"between",
			"nbetween",
			"null",
			"nnull",
			"in",
			"nin"
		];
		case "geometry": return [
			"eq",
			"neq",
			"null",
			"nnull",
			"intersects",
			"nintersects",
			"intersects_bbox",
			"nintersects_bbox"
		];
		default: return [
			"contains",
			"ncontains",
			"eq",
			"neq",
			"lt",
			"lte",
			"gt",
			"gte",
			"between",
			"nbetween",
			"empty",
			"nempty",
			"null",
			"nnull",
			"in",
			"nin",
			...validationOnlyStringFilterOperators
		];
	}
}

//#endregion
//#region shared/get-functions-for-type.ts
function getFunctionsForType(type) {
	switch (type) {
		case "dateTime":
		case "timestamp": return [
			"year",
			"month",
			"week",
			"day",
			"weekday",
			"hour",
			"minute",
			"second"
		];
		case "date": return [
			"year",
			"month",
			"week",
			"day",
			"weekday"
		];
		case "time": return [
			"hour",
			"minute",
			"second"
		];
		case "json": return ["count"];
		case "alias": return ["count"];
		default: return [];
	}
}

//#endregion
//#region shared/get-output-type-for-function.ts
function getOutputTypeForFunction(fn) {
	return {
		year: "integer",
		month: "integer",
		week: "integer",
		day: "integer",
		weekday: "integer",
		hour: "integer",
		minute: "integer",
		second: "integer",
		count: "integer"
	}[fn];
}

//#endregion
//#region shared/get-redacted-string.ts
const getRedactedString = (key) => `--redacted${key ? `:${key}` : ""}--`;
const REDACTED_TEXT = getRedactedString();

//#endregion
//#region shared/get-relation.ts
function getRelation(relations, collection, field) {
	return relations.find((relation) => {
		return relation.collection === collection && relation.field === field || relation.related_collection === collection && relation.meta?.one_field === field;
	});
}

//#endregion
//#region shared/get-simple-hash.ts
/**
* Generate a simple short hash for a given string
* This is not cryptographically secure in any way, and has a high chance of collision
*/
function getSimpleHash(str) {
	let hash = 0;
	for (let i = 0; i < str.length; hash &= hash) hash = 31 * hash + str.charCodeAt(i++);
	return Math.abs(hash).toString(16);
}

//#endregion
//#region shared/is-object.ts
function isObject(input) {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

//#endregion
//#region shared/parse-json.ts
/**
* Run JSON.parse, but ignore `__proto__` properties. This prevents prototype pollution attacks
*/
function parseJSON(input) {
	if (String(input).includes("__proto__")) return JSON.parse(input, noproto);
	return JSON.parse(input);
}
function noproto(key, value) {
	if (key !== "__proto__") return value;
}

//#endregion
//#region shared/to-array.ts
function toArray(val) {
	if (typeof val === "string") return val.split(",");
	return Array.isArray(val) ? val : [val];
}

//#endregion
//#region shared/to-boolean.ts
/**
* Convert environment variable to Boolean
*/
function toBoolean(value) {
	return value === "true" || value === true || value === "1" || value === 1;
}

//#endregion
export { REDACTED_TEXT, compress, decompress, getFilterOperatorsForType, getFunctionsForType, getOutputTypeForFunction, getRedactedString, getRelation, getSimpleHash, isIn, isObject, isTypeIn, noproto, parseJSON, toArray, toBoolean };