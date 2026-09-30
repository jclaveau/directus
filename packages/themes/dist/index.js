import { Teleport as e, computed as t, createBlock as n, createTextVNode as r, defineComponent as i, openBlock as a, reactive as o, toDisplayString as ee, toRefs as te, unref as s } from "vue";
import { useHead as ne } from "@unhead/vue";
import { cssVar as re } from "@directus/utils/browser";
import { get as ie, mapKeys as ae, merge as oe } from "lodash-es";
import { defineStore as se, storeToRefs as ce } from "pinia";
import le from "decamelize";
import { flatten as ue } from "flat";
//#region \0rolldown/runtime.js
var de = Object.defineProperty, fe = (e, t) => {
	let n = {};
	for (var r in e) de(n, r, {
		get: e[r],
		enumerable: !0
	});
	return t || de(n, Symbol.toStringTag, { value: "Module" }), n;
};
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/guard/value.mjs
function pe(e) {
	return u(e) && !c(e) && !Se(e) && Symbol.asyncIterator in e;
}
function c(e) {
	return Array.isArray(e);
}
function me(e) {
	return typeof e == "bigint";
}
function he(e) {
	return typeof e == "boolean";
}
function ge(e) {
	return e instanceof globalThis.Date;
}
function _e(e) {
	return typeof e == "function";
}
function ve(e) {
	return u(e) && !c(e) && !Se(e) && Symbol.iterator in e;
}
function ye(e) {
	return e === null;
}
function l(e) {
	return typeof e == "number";
}
function u(e) {
	return typeof e == "object" && !!e;
}
function be(e) {
	return e instanceof globalThis.RegExp;
}
function d(e) {
	return typeof e == "string";
}
function xe(e) {
	return typeof e == "symbol";
}
function Se(e) {
	return e instanceof globalThis.Uint8Array;
}
function f(e) {
	return e === void 0;
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/clone/value.mjs
function Ce(e) {
	return e.map((e) => Oe(e));
}
function we(e) {
	return new Date(e.getTime());
}
function Te(e) {
	return new Uint8Array(e);
}
function Ee(e) {
	return new RegExp(e.source, e.flags);
}
function De(e) {
	let t = {};
	for (let n of Object.getOwnPropertyNames(e)) t[n] = Oe(e[n]);
	for (let n of Object.getOwnPropertySymbols(e)) t[n] = Oe(e[n]);
	return t;
}
function Oe(e) {
	return c(e) ? Ce(e) : ge(e) ? we(e) : Se(e) ? Te(e) : be(e) ? Ee(e) : u(e) ? De(e) : e;
}
function p(e) {
	return Oe(e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/clone/type.mjs
function ke(e, t) {
	return p(t === void 0 ? e : {
		...t,
		...e
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/value/guard/guard.mjs
function Ae(e) {
	return typeof e == "object" && !!e;
}
function je(e) {
	return globalThis.Array.isArray(e) && !globalThis.ArrayBuffer.isView(e);
}
function Me(e) {
	return e === void 0;
}
function Ne(e) {
	return typeof e == "number";
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/system/policy.mjs
var Pe;
(function(e) {
	e.InstanceMode = "default", e.ExactOptionalPropertyTypes = !1, e.AllowArrayObject = !1, e.AllowNaN = !1, e.AllowNullVoid = !1;
	function t(t, n) {
		return e.ExactOptionalPropertyTypes ? n in t : t[n] !== void 0;
	}
	e.IsExactOptionalProperty = t;
	function n(t) {
		let n = Ae(t);
		return e.AllowArrayObject ? n : n && !je(t);
	}
	e.IsObjectLike = n;
	function r(e) {
		return n(e) && !(e instanceof Date) && !(e instanceof Uint8Array);
	}
	e.IsRecordLike = r;
	function i(t) {
		return e.AllowNaN ? Ne(t) : Number.isFinite(t);
	}
	e.IsNumberLike = i;
	function a(t) {
		let n = Me(t);
		return e.AllowNullVoid ? n || t === null : n;
	}
	e.IsVoidLike = a;
})(Pe ||= {});
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/create/immutable.mjs
function Fe(e) {
	return globalThis.Object.freeze(e).map((e) => Be(e));
}
function Ie(e) {
	return e;
}
function Le(e) {
	return e;
}
function Re(e) {
	return e;
}
function ze(e) {
	let t = {};
	for (let n of Object.getOwnPropertyNames(e)) t[n] = Be(e[n]);
	for (let n of Object.getOwnPropertySymbols(e)) t[n] = Be(e[n]);
	return globalThis.Object.freeze(t);
}
function Be(e) {
	return c(e) ? Fe(e) : ge(e) ? Ie(e) : Se(e) ? Le(e) : be(e) ? Re(e) : u(e) ? ze(e) : e;
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/create/type.mjs
function m(e, t) {
	let n = t === void 0 ? e : {
		...t,
		...e
	};
	switch (Pe.InstanceMode) {
		case "freeze": return Be(n);
		case "clone": return p(n);
		default: return n;
	}
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/error/error.mjs
var Ve = class extends Error {
	constructor(e) {
		super(e);
	}
}, h = Symbol.for("TypeBox.Transform"), He = Symbol.for("TypeBox.Readonly"), Ue = Symbol.for("TypeBox.Optional"), We = Symbol.for("TypeBox.Hint"), g = Symbol.for("TypeBox.Kind");
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/guard/kind.mjs
function Ge(e) {
	return u(e) && e[He] === "Readonly";
}
function Ke(e) {
	return u(e) && e[Ue] === "Optional";
}
function qe(e) {
	return v(e, "Any");
}
function Je(e) {
	return v(e, "Argument");
}
function Ye(e) {
	return v(e, "Array");
}
function Xe(e) {
	return v(e, "AsyncIterator");
}
function Ze(e) {
	return v(e, "BigInt");
}
function Qe(e) {
	return v(e, "Boolean");
}
function $e(e) {
	return v(e, "Computed");
}
function et(e) {
	return v(e, "Constructor");
}
function tt(e) {
	return v(e, "Date");
}
function nt(e) {
	return v(e, "Function");
}
function rt(e) {
	return v(e, "Integer");
}
function _(e) {
	return v(e, "Intersect");
}
function it(e) {
	return v(e, "Iterator");
}
function v(e, t) {
	return u(e) && g in e && e[g] === t;
}
function at(e) {
	return he(e) || l(e) || d(e);
}
function ot(e) {
	return v(e, "Literal");
}
function st(e) {
	return v(e, "MappedKey");
}
function y(e) {
	return v(e, "MappedResult");
}
function ct(e) {
	return v(e, "Never");
}
function lt(e) {
	return v(e, "Not");
}
function ut(e) {
	return v(e, "Null");
}
function dt(e) {
	return v(e, "Number");
}
function b(e) {
	return v(e, "Object");
}
function ft(e) {
	return v(e, "Promise");
}
function pt(e) {
	return v(e, "Record");
}
function x(e) {
	return v(e, "Ref");
}
function mt(e) {
	return v(e, "RegExp");
}
function ht(e) {
	return v(e, "String");
}
function gt(e) {
	return v(e, "Symbol");
}
function _t(e) {
	return v(e, "TemplateLiteral");
}
function vt(e) {
	return v(e, "This");
}
function yt(e) {
	return u(e) && h in e;
}
function bt(e) {
	return v(e, "Tuple");
}
function xt(e) {
	return v(e, "Undefined");
}
function S(e) {
	return v(e, "Union");
}
function St(e) {
	return v(e, "Uint8Array");
}
function Ct(e) {
	return v(e, "Unknown");
}
function wt(e) {
	return v(e, "Unsafe");
}
function Tt(e) {
	return v(e, "Void");
}
function Et(e) {
	return u(e) && g in e && d(e[g]);
}
function Dt(e) {
	return qe(e) || Je(e) || Ye(e) || Qe(e) || Ze(e) || Xe(e) || $e(e) || et(e) || tt(e) || nt(e) || rt(e) || _(e) || it(e) || ot(e) || st(e) || y(e) || ct(e) || lt(e) || ut(e) || dt(e) || b(e) || ft(e) || pt(e) || x(e) || mt(e) || ht(e) || gt(e) || _t(e) || vt(e) || bt(e) || xt(e) || S(e) || St(e) || Ct(e) || wt(e) || Tt(e) || Et(e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/guard/type.mjs
var Ot = /* @__PURE__ */ "Argument.Any.Array.AsyncIterator.BigInt.Boolean.Computed.Constructor.Date.Enum.Function.Integer.Intersect.Iterator.Literal.MappedKey.MappedResult.Not.Null.Number.Object.Promise.Record.Ref.RegExp.String.Symbol.TemplateLiteral.This.Tuple.Undefined.Union.Uint8Array.Unknown.Void".split(".");
function kt(e) {
	try {
		return new RegExp(e), !0;
	} catch {
		return !1;
	}
}
function At(e) {
	if (!d(e)) return !1;
	for (let t = 0; t < e.length; t++) {
		let n = e.charCodeAt(t);
		if (n >= 7 && n <= 13 || n === 27 || n === 127) return !1;
	}
	return !0;
}
function jt(e) {
	return Nt(e) || M(e);
}
function Mt(e) {
	return f(e) || me(e);
}
function C(e) {
	return f(e) || l(e);
}
function Nt(e) {
	return f(e) || he(e);
}
function w(e) {
	return f(e) || d(e);
}
function Pt(e) {
	return f(e) || d(e) && At(e) && kt(e);
}
function Ft(e) {
	return f(e) || d(e) && At(e);
}
function It(e) {
	return f(e) || M(e);
}
function Lt(e) {
	return u(e) && e[Ue] === "Optional";
}
function T(e) {
	return E(e, "Any") && w(e.$id);
}
function Rt(e) {
	return E(e, "Argument") && l(e.index);
}
function zt(e) {
	return E(e, "Array") && e.type === "array" && w(e.$id) && M(e.items) && C(e.minItems) && C(e.maxItems) && Nt(e.uniqueItems) && It(e.contains) && C(e.minContains) && C(e.maxContains);
}
function Bt(e) {
	return E(e, "AsyncIterator") && e.type === "AsyncIterator" && w(e.$id) && M(e.items);
}
function Vt(e) {
	return E(e, "BigInt") && e.type === "bigint" && w(e.$id) && Mt(e.exclusiveMaximum) && Mt(e.exclusiveMinimum) && Mt(e.maximum) && Mt(e.minimum) && Mt(e.multipleOf);
}
function Ht(e) {
	return E(e, "Boolean") && e.type === "boolean" && w(e.$id);
}
function Ut(e) {
	return E(e, "Computed") && d(e.target) && c(e.parameters) && e.parameters.every((e) => M(e));
}
function Wt(e) {
	return E(e, "Constructor") && e.type === "Constructor" && w(e.$id) && c(e.parameters) && e.parameters.every((e) => M(e)) && M(e.returns);
}
function Gt(e) {
	return E(e, "Date") && e.type === "Date" && w(e.$id) && C(e.exclusiveMaximumTimestamp) && C(e.exclusiveMinimumTimestamp) && C(e.maximumTimestamp) && C(e.minimumTimestamp) && C(e.multipleOfTimestamp);
}
function Kt(e) {
	return E(e, "Function") && e.type === "Function" && w(e.$id) && c(e.parameters) && e.parameters.every((e) => M(e)) && M(e.returns);
}
function qt(e) {
	return E(e, "Integer") && e.type === "integer" && w(e.$id) && C(e.exclusiveMaximum) && C(e.exclusiveMinimum) && C(e.maximum) && C(e.minimum) && C(e.multipleOf);
}
function Jt(e) {
	return u(e) && Object.entries(e).every(([e, t]) => At(e) && M(t));
}
function Yt(e) {
	return E(e, "Intersect") && !(d(e.type) && e.type !== "object") && c(e.allOf) && e.allOf.every((e) => M(e) && !mn(e)) && w(e.type) && (Nt(e.unevaluatedProperties) || It(e.unevaluatedProperties)) && w(e.$id);
}
function Xt(e) {
	return E(e, "Iterator") && e.type === "Iterator" && w(e.$id) && M(e.items);
}
function E(e, t) {
	return u(e) && g in e && e[g] === t;
}
function Zt(e) {
	return en(e) && d(e.const);
}
function Qt(e) {
	return en(e) && l(e.const);
}
function $t(e) {
	return en(e) && he(e.const);
}
function en(e) {
	return E(e, "Literal") && w(e.$id) && tn(e.const);
}
function tn(e) {
	return he(e) || l(e) || d(e);
}
function nn(e) {
	return E(e, "MappedKey") && c(e.keys) && e.keys.every((e) => l(e) || d(e));
}
function rn(e) {
	return E(e, "MappedResult") && Jt(e.properties);
}
function an(e) {
	return E(e, "Never") && u(e.not) && Object.getOwnPropertyNames(e.not).length === 0;
}
function on(e) {
	return E(e, "Not") && M(e.not);
}
function sn(e) {
	return E(e, "Null") && e.type === "null" && w(e.$id);
}
function D(e) {
	return E(e, "Number") && e.type === "number" && w(e.$id) && C(e.exclusiveMaximum) && C(e.exclusiveMinimum) && C(e.maximum) && C(e.minimum) && C(e.multipleOf);
}
function O(e) {
	return E(e, "Object") && e.type === "object" && w(e.$id) && Jt(e.properties) && jt(e.additionalProperties) && C(e.minProperties) && C(e.maxProperties);
}
function cn(e) {
	return E(e, "Promise") && e.type === "Promise" && w(e.$id) && M(e.item);
}
function k(e) {
	return E(e, "Record") && e.type === "object" && w(e.$id) && jt(e.additionalProperties) && u(e.patternProperties) && ((e) => {
		let t = Object.getOwnPropertyNames(e.patternProperties);
		return t.length === 1 && kt(t[0]) && u(e.patternProperties) && M(e.patternProperties[t[0]]);
	})(e);
}
function ln(e) {
	return E(e, "Ref") && w(e.$id) && d(e.$ref);
}
function un(e) {
	return E(e, "RegExp") && w(e.$id) && d(e.source) && d(e.flags) && C(e.maxLength) && C(e.minLength);
}
function A(e) {
	return E(e, "String") && e.type === "string" && w(e.$id) && C(e.minLength) && C(e.maxLength) && Pt(e.pattern) && Ft(e.format);
}
function dn(e) {
	return E(e, "Symbol") && e.type === "symbol" && w(e.$id);
}
function fn(e) {
	return E(e, "TemplateLiteral") && e.type === "string" && d(e.pattern) && e.pattern[0] === "^" && e.pattern[e.pattern.length - 1] === "$";
}
function pn(e) {
	return E(e, "This") && w(e.$id) && d(e.$ref);
}
function mn(e) {
	return u(e) && h in e;
}
function hn(e) {
	return E(e, "Tuple") && e.type === "array" && w(e.$id) && l(e.minItems) && l(e.maxItems) && e.minItems === e.maxItems && (f(e.items) && f(e.additionalItems) && e.minItems === 0 || c(e.items) && e.items.every((e) => M(e)));
}
function gn(e) {
	return E(e, "Undefined") && e.type === "undefined" && w(e.$id);
}
function _n(e) {
	return E(e, "Union") && w(e.$id) && u(e) && c(e.anyOf) && e.anyOf.every((e) => M(e));
}
function vn(e) {
	return E(e, "Uint8Array") && e.type === "Uint8Array" && w(e.$id) && C(e.minByteLength) && C(e.maxByteLength);
}
function j(e) {
	return E(e, "Unknown") && w(e.$id);
}
function yn(e) {
	return E(e, "Unsafe");
}
function bn(e) {
	return E(e, "Void") && e.type === "void" && w(e.$id);
}
function xn(e) {
	return u(e) && g in e && d(e[g]) && !Ot.includes(e[g]);
}
function M(e) {
	return u(e) && (T(e) || Rt(e) || zt(e) || Ht(e) || Vt(e) || Bt(e) || Ut(e) || Wt(e) || Gt(e) || Kt(e) || qt(e) || Yt(e) || Xt(e) || en(e) || nn(e) || rn(e) || an(e) || on(e) || sn(e) || D(e) || O(e) || cn(e) || k(e) || ln(e) || un(e) || A(e) || dn(e) || fn(e) || pn(e) || hn(e) || gn(e) || _n(e) || vn(e) || j(e) || yn(e) || bn(e) || xn(e));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/patterns/patterns.mjs
var Sn = "(true|false)", Cn = "(0|[1-9][0-9]*)", wn = "(.*)", Tn = "(?!.*)";
`${Sn}`;
var En = `^${Cn}$`, Dn = `^${wn}$`, On = `^${Tn}$`;
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/sets/set.mjs
function kn(e, t) {
	return e.includes(t);
}
function An(e) {
	return [...new Set(e)];
}
function jn(e, t) {
	return e.filter((e) => t.includes(e));
}
function Mn(e, t) {
	return e.reduce((e, t) => jn(e, t), t);
}
function Nn(e) {
	return e.length === 1 ? e[0] : e.length > 1 ? Mn(e.slice(1), e[0]) : [];
}
function Pn(e) {
	let t = [];
	for (let n of e) t.push(...n);
	return t;
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/any/any.mjs
function Fn(e) {
	return m({ [g]: "Any" }, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/array/array.mjs
function In(e, t) {
	return m({
		[g]: "Array",
		type: "array",
		items: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/argument/argument.mjs
function Ln(e) {
	return m({
		[g]: "Argument",
		index: e
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/async-iterator/async-iterator.mjs
function Rn(e, t) {
	return m({
		[g]: "AsyncIterator",
		type: "AsyncIterator",
		items: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/computed/computed.mjs
function N(e, t, n) {
	return m({
		[g]: "Computed",
		target: e,
		parameters: t
	}, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/discard/discard.mjs
function zn(e, t) {
	let { [t]: n, ...r } = e;
	return r;
}
function P(e, t) {
	return t.reduce((e, t) => zn(e, t), e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/never/never.mjs
function F(e) {
	return m({
		[g]: "Never",
		not: {}
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped-result.mjs
function I(e) {
	return m({
		[g]: "MappedResult",
		properties: e
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/constructor/constructor.mjs
function Bn(e, t, n) {
	return m({
		[g]: "Constructor",
		type: "Constructor",
		parameters: e,
		returns: t
	}, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/function/function.mjs
function Vn(e, t, n) {
	return m({
		[g]: "Function",
		type: "Function",
		parameters: e,
		returns: t
	}, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/union/union-create.mjs
function Hn(e, t) {
	return m({
		[g]: "Union",
		anyOf: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/union/union-evaluated.mjs
function Un(e) {
	return e.some((e) => Ke(e));
}
function Wn(e) {
	return e.map((e) => Ke(e) ? Gn(e) : e);
}
function Gn(e) {
	return P(e, [Ue]);
}
function Kn(e, t) {
	return Un(e) ? Oi(Hn(Wn(e), t)) : Hn(Wn(e), t);
}
function qn(e, t) {
	return e.length === 1 ? m(e[0], t) : e.length === 0 ? F(t) : Kn(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/union/union.mjs
function L(e, t) {
	return e.length === 0 ? F(t) : e.length === 1 ? m(e[0], t) : Hn(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/parse.mjs
var Jn = class extends Ve {};
function Yn(e) {
	return e.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function Xn(e, t, n) {
	return e[t] === n && e.charCodeAt(t - 1) !== 92;
}
function Zn(e, t) {
	return Xn(e, t, "(");
}
function Qn(e, t) {
	return Xn(e, t, ")");
}
function $n(e, t) {
	return Xn(e, t, "|");
}
function er(e) {
	if (!(Zn(e, 0) && Qn(e, e.length - 1))) return !1;
	let t = 0;
	for (let n = 0; n < e.length; n++) if (Zn(e, n) && (t += 1), Qn(e, n) && --t, t === 0 && n !== e.length - 1) return !1;
	return !0;
}
function tr(e) {
	return e.slice(1, e.length - 1);
}
function nr(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) if (Zn(e, n) && (t += 1), Qn(e, n) && --t, $n(e, n) && t === 0) return !0;
	return !1;
}
function rr(e) {
	for (let t = 0; t < e.length; t++) if (Zn(e, t)) return !0;
	return !1;
}
function ir(e) {
	let [t, n] = [0, 0], r = [];
	for (let i = 0; i < e.length; i++) if (Zn(e, i) && (t += 1), Qn(e, i) && --t, $n(e, i) && t === 0) {
		let t = e.slice(n, i);
		t.length > 0 && r.push(or(t)), n = i + 1;
	}
	let i = e.slice(n);
	return i.length > 0 && r.push(or(i)), r.length === 0 ? {
		type: "const",
		const: ""
	} : r.length === 1 ? r[0] : {
		type: "or",
		expr: r
	};
}
function ar(e) {
	function t(e, t) {
		if (!Zn(e, t)) throw new Jn("TemplateLiteralParser: Index must point to open parens");
		let n = 0;
		for (let r = t; r < e.length; r++) if (Zn(e, r) && (n += 1), Qn(e, r) && --n, n === 0) return [t, r];
		throw new Jn("TemplateLiteralParser: Unclosed group parens in expression");
	}
	function n(e, t) {
		for (let n = t; n < e.length; n++) if (Zn(e, n)) return [t, n];
		return [t, e.length];
	}
	let r = [];
	for (let i = 0; i < e.length; i++) if (Zn(e, i)) {
		let [n, a] = t(e, i), o = e.slice(n, a + 1);
		r.push(or(o)), i = a;
	} else {
		let [t, a] = n(e, i), o = e.slice(t, a);
		o.length > 0 && r.push(or(o)), i = a - 1;
	}
	return r.length === 0 ? {
		type: "const",
		const: ""
	} : r.length === 1 ? r[0] : {
		type: "and",
		expr: r
	};
}
function or(e) {
	return er(e) ? or(tr(e)) : nr(e) ? ir(e) : rr(e) ? ar(e) : {
		type: "const",
		const: Yn(e)
	};
}
function sr(e) {
	return or(e.slice(1, e.length - 1));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/finite.mjs
var cr = class extends Ve {};
function lr(e) {
	return e.type === "or" && e.expr.length === 2 && e.expr[0].type === "const" && e.expr[0].const === "0" && e.expr[1].type === "const" && e.expr[1].const === "[1-9][0-9]*";
}
function ur(e) {
	return e.type === "or" && e.expr.length === 2 && e.expr[0].type === "const" && e.expr[0].const === "true" && e.expr[1].type === "const" && e.expr[1].const === "false";
}
function dr(e) {
	return e.type === "const" && e.const === ".*";
}
function fr(e) {
	return lr(e) || dr(e) ? !1 : ur(e) ? !0 : e.type === "and" || e.type === "or" ? e.expr.every((e) => fr(e)) : e.type === "const" || (() => {
		throw new cr("Unknown expression type");
	})();
}
function pr(e) {
	return fr(sr(e.pattern));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/generate.mjs
var mr = class extends Ve {};
function* hr(e) {
	if (e.length === 1) return yield* e[0];
	for (let t of e[0]) for (let n of hr(e.slice(1))) yield `${t}${n}`;
}
function* gr(e) {
	return yield* hr(e.expr.map((e) => [...yr(e)]));
}
function* _r(e) {
	for (let t of e.expr) yield* yr(t);
}
function* vr(e) {
	return yield e.const;
}
function* yr(e) {
	return e.type === "and" ? yield* gr(e) : e.type === "or" ? yield* _r(e) : e.type === "const" ? yield* vr(e) : (() => {
		throw new mr("Unknown expression");
	})();
}
function br(e) {
	let t = sr(e.pattern);
	return fr(t) ? [...yr(t)] : [];
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/literal/literal.mjs
function R(e, t) {
	return m({
		[g]: "Literal",
		const: e,
		type: typeof e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/boolean/boolean.mjs
function xr(e) {
	return m({
		[g]: "Boolean",
		type: "boolean"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/bigint/bigint.mjs
function Sr(e) {
	return m({
		[g]: "BigInt",
		type: "bigint"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/number/number.mjs
function Cr(e) {
	return m({
		[g]: "Number",
		type: "number"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/string/string.mjs
function wr(e) {
	return m({
		[g]: "String",
		type: "string"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/syntax.mjs
function* Tr(e) {
	let t = e.trim().replace(/"|'/g, "");
	return t === "boolean" ? yield xr() : t === "number" ? yield Cr() : t === "bigint" ? yield Sr() : t === "string" ? yield wr() : yield (() => {
		let e = t.split("|").map((e) => R(e.trim()));
		return e.length === 0 ? F() : e.length === 1 ? e[0] : qn(e);
	})();
}
function* Er(e) {
	if (e[1] !== "{") return yield* [R("$"), ...Dr(e.slice(1))];
	for (let t = 2; t < e.length; t++) if (e[t] === "}") {
		let n = Tr(e.slice(2, t)), r = Dr(e.slice(t + 1));
		return yield* [...n, ...r];
	}
	yield R(e);
}
function* Dr(e) {
	for (let t = 0; t < e.length; t++) if (e[t] === "$") return yield* [R(e.slice(0, t)), ...Er(e.slice(t))];
	yield R(e);
}
function Or(e) {
	return [...Dr(e)];
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/pattern.mjs
var kr = class extends Ve {};
function Ar(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function jr(e, t) {
	return _t(e) ? e.pattern.slice(1, e.pattern.length - 1) : S(e) ? `(${e.anyOf.map((e) => jr(e, t)).join("|")})` : dt(e) || rt(e) || Ze(e) ? `${t}${Cn}` : ht(e) ? `${t}${wn}` : ot(e) ? `${t}${Ar(e.const.toString())}` : Qe(e) ? `${t}${Sn}` : (() => {
		throw new kr(`Unexpected Kind '${e[g]}'`);
	})();
}
function Mr(e) {
	return `^${e.map((e) => jr(e, "")).join("")}\$`;
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/union.mjs
function Nr(e) {
	return qn(br(e).map((e) => R(e)));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/template-literal/template-literal.mjs
function Pr(e, t) {
	let n = d(e) ? Mr(Or(e)) : Mr(e);
	return m({
		[g]: "TemplateLiteral",
		type: "string",
		pattern: n
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-property-keys.mjs
function Fr(e) {
	return br(e).map((e) => e.toString());
}
function Ir(e) {
	let t = [];
	for (let n of e) t.push(...Rr(n));
	return t;
}
function Lr(e) {
	return [e.toString()];
}
function Rr(e) {
	return [...new Set(_t(e) ? Fr(e) : S(e) ? Ir(e.anyOf) : ot(e) ? Lr(e.const) : dt(e) || rt(e) ? ["[number]"] : [])];
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-result.mjs
function zr(e, t, n) {
	let r = {};
	for (let i of Object.getOwnPropertyNames(t)) r[i] = $r(e, Rr(t[i]), n);
	return r;
}
function Br(e, t, n) {
	return zr(e, t.properties, n);
}
function Vr(e, t, n) {
	return I(Br(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed.mjs
function Hr(e, t) {
	return e.map((e) => Xr(e, t));
}
function Ur(e) {
	return e.filter((e) => !ct(e));
}
function Wr(e, t) {
	return Li(Ur(Hr(e, t)));
}
function Gr(e) {
	return e.some((e) => ct(e)) ? [] : e;
}
function Kr(e, t) {
	return qn(Gr(Hr(e, t)));
}
function qr(e, t) {
	return t in e ? e[t] : t === "[number]" ? qn(e) : F();
}
function Jr(e, t) {
	return t === "[number]" ? e : F();
}
function Yr(e, t) {
	return t in e ? e[t] : F();
}
function Xr(e, t) {
	return _(e) ? Wr(e.allOf, t) : S(e) ? Kr(e.anyOf, t) : bt(e) ? qr(e.items ?? [], t) : Ye(e) ? Jr(e.items, t) : b(e) ? Yr(e.properties, t) : F();
}
function Zr(e, t) {
	return t.map((t) => Xr(e, t));
}
function Qr(e, t) {
	return qn(Zr(e, t));
}
function $r(e, t, n) {
	if (x(e) || x(t)) {
		if (!Dt(e) || !Dt(t)) throw new Ve("Index types using Ref parameters require both Type and Key to be of TSchema");
		return N("Index", [e, t]);
	}
	return y(t) ? Vr(e, t, n) : st(t) ? ri(e, t, n) : m(Dt(t) ? Qr(e, Rr(t)) : Qr(e, t), n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-key.mjs
function ei(e, t, n) {
	return { [t]: $r(e, [t], p(n)) };
}
function ti(e, t, n) {
	return t.reduce((t, r) => ({
		...t,
		...ei(e, r, n)
	}), {});
}
function ni(e, t, n) {
	return ti(e, t.keys, n);
}
function ri(e, t, n) {
	return I(ni(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/iterator/iterator.mjs
function ii(e, t) {
	return m({
		[g]: "Iterator",
		type: "Iterator",
		items: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/object/object.mjs
function ai(e) {
	return globalThis.Object.keys(e).filter((t) => !Ke(e[t]));
}
function oi(e, t) {
	let n = ai(e);
	return m(n.length > 0 ? {
		[g]: "Object",
		type: "object",
		required: n,
		properties: e
	} : {
		[g]: "Object",
		type: "object",
		properties: e
	}, t);
}
var z = oi;
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/promise/promise.mjs
function si(e, t) {
	return m({
		[g]: "Promise",
		type: "Promise",
		item: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly.mjs
function ci(e) {
	return m(P(e, [He]));
}
function li(e) {
	return m({
		...e,
		[He]: "Readonly"
	});
}
function ui(e, t) {
	return t === !1 ? ci(e) : li(e);
}
function di(e, t) {
	let n = t ?? !0;
	return y(e) ? mi(e, n) : ui(e, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly-from-mapped-result.mjs
function fi(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = di(e[r], t);
	return n;
}
function pi(e, t) {
	return fi(e.properties, t);
}
function mi(e, t) {
	return I(pi(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/tuple/tuple.mjs
function hi(e, t) {
	return m(e.length > 0 ? {
		[g]: "Tuple",
		type: "array",
		items: e,
		additionalItems: !1,
		minItems: e.length,
		maxItems: e.length
	} : {
		[g]: "Tuple",
		type: "array",
		minItems: e.length,
		maxItems: e.length
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped.mjs
function gi(e, t) {
	return e in t ? B(e, t[e]) : I(t);
}
function _i(e) {
	return { [e]: R(e) };
}
function vi(e) {
	let t = {};
	for (let n of e) t[n] = R(n);
	return t;
}
function yi(e, t) {
	return kn(t, e) ? _i(e) : vi(t);
}
function bi(e, t) {
	return gi(e, yi(e, t));
}
function xi(e, t) {
	return t.map((t) => B(e, t));
}
function Si(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(t)) n[r] = B(e, t[r]);
	return n;
}
function B(e, t) {
	let n = { ...t };
	return Ke(t) ? Oi(B(e, P(t, [Ue]))) : Ge(t) ? di(B(e, P(t, [He]))) : y(t) ? gi(e, t.properties) : st(t) ? bi(e, t.keys) : et(t) ? Bn(xi(e, t.parameters), B(e, t.returns), n) : nt(t) ? Vn(xi(e, t.parameters), B(e, t.returns), n) : Xe(t) ? Rn(B(e, t.items), n) : it(t) ? ii(B(e, t.items), n) : _(t) ? Ri(xi(e, t.allOf), n) : S(t) ? L(xi(e, t.anyOf), n) : bt(t) ? hi(xi(e, t.items ?? []), n) : b(t) ? z(Si(e, t.properties), n) : Ye(t) ? In(B(e, t.items), n) : ft(t) ? si(B(e, t.item), n) : t;
}
function Ci(e, t) {
	let n = {};
	for (let r of e) n[r] = B(r, t);
	return n;
}
function wi(e, t, n) {
	let r = Dt(e) ? Rr(e) : e;
	return z(Ci(r, t({
		[g]: "MappedKey",
		keys: r
	})), n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/optional/optional.mjs
function Ti(e) {
	return m(P(e, [Ue]));
}
function Ei(e) {
	return m({
		...e,
		[Ue]: "Optional"
	});
}
function Di(e, t) {
	return t === !1 ? Ti(e) : Ei(e);
}
function Oi(e, t) {
	let n = t ?? !0;
	return y(e) ? ji(e, n) : Di(e, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/optional/optional-from-mapped-result.mjs
function ki(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = Oi(e[r], t);
	return n;
}
function Ai(e, t) {
	return ki(e.properties, t);
}
function ji(e, t) {
	return I(Ai(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-create.mjs
function Mi(e, t = {}) {
	let n = e.every((e) => b(e)), r = Dt(t.unevaluatedProperties) ? { unevaluatedProperties: t.unevaluatedProperties } : {};
	return m(t.unevaluatedProperties === !1 || Dt(t.unevaluatedProperties) || n ? {
		...r,
		[g]: "Intersect",
		type: "object",
		allOf: e
	} : {
		...r,
		[g]: "Intersect",
		allOf: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-evaluated.mjs
function Ni(e) {
	return e.every((e) => Ke(e));
}
function Pi(e) {
	return P(e, [Ue]);
}
function Fi(e) {
	return e.map((e) => Ke(e) ? Pi(e) : e);
}
function Ii(e, t) {
	return Ni(e) ? Oi(Mi(Fi(e), t)) : Mi(Fi(e), t);
}
function Li(e, t = {}) {
	if (e.length === 1) return m(e[0], t);
	if (e.length === 0) return F(t);
	if (e.some((e) => yt(e))) throw Error("Cannot intersect transform types");
	return Ii(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect.mjs
function Ri(e, t) {
	if (e.length === 1) return m(e[0], t);
	if (e.length === 0) return F(t);
	if (e.some((e) => yt(e))) throw Error("Cannot intersect transform types");
	return Mi(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/ref/ref.mjs
function zi(...e) {
	let [t, n] = typeof e[0] == "string" ? [e[0], e[1]] : [e[0].$id, e[1]];
	if (typeof t != "string") throw new Ve("Ref: $ref must be a string");
	return m({
		[g]: "Ref",
		$ref: t
	}, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/awaited/awaited.mjs
function Bi(e, t) {
	return N("Awaited", [N(e, t)]);
}
function Vi(e) {
	return N("Awaited", [zi(e)]);
}
function Hi(e) {
	return Ri(Gi(e));
}
function Ui(e) {
	return L(Gi(e));
}
function Wi(e) {
	return Ki(e);
}
function Gi(e) {
	return e.map((e) => Ki(e));
}
function Ki(e, t) {
	return m($e(e) ? Bi(e.target, e.parameters) : _(e) ? Hi(e.allOf) : S(e) ? Ui(e.anyOf) : ft(e) ? Wi(e.item) : x(e) ? Vi(e.$ref) : e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-keys.mjs
function qi(e) {
	let t = [];
	for (let n of e) t.push(ea(n));
	return t;
}
function Ji(e) {
	return Pn(qi(e));
}
function Yi(e) {
	return Nn(qi(e));
}
function Xi(e) {
	return e.map((e, t) => t.toString());
}
function Zi(e) {
	return ["[number]"];
}
function Qi(e) {
	return globalThis.Object.getOwnPropertyNames(e);
}
function $i(e) {
	return ta ? globalThis.Object.getOwnPropertyNames(e).map((e) => e[0] === "^" && e[e.length - 1] === "$" ? e.slice(1, e.length - 1) : e) : [];
}
function ea(e) {
	return _(e) ? Ji(e.allOf) : S(e) ? Yi(e.anyOf) : bt(e) ? Xi(e.items ?? []) : Ye(e) ? Zi(e.items) : b(e) ? Qi(e.properties) : pt(e) ? $i(e.patternProperties) : [];
}
var ta = !1;
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof.mjs
function na(e, t) {
	return N("KeyOf", [N(e, t)]);
}
function ra(e) {
	return N("KeyOf", [zi(e)]);
}
function ia(e, t) {
	return m(qn(aa(ea(e))), t);
}
function aa(e) {
	return e.map((e) => e === "[number]" ? Cr() : R(e));
}
function oa(e, t) {
	return $e(e) ? na(e.target, e.parameters) : x(e) ? ra(e.$ref) : y(e) ? la(e, t) : ia(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-from-mapped-result.mjs
function sa(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = oa(e[r], p(t));
	return n;
}
function ca(e, t) {
	return sa(e.properties, t);
}
function la(e, t) {
	return I(ca(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/composite/composite.mjs
function ua(e) {
	let t = [];
	for (let n of e) t.push(...ea(n));
	return An(t);
}
function da(e) {
	return e.filter((e) => !ct(e));
}
function fa(e, t) {
	let n = [];
	for (let r of e) n.push(...Zr(r, [t]));
	return da(n);
}
function pa(e, t) {
	let n = {};
	for (let r of t) n[r] = Li(fa(e, r));
	return n;
}
function ma(e, t) {
	return z(pa(e, ua(e)), t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/date/date.mjs
function ha(e) {
	return m({
		[g]: "Date",
		type: "Date"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/null/null.mjs
function ga(e) {
	return m({
		[g]: "Null",
		type: "null"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/symbol/symbol.mjs
function _a(e) {
	return m({
		[g]: "Symbol",
		type: "symbol"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/undefined/undefined.mjs
function va(e) {
	return m({
		[g]: "Undefined",
		type: "undefined"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/uint8array/uint8array.mjs
function ya(e) {
	return m({
		[g]: "Uint8Array",
		type: "Uint8Array"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/unknown/unknown.mjs
function ba(e) {
	return m({ [g]: "Unknown" }, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/const/const.mjs
function xa(e) {
	return e.map((e) => wa(e, !1));
}
function Sa(e) {
	let t = {};
	for (let n of globalThis.Object.getOwnPropertyNames(e)) t[n] = di(wa(e[n], !1));
	return t;
}
function Ca(e, t) {
	return t === !0 ? e : di(e);
}
function wa(e, t) {
	return pe(e) || ve(e) ? Ca(Fn(), t) : c(e) ? di(hi(xa(e))) : Se(e) ? ya() : ge(e) ? ha() : u(e) ? Ca(z(Sa(e)), t) : _e(e) ? Ca(Vn([], ba()), t) : f(e) ? va() : ye(e) ? ga() : xe(e) ? _a() : me(e) ? Sr() : l(e) || he(e) || d(e) ? R(e) : z({});
}
function Ta(e, t) {
	return m(wa(e, !0), t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/constructor-parameters/constructor-parameters.mjs
function Ea(e, t) {
	return et(e) ? hi(e.parameters, t) : F(t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/enum/enum.mjs
function Da(e, t) {
	if (f(e)) throw Error("Enum undefined or empty");
	let n = globalThis.Object.getOwnPropertyNames(e).filter((e) => isNaN(e)).map((t) => e[t]);
	return L([...new Set(n)].map((e) => R(e)), {
		...t,
		[We]: "Enum"
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extends/extends-check.mjs
var Oa = class extends Ve {}, V;
(function(e) {
	e[e.Union = 0] = "Union", e[e.True = 1] = "True", e[e.False = 2] = "False";
})(V ||= {});
function H(e) {
	return e === V.False ? e : V.True;
}
function ka(e) {
	throw new Oa(e);
}
function U(e) {
	return an(e) || Yt(e) || _n(e) || j(e) || T(e);
}
function W(e, t) {
	return an(t) ? qa(e, t) : Yt(t) ? Ua(e, t) : _n(t) ? Oo(e, t) : j(t) ? Ao(e, t) : T(t) ? Aa(e, t) : ka("StructuralRight");
}
function Aa(e, t) {
	return V.True;
}
function ja(e, t) {
	return Yt(t) ? Ua(e, t) : _n(t) && t.anyOf.some((e) => T(e) || j(e)) ? V.True : _n(t) ? V.Union : j(t) || T(t) ? V.True : V.Union;
}
function Ma(e, t) {
	return j(e) ? V.False : T(e) ? V.Union : an(e) ? V.True : V.False;
}
function Na(e, t) {
	return O(t) && lo(t) ? V.True : U(t) ? W(e, t) : zt(t) ? H(J(e.items, t.items)) : V.False;
}
function Pa(e, t) {
	return U(t) ? W(e, t) : Bt(t) ? H(J(e.items, t.items)) : V.False;
}
function Fa(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : Vt(t) ? V.True : V.False;
}
function Ia(e, t) {
	return $t(e) || Ht(e) ? V.True : V.False;
}
function La(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : Ht(t) ? V.True : V.False;
}
function Ra(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : Wt(t) ? e.parameters.length > t.parameters.length ? V.False : e.parameters.every((e, n) => H(J(t.parameters[n], e)) === V.True) ? H(J(e.returns, t.returns)) : V.False : V.False;
}
function za(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : Gt(t) ? V.True : V.False;
}
function Ba(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : Kt(t) ? e.parameters.length > t.parameters.length ? V.False : e.parameters.every((e, n) => H(J(t.parameters[n], e)) === V.True) ? H(J(e.returns, t.returns)) : V.False : V.False;
}
function Va(e, t) {
	return en(e) && l(e.const) || D(e) || qt(e) ? V.True : V.False;
}
function Ha(e, t) {
	return qt(t) || D(t) ? V.True : U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : V.False;
}
function Ua(e, t) {
	return t.allOf.every((t) => J(e, t) === V.True) ? V.True : V.False;
}
function Wa(e, t) {
	return e.allOf.some((e) => J(e, t) === V.True) ? V.True : V.False;
}
function Ga(e, t) {
	return U(t) ? W(e, t) : Xt(t) ? H(J(e.items, t.items)) : V.False;
}
function Ka(e, t) {
	return en(t) && t.const === e.const ? V.True : U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : A(t) ? yo(e, t) : D(t) ? Qa(e, t) : qt(t) ? Va(e, t) : Ht(t) ? Ia(e, t) : V.False;
}
function qa(e, t) {
	return V.False;
}
function Ja(e, t) {
	return V.True;
}
function Ya(e) {
	let [t, n] = [e, 0];
	for (; on(t);) t = t.not, n += 1;
	return n % 2 == 0 ? t : ba();
}
function Xa(e, t) {
	return on(e) ? J(Ya(e), t) : on(t) ? J(e, Ya(t)) : ka("Invalid fallthrough for Not");
}
function Za(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : sn(t) ? V.True : V.False;
}
function Qa(e, t) {
	return Qt(e) || D(e) || qt(e) ? V.True : V.False;
}
function $a(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : qt(t) || D(t) ? V.True : V.False;
}
function G(e, t) {
	return Object.getOwnPropertyNames(e.properties).length === t;
}
function eo(e) {
	return lo(e);
}
function to(e) {
	return G(e, 0) || G(e, 1) && "description" in e.properties && _n(e.properties.description) && e.properties.description.anyOf.length === 2 && (A(e.properties.description.anyOf[0]) && gn(e.properties.description.anyOf[1]) || A(e.properties.description.anyOf[1]) && gn(e.properties.description.anyOf[0]));
}
function no(e) {
	return G(e, 0);
}
function ro(e) {
	return G(e, 0);
}
function io(e) {
	return G(e, 0);
}
function ao(e) {
	return G(e, 0);
}
function oo(e) {
	return lo(e);
}
function so(e) {
	let t = Cr();
	return G(e, 0) || G(e, 1) && "length" in e.properties && H(J(e.properties.length, t)) === V.True;
}
function co(e) {
	return G(e, 0);
}
function lo(e) {
	let t = Cr();
	return G(e, 0) || G(e, 1) && "length" in e.properties && H(J(e.properties.length, t)) === V.True;
}
function uo(e) {
	let t = Vn([Fn()], Fn());
	return G(e, 0) || G(e, 1) && "then" in e.properties && H(J(e.properties.then, t)) === V.True;
}
function fo(e, t) {
	return J(e, t) === V.False || Lt(e) && !Lt(t) ? V.False : V.True;
}
function K(e, t) {
	return j(e) ? V.False : T(e) ? V.Union : an(e) || Zt(e) && eo(t) || Qt(e) && no(t) || $t(e) && ro(t) || dn(e) && to(t) || Vt(e) && io(t) || A(e) && eo(t) || dn(e) && to(t) || D(e) && no(t) || qt(e) && no(t) || Ht(e) && ro(t) || vn(e) && oo(t) || Gt(e) && ao(t) || Wt(e) && co(t) || Kt(e) && so(t) ? V.True : k(e) && A(ho(e)) ? t[We] === "Record" ? V.True : V.False : k(e) && D(ho(e)) && G(t, 0) ? V.True : V.False;
}
function po(e, t) {
	return U(t) ? W(e, t) : k(t) ? q(e, t) : O(t) ? (() => {
		for (let n of Object.getOwnPropertyNames(t.properties)) {
			if (!(n in e.properties) && !Lt(t.properties[n])) return V.False;
			if (Lt(t.properties[n])) return V.True;
			if (fo(e.properties[n], t.properties[n]) === V.False) return V.False;
		}
		return V.True;
	})() : V.False;
}
function mo(e, t) {
	return U(t) ? W(e, t) : O(t) && uo(t) ? V.True : cn(t) ? H(J(e.item, t.item)) : V.False;
}
function ho(e) {
	return En in e.patternProperties ? Cr() : Dn in e.patternProperties ? wr() : ka("Unknown record key pattern");
}
function go(e) {
	return En in e.patternProperties ? e.patternProperties[En] : Dn in e.patternProperties ? e.patternProperties[Dn] : ka("Unable to get record value schema");
}
function q(e, t) {
	let [n, r] = [ho(t), go(t)];
	return Zt(e) && D(n) && H(J(e, r)) === V.True ? V.True : vn(e) && D(n) || A(e) && D(n) || zt(e) && D(n) ? J(e, r) : O(e) ? (() => {
		for (let t of Object.getOwnPropertyNames(e.properties)) if (fo(r, e.properties[t]) === V.False) return V.False;
		return V.True;
	})() : V.False;
}
function _o(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? J(go(e), go(t)) : V.False;
}
function vo(e, t) {
	return J(un(e) ? wr() : e, un(t) ? wr() : t);
}
function yo(e, t) {
	return en(e) && d(e.const) || A(e) ? V.True : V.False;
}
function bo(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : A(t) ? V.True : V.False;
}
function xo(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : dn(t) ? V.True : V.False;
}
function So(e, t) {
	return fn(e) ? J(Nr(e), t) : fn(t) ? J(e, Nr(t)) : ka("Invalid fallthrough for TemplateLiteral");
}
function Co(e, t) {
	return zt(t) && e.items !== void 0 && e.items.every((e) => J(e, t.items) === V.True);
}
function wo(e, t) {
	return an(e) ? V.True : j(e) ? V.False : T(e) ? V.Union : V.False;
}
function To(e, t) {
	return U(t) ? W(e, t) : O(t) && lo(t) || zt(t) && Co(e, t) ? V.True : hn(t) ? f(e.items) && !f(t.items) || !f(e.items) && f(t.items) ? V.False : f(e.items) && !f(t.items) || e.items.every((e, n) => J(e, t.items[n]) === V.True) ? V.True : V.False : V.False;
}
function Eo(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : vn(t) ? V.True : V.False;
}
function Do(e, t) {
	return U(t) ? W(e, t) : O(t) ? K(e, t) : k(t) ? q(e, t) : bn(t) ? Mo(e, t) : gn(t) ? V.True : V.False;
}
function Oo(e, t) {
	return t.anyOf.some((t) => J(e, t) === V.True) ? V.True : V.False;
}
function ko(e, t) {
	return e.anyOf.every((e) => J(e, t) === V.True) ? V.True : V.False;
}
function Ao(e, t) {
	return V.True;
}
function jo(e, t) {
	return an(t) ? qa(e, t) : Yt(t) ? Ua(e, t) : _n(t) ? Oo(e, t) : T(t) ? Aa(e, t) : A(t) ? yo(e, t) : D(t) ? Qa(e, t) : qt(t) ? Va(e, t) : Ht(t) ? Ia(e, t) : zt(t) ? Ma(e, t) : hn(t) ? wo(e, t) : O(t) ? K(e, t) : j(t) ? V.True : V.False;
}
function Mo(e, t) {
	return gn(e) || gn(e) ? V.True : V.False;
}
function No(e, t) {
	return Yt(t) ? Ua(e, t) : _n(t) ? Oo(e, t) : j(t) ? Ao(e, t) : T(t) ? Aa(e, t) : O(t) ? K(e, t) : bn(t) ? V.True : V.False;
}
function J(e, t) {
	return fn(e) || fn(t) ? So(e, t) : un(e) || un(t) ? vo(e, t) : on(e) || on(t) ? Xa(e, t) : T(e) ? ja(e, t) : zt(e) ? Na(e, t) : Vt(e) ? Fa(e, t) : Ht(e) ? La(e, t) : Bt(e) ? Pa(e, t) : Wt(e) ? Ra(e, t) : Gt(e) ? za(e, t) : Kt(e) ? Ba(e, t) : qt(e) ? Ha(e, t) : Yt(e) ? Wa(e, t) : Xt(e) ? Ga(e, t) : en(e) ? Ka(e, t) : an(e) ? Ja(e, t) : sn(e) ? Za(e, t) : D(e) ? $a(e, t) : O(e) ? po(e, t) : k(e) ? _o(e, t) : A(e) ? bo(e, t) : dn(e) ? xo(e, t) : hn(e) ? To(e, t) : cn(e) ? mo(e, t) : vn(e) ? Eo(e, t) : gn(e) ? Do(e, t) : _n(e) ? ko(e, t) : j(e) ? jo(e, t) : bn(e) ? No(e, t) : ka(`Unknown left type operand '${e[g]}'`);
}
function Po(e, t) {
	return J(e, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-result.mjs
function Fo(e, t, n, r, i) {
	let a = {};
	for (let o of globalThis.Object.getOwnPropertyNames(e)) a[o] = zo(e[o], t, n, r, p(i));
	return a;
}
function Io(e, t, n, r, i) {
	return Fo(e.properties, t, n, r, i);
}
function Lo(e, t, n, r, i) {
	return I(Io(e, t, n, r, i));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extends/extends.mjs
function Ro(e, t, n, r) {
	let i = Po(e, t);
	return i === V.Union ? L([n, r]) : i === V.True ? n : r;
}
function zo(e, t, n, r, i) {
	return y(e) ? Lo(e, t, n, r, i) : st(e) ? m(Uo(e, t, n, r, i)) : m(Ro(e, t, n, r), i);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-key.mjs
function Bo(e, t, n, r, i) {
	return { [e]: zo(R(e), t, n, r, p(i)) };
}
function Vo(e, t, n, r, i) {
	return e.reduce((e, a) => ({
		...e,
		...Bo(a, t, n, r, i)
	}), {});
}
function Ho(e, t, n, r, i) {
	return Vo(e.keys, t, n, r, i);
}
function Uo(e, t, n, r, i) {
	return I(Ho(e, t, n, r, i));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-template-literal.mjs
function Wo(e, t) {
	return Ko(Nr(e), t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude.mjs
function Go(e, t) {
	let n = e.filter((e) => Po(e, t) === V.False);
	return n.length === 1 ? n[0] : L(n);
}
function Ko(e, t, n = {}) {
	return _t(e) ? m(Wo(e, t), n) : y(e) ? m(Yo(e, t), n) : m(S(e) ? Go(e.anyOf, t) : Po(e, t) === V.False ? e : F(), n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-mapped-result.mjs
function qo(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = Ko(e[r], t);
	return n;
}
function Jo(e, t) {
	return qo(e.properties, t);
}
function Yo(e, t) {
	return I(Jo(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-template-literal.mjs
function Xo(e, t) {
	return Qo(Nr(e), t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extract/extract.mjs
function Zo(e, t) {
	let n = e.filter((e) => Po(e, t) !== V.False);
	return n.length === 1 ? n[0] : L(n);
}
function Qo(e, t, n) {
	return _t(e) ? m(Xo(e, t), n) : y(e) ? m(ts(e, t), n) : m(S(e) ? Zo(e.anyOf, t) : Po(e, t) === V.False ? F() : e, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-mapped-result.mjs
function $o(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = Qo(e[r], t);
	return n;
}
function es(e, t) {
	return $o(e.properties, t);
}
function ts(e, t) {
	return I(es(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/instance-type/instance-type.mjs
function ns(e, t) {
	return et(e) ? m(e.returns, t) : F(t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/readonly-optional/readonly-optional.mjs
function rs(e) {
	return di(Oi(e));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/record/record.mjs
function is(e, t, n) {
	return m({
		[g]: "Record",
		type: "object",
		patternProperties: { [e]: t }
	}, n);
}
function as(e, t, n) {
	let r = {};
	for (let n of e) r[n] = t;
	return z(r, {
		...n,
		[We]: "Record"
	});
}
function os(e, t, n) {
	return pr(e) ? as(Rr(e), t, n) : is(e.pattern, t, n);
}
function ss(e, t, n) {
	return as(Rr(L(e)), t, n);
}
function cs(e, t, n) {
	return as([e.toString()], t, n);
}
function ls(e, t, n) {
	return is(e.source, t, n);
}
function us(e, t, n) {
	return is(f(e.pattern) ? Dn : e.pattern, t, n);
}
function ds(e, t, n) {
	return is(Dn, t, n);
}
function fs(e, t, n) {
	return is(On, t, n);
}
function ps(e, t, n) {
	return z({
		true: t,
		false: t
	}, n);
}
function ms(e, t, n) {
	return is(En, t, n);
}
function hs(e, t, n) {
	return is(En, t, n);
}
function gs(e, t, n = {}) {
	return S(e) ? ss(e.anyOf, t, n) : _t(e) ? os(e, t, n) : ot(e) ? cs(e.const, t, n) : Qe(e) ? ps(e, t, n) : rt(e) ? ms(e, t, n) : dt(e) ? hs(e, t, n) : mt(e) ? ls(e, t, n) : ht(e) ? us(e, t, n) : qe(e) ? ds(e, t, n) : ct(e) ? fs(e, t, n) : F(n);
}
function _s(e) {
	return globalThis.Object.getOwnPropertyNames(e.patternProperties)[0];
}
function vs(e) {
	let t = _s(e);
	return t === Dn ? wr() : t === En ? Cr() : wr({ pattern: t });
}
function ys(e) {
	return e.patternProperties[_s(e)];
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/instantiate/instantiate.mjs
function bs(e, t) {
	return t.parameters = Ps(e, t.parameters), t.returns = Y(e, t.returns), t;
}
function xs(e, t) {
	return t.parameters = Ps(e, t.parameters), t.returns = Y(e, t.returns), t;
}
function Ss(e, t) {
	return t.allOf = Ps(e, t.allOf), t;
}
function Cs(e, t) {
	return t.anyOf = Ps(e, t.anyOf), t;
}
function ws(e, t) {
	return f(t.items) || (t.items = Ps(e, t.items)), t;
}
function Ts(e, t) {
	return t.items = Y(e, t.items), t;
}
function Es(e, t) {
	return t.items = Y(e, t.items), t;
}
function Ds(e, t) {
	return t.items = Y(e, t.items), t;
}
function Os(e, t) {
	return t.item = Y(e, t.item), t;
}
function ks(e, t) {
	let n = Ns(e, t.properties);
	return {
		...t,
		...z(n)
	};
}
function As(e, t) {
	let n = gs(Y(e, vs(t)), Y(e, ys(t)));
	return {
		...t,
		...n
	};
}
function js(e, t) {
	return t.index in e ? e[t.index] : ba();
}
function Ms(e, t) {
	let n = Ge(t), r = Ke(t), i = Y(e, t);
	return n && r ? rs(i) : n && !r ? di(i) : !n && r ? Oi(i) : i;
}
function Ns(e, t) {
	return globalThis.Object.getOwnPropertyNames(t).reduce((n, r) => ({
		...n,
		[r]: Ms(e, t[r])
	}), {});
}
function Ps(e, t) {
	return t.map((t) => Y(e, t));
}
function Y(e, t) {
	return et(t) ? bs(e, t) : nt(t) ? xs(e, t) : _(t) ? Ss(e, t) : S(t) ? Cs(e, t) : bt(t) ? ws(e, t) : Ye(t) ? Ts(e, t) : Xe(t) ? Es(e, t) : it(t) ? Ds(e, t) : ft(t) ? Os(e, t) : b(t) ? ks(e, t) : pt(t) ? As(e, t) : Je(t) ? js(e, t) : t;
}
function Fs(e, t) {
	return Y(t, ke(e));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/integer/integer.mjs
function Is(e) {
	return m({
		[g]: "Integer",
		type: "integer"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic-from-mapped-key.mjs
function Ls(e, t, n) {
	return { [e]: Js(R(e), t, p(n)) };
}
function Rs(e, t, n) {
	return e.reduce((e, r) => ({
		...e,
		...Ls(r, t, n)
	}), {});
}
function zs(e, t, n) {
	return Rs(e.keys, t, n);
}
function Bs(e, t, n) {
	return I(zs(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic.mjs
function Vs(e) {
	let [t, n] = [e.slice(0, 1), e.slice(1)];
	return [t.toLowerCase(), n].join("");
}
function Hs(e) {
	let [t, n] = [e.slice(0, 1), e.slice(1)];
	return [t.toUpperCase(), n].join("");
}
function Us(e) {
	return e.toUpperCase();
}
function Ws(e) {
	return e.toLowerCase();
}
function Gs(e, t, n) {
	let r = sr(e.pattern);
	return fr(r) ? Pr([L(qs([...yr(r)].map((e) => R(e)), t))], n) : {
		...e,
		pattern: Ks(e.pattern, t)
	};
}
function Ks(e, t) {
	return typeof e == "string" ? t === "Uncapitalize" ? Vs(e) : t === "Capitalize" ? Hs(e) : t === "Uppercase" ? Us(e) : t === "Lowercase" ? Ws(e) : e : e.toString();
}
function qs(e, t) {
	return e.map((e) => Js(e, t));
}
function Js(e, t, n = {}) {
	return st(e) ? Bs(e, t, n) : _t(e) ? Gs(e, t, n) : S(e) ? L(qs(e.anyOf, t), n) : ot(e) ? R(Ks(e.const, t), n) : m(e, n);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/capitalize.mjs
function Ys(e, t = {}) {
	return Js(e, "Capitalize", t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/lowercase.mjs
function Xs(e, t = {}) {
	return Js(e, "Lowercase", t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uncapitalize.mjs
function Zs(e, t = {}) {
	return Js(e, "Uncapitalize", t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uppercase.mjs
function Qs(e, t = {}) {
	return Js(e, "Uppercase", t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-result.mjs
function $s(e, t, n) {
	let r = {};
	for (let i of globalThis.Object.getOwnPropertyNames(e)) r[i] = lc(e[i], t, p(n));
	return r;
}
function ec(e, t, n) {
	return $s(e.properties, t, n);
}
function tc(e, t, n) {
	return I(ec(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/omit/omit.mjs
function nc(e, t) {
	return e.map((e) => cc(e, t));
}
function rc(e, t) {
	return e.map((e) => cc(e, t));
}
function ic(e, t) {
	let { [t]: n, ...r } = e;
	return r;
}
function ac(e, t) {
	return t.reduce((e, t) => ic(e, t), e);
}
function oc(e, t, n) {
	let r = P(e, [
		h,
		"$id",
		"required",
		"properties"
	]);
	return z(ac(n, t), r);
}
function sc(e) {
	return L(e.reduce((e, t) => at(t) ? [...e, R(t)] : e, []));
}
function cc(e, t) {
	return _(e) ? Ri(nc(e.allOf, t)) : S(e) ? L(rc(e.anyOf, t)) : b(e) ? oc(e, t, e.properties) : z({});
}
function lc(e, t, n) {
	let r = c(t) ? sc(t) : t, i = Dt(t) ? Rr(t) : t, a = x(e), o = x(t);
	return y(e) ? tc(e, i, n) : st(t) ? pc(e, t, n) : a && o || !a && o || a && !o ? N("Omit", [e, r], n) : m({
		...cc(e, i),
		...n
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-key.mjs
function uc(e, t, n) {
	return { [t]: lc(e, [t], p(n)) };
}
function dc(e, t, n) {
	return t.reduce((t, r) => ({
		...t,
		...uc(e, r, n)
	}), {});
}
function fc(e, t, n) {
	return dc(e, t.keys, n);
}
function pc(e, t, n) {
	return I(fc(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-result.mjs
function mc(e, t, n) {
	let r = {};
	for (let i of globalThis.Object.getOwnPropertyNames(e)) r[i] = Cc(e[i], t, p(n));
	return r;
}
function hc(e, t, n) {
	return mc(e.properties, t, n);
}
function gc(e, t, n) {
	return I(hc(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/pick/pick.mjs
function _c(e, t) {
	return e.map((e) => Sc(e, t));
}
function vc(e, t) {
	return e.map((e) => Sc(e, t));
}
function yc(e, t) {
	let n = {};
	for (let r of t) r in e && (n[r] = e[r]);
	return n;
}
function bc(e, t, n) {
	let r = P(e, [
		h,
		"$id",
		"required",
		"properties"
	]);
	return z(yc(n, t), r);
}
function xc(e) {
	return L(e.reduce((e, t) => at(t) ? [...e, R(t)] : e, []));
}
function Sc(e, t) {
	return _(e) ? Ri(_c(e.allOf, t)) : S(e) ? L(vc(e.anyOf, t)) : b(e) ? bc(e, t, e.properties) : z({});
}
function Cc(e, t, n) {
	let r = c(t) ? xc(t) : t, i = Dt(t) ? Rr(t) : t, a = x(e), o = x(t);
	return y(e) ? gc(e, i, n) : st(t) ? Dc(e, t, n) : a && o || !a && o || a && !o ? N("Pick", [e, r], n) : m({
		...Sc(e, i),
		...n
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-key.mjs
function wc(e, t, n) {
	return { [t]: Cc(e, [t], p(n)) };
}
function Tc(e, t, n) {
	return t.reduce((t, r) => ({
		...t,
		...wc(e, r, n)
	}), {});
}
function Ec(e, t, n) {
	return Tc(e, t.keys, n);
}
function Dc(e, t, n) {
	return I(Ec(e, t, n));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/partial/partial.mjs
function Oc(e, t) {
	return N("Partial", [N(e, t)]);
}
function kc(e) {
	return N("Partial", [zi(e)]);
}
function Ac(e) {
	let t = {};
	for (let n of globalThis.Object.getOwnPropertyNames(e)) t[n] = Oi(e[n]);
	return t;
}
function jc(e, t) {
	let n = P(e, [
		h,
		"$id",
		"required",
		"properties"
	]);
	return z(Ac(t), n);
}
function Mc(e) {
	return e.map((e) => Nc(e));
}
function Nc(e) {
	return $e(e) ? Oc(e.target, e.parameters) : x(e) ? kc(e.$ref) : _(e) ? Ri(Mc(e.allOf)) : S(e) ? L(Mc(e.anyOf)) : b(e) ? jc(e, e.properties) : Ze(e) || Qe(e) || rt(e) || ot(e) || ut(e) || dt(e) || ht(e) || gt(e) || xt(e) ? e : z({});
}
function Pc(e, t) {
	return y(e) ? Lc(e, t) : m({
		...Nc(e),
		...t
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/partial/partial-from-mapped-result.mjs
function Fc(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = Pc(e[r], p(t));
	return n;
}
function Ic(e, t) {
	return Fc(e.properties, t);
}
function Lc(e, t) {
	return I(Ic(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/required/required.mjs
function Rc(e, t) {
	return N("Required", [N(e, t)]);
}
function zc(e) {
	return N("Required", [zi(e)]);
}
function Bc(e) {
	let t = {};
	for (let n of globalThis.Object.getOwnPropertyNames(e)) t[n] = P(e[n], [Ue]);
	return t;
}
function Vc(e, t) {
	let n = P(e, [
		h,
		"$id",
		"required",
		"properties"
	]);
	return z(Bc(t), n);
}
function Hc(e) {
	return e.map((e) => Uc(e));
}
function Uc(e) {
	return $e(e) ? Rc(e.target, e.parameters) : x(e) ? zc(e.$ref) : _(e) ? Ri(Hc(e.allOf)) : S(e) ? L(Hc(e.anyOf)) : b(e) ? Vc(e, e.properties) : Ze(e) || Qe(e) || rt(e) || ot(e) || ut(e) || dt(e) || ht(e) || gt(e) || xt(e) ? e : z({});
}
function Wc(e, t) {
	return y(e) ? qc(e, t) : m({
		...Uc(e),
		...t
	});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/required/required-from-mapped-result.mjs
function Gc(e, t) {
	let n = {};
	for (let r of globalThis.Object.getOwnPropertyNames(e)) n[r] = Wc(e[r], t);
	return n;
}
function Kc(e, t) {
	return Gc(e.properties, t);
}
function qc(e, t) {
	return I(Kc(e, t));
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/module/compute.mjs
function Jc(e, t) {
	return t.map((t) => x(t) ? Yc(e, t.$ref) : X(e, t));
}
function Yc(e, t) {
	return t in e ? x(e[t]) ? Yc(e, e[t].$ref) : X(e, e[t]) : F();
}
function Xc(e) {
	return Ki(e[0]);
}
function Zc(e) {
	return $r(e[0], e[1]);
}
function Qc(e) {
	return oa(e[0]);
}
function $c(e) {
	return Pc(e[0]);
}
function el(e) {
	return lc(e[0], e[1]);
}
function tl(e) {
	return Cc(e[0], e[1]);
}
function nl(e) {
	return Wc(e[0]);
}
function rl(e, t, n) {
	let r = Jc(e, n);
	return t === "Awaited" ? Xc(r) : t === "Index" ? Zc(r) : t === "KeyOf" ? Qc(r) : t === "Partial" ? $c(r) : t === "Omit" ? el(r) : t === "Pick" ? tl(r) : t === "Required" ? nl(r) : F();
}
function il(e, t) {
	return In(X(e, t));
}
function al(e, t) {
	return Rn(X(e, t));
}
function ol(e, t, n) {
	return Bn(hl(e, t), X(e, n));
}
function sl(e, t, n) {
	return Vn(hl(e, t), X(e, n));
}
function cl(e, t) {
	return Ri(hl(e, t));
}
function ll(e, t) {
	return ii(X(e, t));
}
function ul(e, t) {
	return z(globalThis.Object.keys(t).reduce((n, r) => ({
		...n,
		[r]: X(e, t[r])
	}), {}));
}
function dl(e, t) {
	let [n, r] = [X(e, ys(t)), _s(t)], i = ke(t);
	return i.patternProperties[r] = n, i;
}
function fl(e, t) {
	return x(t) ? {
		...Yc(e, t.$ref),
		[h]: t[h]
	} : t;
}
function pl(e, t) {
	return hi(hl(e, t));
}
function ml(e, t) {
	return L(hl(e, t));
}
function hl(e, t) {
	return t.map((t) => X(e, t));
}
function X(e, t) {
	return Ke(t) ? m(X(e, P(t, [Ue])), t) : Ge(t) ? m(X(e, P(t, [He])), t) : yt(t) ? m(fl(e, t), t) : Ye(t) ? m(il(e, t.items), t) : Xe(t) ? m(al(e, t.items), t) : $e(t) ? m(rl(e, t.target, t.parameters)) : et(t) ? m(ol(e, t.parameters, t.returns), t) : nt(t) ? m(sl(e, t.parameters, t.returns), t) : _(t) ? m(cl(e, t.allOf), t) : it(t) ? m(ll(e, t.items), t) : b(t) ? m(ul(e, t.properties), t) : pt(t) ? m(dl(e, t)) : bt(t) ? m(pl(e, t.items || []), t) : S(t) ? m(ml(e, t.anyOf), t) : t;
}
function gl(e, t) {
	return t in e ? X(e, e[t]) : F();
}
function _l(e) {
	return globalThis.Object.getOwnPropertyNames(e).reduce((t, n) => ({
		...t,
		[n]: gl(e, n)
	}), {});
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/module/module.mjs
var vl = class {
	constructor(e) {
		let t = _l(e), n = this.WithIdentifiers(t);
		this.$defs = n;
	}
	Import(e, t) {
		let n = {
			...this.$defs,
			[e]: m(this.$defs[e], t)
		};
		return m({
			[g]: "Import",
			$defs: n,
			$ref: e
		});
	}
	WithIdentifiers(e) {
		return globalThis.Object.getOwnPropertyNames(e).reduce((t, n) => ({
			...t,
			[n]: {
				...e[n],
				$id: n
			}
		}), {});
	}
};
function yl(e) {
	return new vl(e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/not/not.mjs
function bl(e, t) {
	return m({
		[g]: "Not",
		not: e
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/parameters/parameters.mjs
function xl(e, t) {
	return nt(e) ? hi(e.parameters, t) : F();
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/recursive/recursive.mjs
var Sl = 0;
function Cl(e, t = {}) {
	f(t.$id) && (t.$id = `T${Sl++}`);
	let n = ke(e({
		[g]: "This",
		$ref: `${t.$id}`
	}));
	return n.$id = t.$id, m({
		[We]: "Recursive",
		...n
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/regexp/regexp.mjs
function wl(e, t) {
	let n = d(e) ? new globalThis.RegExp(e) : e;
	return m({
		[g]: "RegExp",
		type: "RegExp",
		source: n.source,
		flags: n.flags
	}, t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/rest/rest.mjs
function Tl(e) {
	return _(e) ? e.allOf : S(e) ? e.anyOf : bt(e) ? e.items ?? [] : [];
}
function El(e) {
	return Tl(e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/return-type/return-type.mjs
function Dl(e, t) {
	return nt(e) ? m(e.returns, t) : F(t);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/transform/transform.mjs
var Ol = class {
	constructor(e) {
		this.schema = e;
	}
	Decode(e) {
		return new kl(this.schema, e);
	}
}, kl = class {
	constructor(e, t) {
		this.schema = e, this.decode = t;
	}
	EncodeTransform(e, t) {
		let n = {
			Encode: (n) => t[h].Encode(e(n)),
			Decode: (e) => this.decode(t[h].Decode(e))
		};
		return {
			...t,
			[h]: n
		};
	}
	EncodeSchema(e, t) {
		let n = {
			Decode: this.decode,
			Encode: e
		};
		return {
			...t,
			[h]: n
		};
	}
	Encode(e) {
		return yt(this.schema) ? this.EncodeTransform(e, this.schema) : this.EncodeSchema(e, this.schema);
	}
};
function Al(e) {
	return new Ol(e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/unsafe/unsafe.mjs
function jl(e = {}) {
	return m({ [g]: e[g] ?? "Unsafe" }, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/void/void.mjs
function Ml(e) {
	return m({
		[g]: "Void",
		type: "void"
	}, e);
}
//#endregion
//#region ../../node_modules/.pnpm/@sinclair+typebox@0.34.52/node_modules/@sinclair/typebox/build/esm/type/type/index.mjs
var Z = /* @__PURE__ */ fe({
	Any: () => Fn,
	Argument: () => Ln,
	Array: () => In,
	AsyncIterator: () => Rn,
	Awaited: () => Ki,
	BigInt: () => Sr,
	Boolean: () => xr,
	Capitalize: () => Ys,
	Composite: () => ma,
	Const: () => Ta,
	Constructor: () => Bn,
	ConstructorParameters: () => Ea,
	Date: () => ha,
	Enum: () => Da,
	Exclude: () => Ko,
	Extends: () => zo,
	Extract: () => Qo,
	Function: () => Vn,
	Index: () => $r,
	InstanceType: () => ns,
	Instantiate: () => Fs,
	Integer: () => Is,
	Intersect: () => Ri,
	Iterator: () => ii,
	KeyOf: () => oa,
	Literal: () => R,
	Lowercase: () => Xs,
	Mapped: () => wi,
	Module: () => yl,
	Never: () => F,
	Not: () => bl,
	Null: () => ga,
	Number: () => Cr,
	Object: () => z,
	Omit: () => lc,
	Optional: () => Oi,
	Parameters: () => xl,
	Partial: () => Pc,
	Pick: () => Cc,
	Promise: () => si,
	Readonly: () => di,
	ReadonlyOptional: () => rs,
	Record: () => gs,
	Recursive: () => Cl,
	Ref: () => zi,
	RegExp: () => wl,
	Required: () => Wc,
	Rest: () => El,
	ReturnType: () => Dl,
	String: () => wr,
	Symbol: () => _a,
	TemplateLiteral: () => Pr,
	Transform: () => Al,
	Tuple: () => hi,
	Uint8Array: () => ya,
	Uncapitalize: () => Zs,
	Undefined: () => va,
	Union: () => L,
	Unknown: () => ba,
	Unsafe: () => jl,
	Uppercase: () => Qs,
	Void: () => Ml
}), Q = Z.String({ $id: "Color" }), $ = Z.String({ $id: "FamilyName" }), Nl = Z.String({ $id: "FontWeight" }), Pl = Z.String({ $id: "Length" }), Fl = Z.String({ $id: "Percentage" }), Il = Z.String({ $id: "BoxShadow" }), Ll = Z.String({ $id: "Number" }), Rl = Z.String({ $id: "Size" }), zl = Z.Union([
	Z.String(),
	Z.Literal("thin"),
	Z.Literal("medium"),
	Z.Literal("thick")
], { $id: "LineWidth" }), Bl = Z.Optional(Z.Object({
	columnGap: Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)])),
	rowGap: Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)])),
	field: Z.Optional(Z.Object({
		label: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		input: Z.Optional(Z.Object({
			background: Z.Optional(Z.Ref(Q)),
			backgroundSubdued: Z.Optional(Z.Ref(Q)),
			foreground: Z.Optional(Z.Ref(Q)),
			foregroundSubdued: Z.Optional(Z.Ref(Q)),
			borderColor: Z.Optional(Z.Ref(Q)),
			borderColorHover: Z.Optional(Z.Ref(Q)),
			borderColorFocus: Z.Optional(Z.Ref(Q)),
			boxShadow: Z.Optional(Z.Ref(Il)),
			boxShadowHover: Z.Optional(Z.Ref(Il)),
			boxShadowFocus: Z.Optional(Z.Ref(Il)),
			height: Z.Optional(Z.Ref(Rl)),
			padding: Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)]))
		}))
	}))
})), Vl = Z.Object({
	borderRadius: Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)])),
	borderWidth: Z.Optional(Z.Ref(zl)),
	foreground: Z.Optional(Z.Ref(Q)),
	foregroundSubdued: Z.Optional(Z.Ref(Q)),
	foregroundAccent: Z.Optional(Z.Ref(Q)),
	background: Z.Optional(Z.Ref(Q)),
	backgroundNormal: Z.Optional(Z.Ref(Q)),
	backgroundAccent: Z.Optional(Z.Ref(Q)),
	backgroundSubdued: Z.Optional(Z.Ref(Q)),
	borderColor: Z.Optional(Z.Ref(Q)),
	borderColorAccent: Z.Optional(Z.Ref(Q)),
	borderColorSubdued: Z.Optional(Z.Ref(Q)),
	primary: Z.Optional(Z.Ref(Q)),
	primaryBackground: Z.Optional(Z.Ref(Q)),
	primarySubdued: Z.Optional(Z.Ref(Q)),
	primaryAccent: Z.Optional(Z.Ref(Q)),
	secondary: Z.Optional(Z.Ref(Q)),
	secondaryBackground: Z.Optional(Z.Ref(Q)),
	secondarySubdued: Z.Optional(Z.Ref(Q)),
	secondaryAccent: Z.Optional(Z.Ref(Q)),
	success: Z.Optional(Z.Ref(Q)),
	successBackground: Z.Optional(Z.Ref(Q)),
	successSubdued: Z.Optional(Z.Ref(Q)),
	successAccent: Z.Optional(Z.Ref(Q)),
	warning: Z.Optional(Z.Ref(Q)),
	warningBackground: Z.Optional(Z.Ref(Q)),
	warningSubdued: Z.Optional(Z.Ref(Q)),
	warningAccent: Z.Optional(Z.Ref(Q)),
	danger: Z.Optional(Z.Ref(Q)),
	dangerBackground: Z.Optional(Z.Ref(Q)),
	dangerSubdued: Z.Optional(Z.Ref(Q)),
	dangerAccent: Z.Optional(Z.Ref(Q)),
	fonts: Z.Optional(Z.Object({
		display: Z.Optional(Z.Object({
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		sans: Z.Optional(Z.Object({
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		serif: Z.Optional(Z.Object({
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		monospace: Z.Optional(Z.Object({
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		}))
	})),
	navigation: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		backgroundAccent: Z.Optional(Z.Ref(Q)),
		borderWidth: Z.Optional(Z.Ref(zl)),
		borderColor: Z.Optional(Z.Ref(Q)),
		project: Z.Optional(Z.Object({
			background: Z.Optional(Z.Ref(Q)),
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			borderWidth: Z.Optional(Z.Ref(zl)),
			borderColor: Z.Optional(Z.Ref(Q))
		})),
		modules: Z.Optional(Z.Object({
			background: Z.Optional(Z.Ref(Q)),
			borderWidth: Z.Optional(Z.Ref(zl)),
			borderColor: Z.Optional(Z.Ref(Q)),
			button: Z.Optional(Z.Object({
				foreground: Z.Optional(Z.Ref(Q)),
				foregroundHover: Z.Optional(Z.Ref(Q)),
				foregroundActive: Z.Optional(Z.Ref(Q)),
				background: Z.Optional(Z.Ref(Q)),
				backgroundHover: Z.Optional(Z.Ref(Q)),
				backgroundActive: Z.Optional(Z.Ref(Q))
			}))
		})),
		list: Z.Optional(Z.Object({
			icon: Z.Optional(Z.Object({
				foreground: Z.Optional(Z.Ref(Q)),
				foregroundHover: Z.Optional(Z.Ref(Q)),
				foregroundActive: Z.Optional(Z.Ref(Q))
			})),
			foreground: Z.Optional(Z.Ref(Q)),
			foregroundHover: Z.Optional(Z.Ref(Q)),
			foregroundActive: Z.Optional(Z.Ref(Q)),
			background: Z.Optional(Z.Ref(Q)),
			backgroundHover: Z.Optional(Z.Ref(Q)),
			backgroundActive: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			divider: Z.Object({
				borderColor: Z.Optional(Z.Ref(Q)),
				borderWidth: Z.Optional(Z.Ref(zl))
			})
		}))
	})),
	header: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		borderWidth: Z.Optional(Z.Ref(zl)),
		borderColor: Z.Optional(Z.Ref(Q)),
		boxShadow: Z.Optional(Z.Ref(Il)),
		headline: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($))
		})),
		title: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		}))
	})),
	form: Bl,
	sidebar: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		foreground: Z.Optional(Z.Ref(Q)),
		fontFamily: Z.Optional(Z.Ref($)),
		borderWidth: Z.Optional(Z.Ref(zl)),
		borderColor: Z.Optional(Z.Ref(Q)),
		section: Z.Optional(Z.Object({
			toggle: Z.Optional(Z.Object({
				icon: Z.Optional(Z.Object({
					foreground: Z.Optional(Z.Ref(Q)),
					foregroundHover: Z.Optional(Z.Ref(Q)),
					foregroundActive: Z.Optional(Z.Ref(Q))
				})),
				foreground: Z.Optional(Z.Ref(Q)),
				foregroundHover: Z.Optional(Z.Ref(Q)),
				foregroundActive: Z.Optional(Z.Ref(Q)),
				background: Z.Optional(Z.Ref(Q)),
				backgroundHover: Z.Optional(Z.Ref(Q)),
				backgroundActive: Z.Optional(Z.Ref(Q)),
				fontFamily: Z.Optional(Z.Ref($)),
				borderWidth: Z.Optional(Z.Ref(zl)),
				borderColor: Z.Optional(Z.Ref(Q))
			})),
			form: Bl
		}))
	})),
	public: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		foreground: Z.Optional(Z.Ref(Q)),
		foregroundAccent: Z.Optional(Z.Ref(Q)),
		art: Z.Optional(Z.Object({
			background: Z.Optional(Z.Ref(Q)),
			primary: Z.Optional(Z.Ref(Q)),
			secondary: Z.Optional(Z.Ref(Q)),
			speed: Z.Optional(Z.Ref(Ll))
		})),
		form: Bl
	})),
	popover: Z.Optional(Z.Object({ menu: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		borderRadius: Z.Optional(Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)]))),
		boxShadow: Z.Optional(Z.Ref(Il))
	})) })),
	banner: Z.Optional(Z.Object({
		background: Z.Optional(Z.Ref(Q)),
		padding: Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)])),
		borderRadius: Z.Optional(Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)]))),
		avatar: Z.Optional(Z.Object({
			background: Z.Optional(Z.Ref(Q)),
			foreground: Z.Optional(Z.Ref(Q)),
			borderRadius: Z.Optional(Z.Optional(Z.Union([Z.Ref(Pl), Z.Ref(Fl)])))
		})),
		headline: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		title: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		subtitle: Z.Optional(Z.Object({
			foreground: Z.Optional(Z.Ref(Q)),
			fontFamily: Z.Optional(Z.Ref($)),
			fontWeight: Z.Optional(Z.Ref(Nl))
		})),
		art: Z.Optional(Z.Object({ foreground: Z.Optional(Z.Ref(Q)) }))
	}))
}), Hl = Z.Object({
	id: Z.String(),
	name: Z.String(),
	appearance: Z.Union([Z.Literal("light"), Z.Literal("dark")]),
	rules: Vl
}), Ul = (e) => {
	let n = t(() => {
		let e = /* @__PURE__ */ new Map(), t = (n, r = []) => {
			for (let [i, a] of Object.entries(n)) typeof a == "object" && a && ("type" in a && a.type === "object" && "properties" in a && t(a.properties, [...r, i]), "$ref" in a && a.$ref === "FamilyName" && (e.has(r) ? e.set(r, {
				family: i,
				weight: e.get(r).weight
			}) : e.set(r, {
				family: i,
				weight: null
			})), "$ref" in a && a.$ref === "FontWeight" && (e.has(r) ? e.set(r, {
				family: e.get(r).family,
				weight: i
			}) : e.set(r, {
				family: null,
				weight: i
			})));
		};
		return t(Hl.properties.rules.properties), e;
	}), r = t(() => {
		let t = /* @__PURE__ */ new Map();
		for (let [r, { family: i, weight: a }] of n.value.entries()) {
			let n = null, o = null;
			if (i && (n = ie(s(e).rules, [...r, i])), a && (o = ie(s(e).rules, [...r, a])), n) {
				let e = n.split(",");
				for (let n of e) {
					let r = n.trim();
					if (r.startsWith("var(--")) {
						e.push(re(r.slice(6, -1)));
						continue;
					}
					if ((r.startsWith("\"") && r.endsWith("\"")) === !1) continue;
					let i = r.slice(1, -1);
					t.has(i) ? t.get(i).add(o ?? "400") : t.set(i, /* @__PURE__ */ new Set([o ?? "400"]));
				}
			}
		}
		return t;
	});
	return { googleFonts: t(() => {
		let e = [];
		for (let [t, n] of r.value.entries()) if ([
			"Inter",
			"Merriweather",
			"Fira Mono"
		].includes(t) === !1) {
			let r = Array.from(n).sort((e, t) => Number(e) - Number(t)).join(";");
			e.push(`${t.replaceAll(" ", "+")}:wght@${r}`);
		}
		return e;
	}) };
}, Wl = (e) => e, Gl = Wl({
	id: "Directus Default",
	name: "$t:theme_directus_default",
	appearance: "dark",
	rules: {
		borderRadius: "6px",
		borderWidth: "2px",
		foreground: "#c9d1d9",
		foregroundAccent: "#f0f6fc",
		foregroundSubdued: "#666672",
		background: "#0d1117",
		backgroundNormal: "#21262e",
		backgroundAccent: "#30363d",
		backgroundSubdued: "#161b22",
		borderColor: "#21262e",
		borderColorAccent: "#30363d",
		borderColorSubdued: "#21262d",
		primary: "var(--project-color)",
		primaryBackground: "color-mix(in srgb, var(--theme--background), var(--theme--primary) 10%)",
		primarySubdued: "color-mix(in srgb, var(--theme--background), var(--theme--primary) 50%)",
		primaryAccent: "color-mix(in srgb, var(--theme--primary), #16151a 25%)",
		secondary: "#ff99dd",
		secondaryBackground: "color-mix(in srgb, var(--theme--background), var(--theme--secondary) 10%)",
		secondarySubdued: "color-mix(in srgb, var(--theme--background), var(--theme--secondary) 50%)",
		secondaryAccent: "color-mix(in srgb, var(--theme--secondary), #16151a 25%)",
		success: "#2ecda7",
		successBackground: "color-mix(in srgb, var(--theme--background), var(--theme--success) 10%)",
		successSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--success) 50%)",
		successAccent: "color-mix(in srgb, var(--theme--success), #16151a 25%)",
		warning: "#ffa439",
		warningBackground: "color-mix(in srgb, var(--theme--background), var(--theme--warning) 10%)",
		warningSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--warning) 50%)",
		warningAccent: "color-mix(in srgb, var(--theme--warning), #16151a 25%)",
		danger: "#e35169",
		dangerBackground: "color-mix(in srgb, var(--theme--background), var(--theme--danger) 10%)",
		dangerSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--danger) 50%)",
		dangerAccent: "color-mix(in srgb, var(--theme--danger), #16151a 25%)",
		fonts: {
			display: {
				fontFamily: "\"Inter\", system-ui",
				fontWeight: "700"
			},
			sans: {
				fontFamily: "\"Inter\", system-ui",
				fontWeight: "500"
			},
			serif: {
				fontFamily: "\"Merriweather\", serif",
				fontWeight: "500"
			},
			monospace: {
				fontFamily: "\"Fira Mono\", monospace",
				fontWeight: "500"
			}
		},
		navigation: {
			background: "#21262e",
			backgroundAccent: "#30363d",
			borderColor: "transparent",
			borderWidth: "0px",
			project: {
				borderColor: "transparent",
				borderWidth: "0px",
				background: "#30363d",
				foreground: "var(--theme--foreground-accent)",
				fontFamily: "var(--theme--fonts--sans--font-family)"
			},
			modules: {
				background: "var(--theme--background)",
				borderColor: "transparent",
				borderWidth: "0px",
				button: {
					foreground: "var(--theme--foreground-subdued)",
					foregroundHover: "#fff",
					foregroundActive: "var(--theme--foreground-accent)",
					background: "transparent",
					backgroundHover: "transparent",
					backgroundActive: "#21262e"
				}
			},
			list: {
				icon: {
					foreground: "var(--theme--primary)",
					foregroundHover: "var(--theme--navigation--list--icon--foreground)",
					foregroundActive: "var(--theme--navigation--list--icon--foreground)"
				},
				foreground: "var(--theme--foreground-accent)",
				foregroundHover: "var(--theme--navigation--list--foreground)",
				foregroundActive: "var(--theme--navigation--list--foreground)",
				background: "transparent",
				backgroundHover: "#30363d",
				backgroundActive: "#30363d",
				fontFamily: "var(--theme--fonts--sans--font-family)",
				divider: {
					borderColor: "#30363d",
					borderWidth: "var(--theme--border-width)"
				}
			}
		},
		header: {
			background: "var(--theme--background)",
			borderColor: "transparent",
			borderWidth: "0px",
			boxShadow: "0 4px 7px -4px black",
			headline: {
				foreground: "var(--theme--foreground-subdued)",
				fontFamily: "var(--theme--fonts--sans--font-family)"
			},
			title: {
				foreground: "var(--theme--foreground-accent)",
				fontFamily: "var(--theme--fonts--display--font-family)",
				fontWeight: "var(--theme--fonts--display--font-weight)"
			}
		},
		form: {
			columnGap: "32px",
			rowGap: "40px",
			field: {
				label: {
					foreground: "var(--theme--foreground-accent)",
					fontFamily: "var(--theme--fonts--sans--font-family)",
					fontWeight: "600"
				},
				input: {
					background: "var(--theme--background)",
					backgroundSubdued: "var(--theme--background-subdued)",
					foreground: "var(--theme--foreground)",
					foregroundSubdued: "var(--theme--foreground-subdued)",
					borderColor: "#21262e",
					borderColorHover: "#30363d",
					borderColorFocus: "var(--theme--primary)",
					boxShadow: "none",
					boxShadowHover: "none",
					boxShadowFocus: "0 0 16px -8px var(--theme--primary)",
					height: "60px",
					padding: "16px"
				}
			}
		},
		sidebar: {
			background: "#21262e",
			foreground: "var(--theme--foreground-subdued)",
			fontFamily: "var(--theme--fonts--sans--font-family)",
			borderColor: "transparent",
			borderWidth: "0px",
			section: {
				toggle: {
					icon: {
						foreground: "var(--theme--foreground-accent)",
						foregroundHover: "var(--theme--sidebar--section--toggle--icon--foreground)",
						foregroundActive: "var(--theme--sidebar--section--toggle--icon--foreground)"
					},
					foreground: "var(--theme--foreground-accent)",
					foregroundHover: "var(--theme--sidebar--section--toggle--foreground)",
					foregroundActive: "var(--theme--sidebar--section--toggle--foreground)",
					background: "#30363d",
					backgroundHover: "var(--theme--sidebar--section--toggle--background)",
					backgroundActive: "var(--theme--sidebar--section--toggle--background)",
					fontFamily: "var(--theme--fonts--sans--font-family)",
					borderColor: "transparent",
					borderWidth: "0px"
				},
				form: {
					columnGap: "var(--theme--form--column-gap)",
					rowGap: "var(--theme--form--row-gap)",
					label: {
						foreground: "var(--theme--form--field--label--foreground)",
						fontFamily: "var(--theme--form--field--label--font-family)"
					},
					field: { input: {
						background: "var(--theme--form--field--input--background)",
						foreground: "var(--theme--form--field--input--foreground)",
						foregroundSubdued: "var(--theme--form--field--input--foreground-subdued)",
						borderColor: "var(--theme--form--field--input--border-color)",
						borderColorHover: "var(--theme--form--field--input--border-color-hover)",
						borderColorFocus: "var(--theme--form--field--input--border-color-focus)",
						boxShadow: "var(--theme--form--field--input--box-shadow)",
						boxShadowHover: "var(--theme--form--field--input--box-shadow-hover)",
						boxShadowFocus: "var(--theme--form--field--input--box-shadow-focus)",
						height: "52px",
						padding: "12px"
					} }
				}
			}
		},
		public: {
			background: "var(--theme--background)",
			foreground: "var(--theme--foreground)",
			foregroundAccent: "var(--theme--foreground-accent)",
			art: {
				background: "#0e1c2f",
				primary: "var(--theme--primary)",
				secondary: "var(--theme--secondary)",
				speed: "1"
			},
			form: {
				columnGap: "var(--theme--form--column-gap)",
				rowGap: "var(--theme--form--row-gap)",
				field: {
					label: {
						foreground: "var(--theme--form--field--label--foreground)",
						fontFamily: "var(--theme--form--field--label--font-family)"
					},
					input: {
						background: "var(--theme--form--field--input--background)",
						foreground: "var(--theme--form--field--input--foreground)",
						foregroundSubdued: "var(--theme--form--field--input--foreground-subdued)",
						borderColor: "var(--theme--form--field--input--border-color)",
						borderColorHover: "var(--theme--form--field--input--border-color-hover)",
						borderColorFocus: "var(--theme--form--field--input--border-color-focus)",
						boxShadow: "var(--theme--form--field--input--box-shadow)",
						boxShadowHover: "var(--theme--form--field--input--box-shadow-hover)",
						boxShadowFocus: "var(--theme--form--field--input--box-shadow-focus)",
						height: "var(--theme--form--field--input--height)",
						padding: "var(--theme--form--field--input--padding)"
					}
				}
			}
		},
		popover: { menu: {
			background: "#161b22",
			borderRadius: "var(--theme--border-radius)",
			boxShadow: "0px 0px 6px 0px black"
		} },
		banner: {
			background: "#0e1c2f",
			padding: "40px",
			borderRadius: "var(--theme--border-radius)",
			avatar: {
				borderRadius: "50%",
				foreground: "var(--theme--primary)",
				background: "#ffffff"
			},
			headline: {
				foreground: "#ffffff",
				fontFamily: "var(--theme--fonts--sans--font-family)",
				fontWeight: "var(--theme--fonts--sans--font-weight)"
			},
			title: {
				foreground: "#ffffff",
				fontFamily: "var(--theme--fonts--display--font-family)",
				fontWeight: "var(--theme--fonts--display--font-weight)"
			},
			subtitle: {
				foreground: "#a2b5cd",
				fontFamily: "var(--theme--fonts--monospace--font-family)",
				fontWeight: "var(--theme--fonts--monospace--font-weight)"
			},
			art: { foreground: "#2e3a4d" }
		}
	}
}), Kl = Wl({
	id: "Directus Color Match",
	name: "$t:theme_directus_colormatch",
	appearance: "light",
	rules: {
		background: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 7%)",
		backgroundAccent: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 20%)",
		backgroundNormal: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 15%)",
		backgroundSubdued: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 10%)",
		borderColor: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 20%)",
		borderColorAccent: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 40%)",
		borderColorSubdued: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 15%)",
		borderRadius: "12px",
		borderWidth: "1px",
		foreground: "color-mix(in srgb, #000000, var(--theme--primary) 70%)",
		foregroundAccent: "color-mix(in srgb, #000000, var(--theme--primary) 50%)",
		foregroundSubdued: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 60%)",
		fonts: { display: {
			fontFamily: "\"Montserrat\", system-ui",
			fontWeight: "400"
		} },
		form: { field: { input: {
			background: "#FFFFFF",
			backgroundSubdued: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 13%)"
		} } },
		navigation: {
			background: "#FFFFFF",
			backgroundAccent: "var(--theme--background)",
			borderWidth: "var(--theme--border-width)",
			borderColor: "var(--theme--border-color-subdued)",
			modules: {
				background: "color-mix(in srgb, #000000, var(--theme--primary) 90%)",
				button: {
					backgroundActive: "#FFFFFF",
					foreground: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 20%)",
					foregroundActive: "var(--theme--primary)"
				}
			},
			project: {
				borderWidth: "1px",
				background: "#FFFFFF",
				borderColor: "var(--theme--border-color-subdued)"
			},
			list: {
				divider: { borderColor: "var(--theme--border-color-subdued)" },
				icon: { foreground: "var(--theme--foreground)" },
				foreground: "var(--theme--foreground)",
				foregroundHover: "var(--theme--foreground)",
				foregroundActive: "var(--theme--foreground)"
			}
		},
		header: {
			background: "#FFFFFF",
			borderWidth: "1px",
			borderColor: "var(--theme--border-color-subdued)",
			boxShadow: "0 4px 7px -4px rgba(0,102,102, 0.2)"
		},
		sidebar: {
			background: "#FFFFFF",
			borderWidth: "1px",
			borderColor: "var(--theme--border-color-subdued)",
			section: { toggle: {
				borderColor: "var(--theme--border-color-subdued)",
				borderWidth: "1px",
				background: "#FFFFFF",
				foreground: "var(--theme--foreground)",
				foregroundHover: "var(--theme--foreground)",
				foregroundActive: "var(--theme--foreground-accent)",
				icon: {
					foreground: "var(--theme--foreground)",
					foregroundHover: "var(--theme--foreground)",
					foregroundActive: "var(--theme--foreground-accent)"
				}
			} }
		},
		public: {
			art: {
				background: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 10%)",
				primary: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 60%)",
				secondary: "color-mix(in srgb, #FFFFFF, var(--theme--secondary) 70%)"
			},
			background: "#FFFFFF"
		}
	}
}), ql = Wl({
	id: "Directus Default",
	name: "$t:theme_directus_default",
	appearance: "light",
	rules: {
		borderRadius: "6px",
		borderWidth: "2px",
		foreground: "#4f5464",
		foregroundAccent: "#172940",
		foregroundSubdued: "#a2b5cd",
		background: "#fff",
		backgroundNormal: "#f0f4f9",
		backgroundAccent: "#e4eaf1",
		backgroundSubdued: "#f7fafc",
		borderColor: "#e4eaf1",
		borderColorAccent: "#d3dae4",
		borderColorSubdued: "#f0f4f9",
		primary: "var(--project-color)",
		primaryBackground: "color-mix(in srgb, var(--theme--background), var(--theme--primary) 10%)",
		primarySubdued: "color-mix(in srgb, var(--theme--background), var(--theme--primary) 50%)",
		primaryAccent: "color-mix(in srgb, var(--theme--primary), #2e3c43 25%)",
		secondary: "#ff99dd",
		secondaryBackground: "color-mix(in srgb, var(--theme--background), var(--theme--secondary) 10%)",
		secondarySubdued: "color-mix(in srgb, var(--theme--background), var(--theme--secondary) 50%)",
		secondaryAccent: "color-mix(in srgb, var(--theme--secondary), #2e3c43 25%)",
		success: "#2ecda7",
		successBackground: "color-mix(in srgb, var(--theme--background), var(--theme--success) 10%)",
		successSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--success) 50%)",
		successAccent: "color-mix(in srgb, var(--theme--success), #2e3c43 25%)",
		warning: "#ffa439",
		warningBackground: "color-mix(in srgb, var(--theme--background), var(--theme--warning) 10%)",
		warningSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--warning) 50%)",
		warningAccent: "color-mix(in srgb, var(--theme--warning), #2e3c43 25%)",
		danger: "#e35169",
		dangerBackground: "color-mix(in srgb, var(--theme--background), var(--theme--danger) 10%)",
		dangerSubdued: "color-mix(in srgb, var(--theme--background), var(--theme--danger) 50%)",
		dangerAccent: "color-mix(in srgb, var(--theme--danger), #2e3c43 25%)",
		fonts: {
			display: {
				fontFamily: "\"Inter\", system-ui",
				fontWeight: "700"
			},
			sans: {
				fontFamily: "\"Inter\", system-ui",
				fontWeight: "500"
			},
			serif: {
				fontFamily: "\"Merriweather\", serif",
				fontWeight: "500"
			},
			monospace: {
				fontFamily: "\"Fira Mono\", monospace",
				fontWeight: "500"
			}
		},
		navigation: {
			background: "var(--theme--background-normal)",
			backgroundAccent: "var(--theme--background-accent)",
			borderColor: "transparent",
			borderWidth: "0px",
			project: {
				borderColor: "transparent",
				borderWidth: "0px",
				background: "var(--theme--navigation--background-accent)",
				foreground: "var(--theme--foreground-accent)",
				fontFamily: "var(--theme--font-family-sans-serif)"
			},
			modules: {
				background: "#0e1c2f",
				borderColor: "transparent",
				borderWidth: "0px",
				button: {
					foreground: "#8196b1",
					foregroundHover: "#fff",
					foregroundActive: "var(--theme--foreground-accent)",
					background: "transparent",
					backgroundHover: "transparent",
					backgroundActive: "var(--theme--background-normal)"
				}
			},
			list: {
				icon: {
					foreground: "var(--theme--primary)",
					foregroundHover: "var(--theme--navigation--list--icon--foreground)",
					foregroundActive: "var(--theme--navigation--list--icon--foreground)"
				},
				foreground: "var(--theme--foreground-accent)",
				foregroundHover: "var(--theme--navigation--list--foreground)",
				foregroundActive: "var(--theme--navigation--list--foreground)",
				background: "transparent",
				backgroundHover: "var(--theme--navigation--background-accent)",
				backgroundActive: "var(--theme--navigation--background-accent)",
				fontFamily: "var(--theme--fonts--sans--font-family)",
				divider: {
					borderColor: "var(--theme--border-color-accent)",
					borderWidth: "var(--theme--border-width)"
				}
			}
		},
		header: {
			background: "var(--theme--background)",
			borderColor: "transparent",
			borderWidth: "0px",
			boxShadow: "0 4px 7px -4px rgb(0 0 0 / 0.2)",
			headline: {
				foreground: "var(--theme--foreground-subdued)",
				fontFamily: "var(--theme--fonts--sans--font-family)"
			},
			title: {
				foreground: "var(--theme--foreground-accent)",
				fontFamily: "var(--theme--fonts--display--font-family)",
				fontWeight: "var(--theme--fonts--display--font-weight)"
			}
		},
		form: {
			columnGap: "32px",
			rowGap: "40px",
			field: {
				label: {
					foreground: "var(--theme--foreground-accent)",
					fontFamily: "var(--theme--fonts--sans--font-family)",
					fontWeight: "600"
				},
				input: {
					background: "var(--theme--background)",
					backgroundSubdued: "var(--theme--background-subdued)",
					foreground: "var(--theme--foreground)",
					foregroundSubdued: "var(--theme--foreground-subdued)",
					borderColor: "var(--theme--border-color)",
					borderColorHover: "var(--theme--border-color-accent)",
					borderColorFocus: "var(--theme--primary)",
					boxShadow: "none",
					boxShadowHover: "none",
					boxShadowFocus: "0 0 16px -8px var(--theme--primary)",
					height: "60px",
					padding: "16px"
				}
			}
		},
		sidebar: {
			background: "var(--theme--background-normal)",
			foreground: "var(--theme--foreground-subdued)",
			fontFamily: "var(--theme--fonts--sans--font-family)",
			borderColor: "transparent",
			borderWidth: "0px",
			section: {
				toggle: {
					icon: {
						foreground: "var(--theme--foreground-accent)",
						foregroundHover: "var(--theme--sidebar--section--toggle--icon--foreground)",
						foregroundActive: "var(--theme--sidebar--section--toggle--icon--foreground)"
					},
					foreground: "var(--theme--foreground-accent)",
					foregroundHover: "var(--theme--sidebar--section--toggle--foreground)",
					foregroundActive: "var(--theme--sidebar--section--toggle--foreground)",
					background: "var(--theme--background-accent)",
					backgroundHover: "var(--theme--sidebar--section--toggle--background)",
					backgroundActive: "var(--theme--sidebar--section--toggle--background)",
					fontFamily: "var(--theme--fonts--sans--font-family)",
					borderColor: "transparent",
					borderWidth: "0px"
				},
				form: {
					columnGap: "var(--theme--form--column-gap)",
					rowGap: "var(--theme--form--row-gap)",
					label: {
						foreground: "var(--theme--form--field--label--foreground)",
						fontFamily: "var(--theme--form--field--label--font-family)"
					},
					field: { input: {
						background: "var(--theme--form--field--input--background)",
						foreground: "var(--theme--form--field--input--foreground)",
						foregroundSubdued: "var(--theme--form--field--input--foreground-subdued)",
						borderColor: "var(--theme--form--field--input--border-color)",
						borderColorHover: "var(--theme--form--field--input--border-color-hover)",
						borderColorFocus: "var(--theme--form--field--input--border-color-focus)",
						boxShadow: "var(--theme--form--field--input--box-shadow)",
						boxShadowHover: "var(--theme--form--field--input--box-shadow-hover)",
						boxShadowFocus: "var(--theme--form--field--input--box-shadow-focus)",
						height: "52px",
						padding: "12px"
					} }
				}
			}
		},
		public: {
			background: "var(--theme--background)",
			foreground: "var(--theme--foreground)",
			foregroundAccent: "var(--theme--foreground-accent)",
			art: {
				background: "#0e1c2f",
				primary: "var(--theme--primary)",
				secondary: "var(--theme--secondary)",
				speed: "1"
			},
			form: {
				columnGap: "var(--theme--form--column-gap)",
				rowGap: "var(--theme--form--row-gap)",
				label: {
					foreground: "var(--theme--form--field--label--foreground)",
					fontFamily: "var(--theme--form--field--label--font-family)"
				},
				field: { input: {
					background: "var(--theme--form--field--input--background)",
					foreground: "var(--theme--form--field--input--foreground)",
					foregroundSubdued: "var(--theme--form--field--input--foreground-subdued)",
					borderColor: "var(--theme--form--field--input--border-color)",
					borderColorHover: "var(--theme--form--field--input--border-color-hover)",
					borderColorFocus: "var(--theme--form--field--input--border-color-focus)",
					boxShadow: "var(--theme--form--field--input--box-shadow)",
					boxShadowHover: "var(--theme--form--field--input--box-shadow-hover)",
					boxShadowFocus: "var(--theme--form--field--input--box-shadow-focus)",
					height: "var(--theme--form--field--input--height)",
					padding: "var(--theme--form--field--input--padding)"
				} }
			}
		},
		popover: { menu: {
			background: "#fafcfd",
			borderRadius: "var(--theme--border-radius)",
			boxShadow: "0px 0px 6px 0px rgb(23, 41, 64, 0.2), 0px 0px 12px 2px rgb(23, 41, 64, 0.05)"
		} },
		banner: {
			background: "#0e1c2f",
			padding: "40px",
			borderRadius: "var(--theme--border-radius)",
			avatar: {
				borderRadius: "50%",
				foreground: "var(--theme--primary)",
				background: "#ffffff"
			},
			headline: {
				foreground: "#ffffff",
				fontFamily: "var(--theme--fonts--sans--font-family)",
				fontWeight: "var(--theme--fonts--sans--font-weight)"
			},
			title: {
				foreground: "#ffffff",
				fontFamily: "var(--theme--fonts--display--font-family)",
				fontWeight: "var(--theme--fonts--display--font-weight)"
			},
			subtitle: {
				foreground: "#a2b5cd",
				fontFamily: "var(--theme--fonts--monospace--font-family)",
				fontWeight: "var(--theme--fonts--monospace--font-weight)"
			},
			art: { foreground: "#2e3a4d" }
		}
	}
}), Jl = Wl({
	id: "Directus Minimal",
	name: "$t:theme_directus_minimal",
	appearance: "light",
	rules: {
		borderWidth: "1px",
		backgroundPage: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 7%)",
		navigation: {
			background: "#FFFFFF",
			modules: {
				background: "#FFFFFF",
				button: {
					backgroundActive: "#F1F5F9",
					foreground: "var(--theme--foreground)",
					foregroundHover: "var(--theme--primary)",
					foregroundActive: "var(--theme--primary)",
					backgroundHover: "#F1F5F9",
					background: "#FFFFFF"
				},
				borderWidth: "1px",
				borderColor: "var(--theme--border-color)"
			},
			project: {
				borderWidth: "1px",
				background: "#FFFFFF",
				borderColor: "var(--theme--border-color)"
			},
			list: {
				icon: { foreground: "#0F172A" },
				divider: { borderColor: "var(--theme--border-color)" }
			},
			borderWidth: "1px",
			backgroundAccent: "#F1F5F9",
			borderColor: "var(--theme--border-color)"
		},
		header: {
			background: "#FFFFFF",
			borderWidth: "1px",
			borderColor: "var(--theme--border-color)",
			boxShadow: "0 4px 7px -4px rgba(0,102,102, 0.1)"
		},
		backgroundAccent: "#E2E8F0",
		backgroundSubdued: "#F8FAFC",
		background: "#FFFFFF",
		foreground: "#1E293B",
		foregroundAccent: "#0F172A",
		foregroundSubdued: "#94A3B8",
		borderRadius: "4px",
		borderColor: "#E2E8F0",
		borderColorAccent: "#CBD5E1",
		borderColorSubdued: "#F1F5F9",
		form: {
			rowGap: "32px",
			field: { input: {
				background: "#FFFFFF",
				backgroundSubdued: "#F8FAFC",
				boxShadowFocus: "none",
				height: "52px"
			} }
		},
		sidebar: {
			background: "#FFFFFF",
			borderWidth: "1px",
			borderColor: "var(--theme--border-color)",
			section: {
				toggle: {
					borderColor: "var(--theme--border-color)",
					borderWidth: "1px",
					background: "#FFFFFF",
					foreground: "var(--theme--foreground-subdued)",
					foregroundHover: "var(--theme--foreground)",
					foregroundActive: "var(--theme--foreground-accent)",
					icon: {
						foreground: "var(--theme--foreground)",
						foregroundHover: "var(--theme--foreground)",
						foregroundActive: "var(--theme--foreground-accent)"
					}
				},
				form: { field: { input: { height: "42px" } } }
			}
		},
		public: {
			art: {
				background: "color-mix(in srgb, #FFFFFF, var(--project-color) 10%)",
				primary: "color-mix(in srgb, #FFFFFF, var(--project-color) 70%)",
				secondary: "color-mix(in srgb, #FFFFFF, var(--project-color) 40%)"
			},
			background: "#FFFFFF"
		},
		backgroundNormal: "#F1F5F9",
		secondary: "#64748B",
		primary: "#0F172A",
		primaryBackground: "#F1F5F9",
		primarySubdued: "#F8FAFC",
		primaryAccent: "#E2E8F0",
		secondaryAccent: "#E2E8F0",
		secondaryBackground: "#F1F5F9",
		secondarySubdued: "#F8FAFC",
		fonts: { display: { fontFamily: "system-ui" } }
	}
}), Yl = [Gl], Xl = [
	ql,
	Jl,
	Kl
], Zl = se("🎨 Themes", () => {
	let e = o({
		light: Xl,
		dark: Yl
	});
	return {
		themes: e,
		registerTheme: (t) => {
			t.appearance === "light" ? e.light.push(t) : e.dark.push(t);
		}
	};
}), Ql = (e, n, r, i, a) => {
	let { themes: o } = ce(Zl());
	return { theme: t(() => {
		let t = s(e) ? s(r) : s(n), ee = s(e) ? Gl : ql, te = s(e) ? s(a) : s(i), ne = s(o)[s(e) ? "dark" : "light"].find((e) => e.id === t);
		return ne ? te ? oe({}, ee, ne, { rules: te }) : oe(ee, ne) : (t && t !== ee.id && console.warn(`Theme "${t}" doesn't exist.`), te ? oe({}, ee, { rules: te }) : ee);
	}) };
}, $l = (e) => {
	let t = ue(e, { delimiter: "--" }), n = (e) => `--theme--${le(e, { separator: "-" })}`;
	return ae(t, (e, t) => n(t));
}, eu = /* @__PURE__ */ i({
	__name: "theme-provider",
	props: {
		darkMode: { type: Boolean },
		themeLight: { default: ql.name },
		themeLightOverrides: { default: () => ({}) },
		themeDark: { default: Gl.name },
		themeDarkOverrides: { default: () => ({}) }
	},
	setup(i) {
		let { darkMode: o, themeLight: re, themeDark: ie, themeLightOverrides: ae, themeDarkOverrides: oe } = te(i), { theme: se } = Ql(o, re, ie, ae, oe), ce = t(() => $l(s(se).rules)), { googleFonts: le } = Ul(se);
		ne({ link: t(() => {
			let e = "";
			if (le.value.length > 0) {
				let t = le.value.join("&family=");
				e += `https://fonts.googleapis.com/css2?family=${t}`, e += "\n";
			}
			return e ? [{
				rel: "stylesheet",
				href: e
			}] : [];
		}) });
		let ue = t(() => `:root {${Object.entries(s(ce)).map(([e, t]) => `${e}: ${t};`).join(" ")}}`);
		return (t, i) => (a(), n(e, { to: "#theme" }, [r(ee(ue.value), 1)]));
	}
});
//#endregion
export { eu as ThemeProvider, Wl as defineTheme, $l as rulesToCssVars, Ul as useFonts, Ql as useTheme, Zl as useThemeStore };
