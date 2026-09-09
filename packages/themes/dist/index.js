import { computed as Ir, unref as B, reactive as Ho, defineComponent as Vo, toRefs as _o, openBlock as Go, createBlock as qo, Teleport as zo, createTextVNode as Qo, toDisplayString as Jo } from "vue";
import { useHead as Xo } from "@unhead/vue";
import { get as Le, merge as Gn, mapKeys as Yo } from "lodash-es";
import { defineStore as Zo, storeToRefs as rt } from "pinia";
import nt from "decamelize";
import { flatten as et } from "flat";
import { cssVar as ot } from "@directus/utils/browser";
function tt(r) {
  return x(r) && !K(r) && !cn(r) && Symbol.asyncIterator in r;
}
function K(r) {
  return Array.isArray(r);
}
function Qe(r) {
  return typeof r == "bigint";
}
function un(r) {
  return typeof r == "boolean";
}
function ne(r) {
  return r instanceof globalThis.Date;
}
function it(r) {
  return typeof r == "function";
}
function ut(r) {
  return x(r) && !K(r) && !cn(r) && Symbol.iterator in r;
}
function ct(r) {
  return r === null;
}
function ir(r) {
  return typeof r == "number";
}
function x(r) {
  return typeof r == "object" && r !== null;
}
function Je(r) {
  return r instanceof globalThis.RegExp;
}
function $(r) {
  return typeof r == "string";
}
function at(r) {
  return typeof r == "symbol";
}
function cn(r) {
  return r instanceof globalThis.Uint8Array;
}
function I(r) {
  return r === void 0;
}
function st(r) {
  return r.map((n) => Rn(n));
}
function ft(r) {
  return new Date(r.getTime());
}
function dt(r) {
  return new Uint8Array(r);
}
function mt(r) {
  return new RegExp(r.source, r.flags);
}
function lt(r) {
  const n = {};
  for (const e of Object.getOwnPropertyNames(r))
    n[e] = Rn(r[e]);
  for (const e of Object.getOwnPropertySymbols(r))
    n[e] = Rn(r[e]);
  return n;
}
function Rn(r) {
  return K(r) ? st(r) : ne(r) ? ft(r) : cn(r) ? dt(r) : Je(r) ? mt(r) : x(r) ? lt(r) : r;
}
function D(r) {
  return Rn(r);
}
function ee(r, n) {
  return D(n === void 0 ? r : { ...n, ...r });
}
function pt(r) {
  return r !== null && typeof r == "object";
}
function bt(r) {
  return globalThis.Array.isArray(r) && !globalThis.ArrayBuffer.isView(r);
}
function gt(r) {
  return r === void 0;
}
function Ft(r) {
  return typeof r == "number";
}
var Qn;
(function(r) {
  r.InstanceMode = "default", r.ExactOptionalPropertyTypes = !1, r.AllowArrayObject = !1, r.AllowNaN = !1, r.AllowNullVoid = !1;
  function n(f, m) {
    return r.ExactOptionalPropertyTypes ? m in f : f[m] !== void 0;
  }
  r.IsExactOptionalProperty = n;
  function e(f) {
    const m = pt(f);
    return r.AllowArrayObject ? m : m && !bt(f);
  }
  r.IsObjectLike = e;
  function t(f) {
    return e(f) && !(f instanceof Date) && !(f instanceof Uint8Array);
  }
  r.IsRecordLike = t;
  function u(f) {
    return r.AllowNaN ? Ft(f) : Number.isFinite(f);
  }
  r.IsNumberLike = u;
  function s(f) {
    const m = gt(f);
    return r.AllowNullVoid ? m || f === null : m;
  }
  r.IsVoidLike = s;
})(Qn || (Qn = {}));
function ht(r) {
  return globalThis.Object.freeze(r).map((n) => $n(n));
}
function Ot(r) {
  const n = {};
  for (const e of Object.getOwnPropertyNames(r))
    n[e] = $n(r[e]);
  for (const e of Object.getOwnPropertySymbols(r))
    n[e] = $n(r[e]);
  return globalThis.Object.freeze(n);
}
function $n(r) {
  return K(r) ? ht(r) : ne(r) ? r : cn(r) ? r : Je(r) ? r : x(r) ? Ot(r) : r;
}
function a(r, n) {
  const e = n !== void 0 ? { ...n, ...r } : r;
  switch (Qn.InstanceMode) {
    case "freeze":
      return $n(e);
    case "clone":
      return D(e);
    default:
      return e;
  }
}
class wr extends Error {
  constructor(n) {
    super(n);
  }
}
const q = Symbol.for("TypeBox.Transform"), an = Symbol.for("TypeBox.Readonly"), sr = Symbol.for("TypeBox.Optional"), xn = Symbol.for("TypeBox.Hint"), d = Symbol.for("TypeBox.Kind");
function oe(r) {
  return x(r) && r[an] === "Readonly";
}
function br(r) {
  return x(r) && r[sr] === "Optional";
}
function Xe(r) {
  return l(r, "Any");
}
function Ye(r) {
  return l(r, "Argument");
}
function Wr(r) {
  return l(r, "Array");
}
function wn(r) {
  return l(r, "AsyncIterator");
}
function kn(r) {
  return l(r, "BigInt");
}
function sn(r) {
  return l(r, "Boolean");
}
function Kr(r) {
  return l(r, "Computed");
}
function Br(r) {
  return l(r, "Constructor");
}
function Rt(r) {
  return l(r, "Date");
}
function Dr(r) {
  return l(r, "Function");
}
function Hr(r) {
  return l(r, "Integer");
}
function Q(r) {
  return l(r, "Intersect");
}
function An(r) {
  return l(r, "Iterator");
}
function l(r, n) {
  return x(r) && d in r && r[d] === n;
}
function Ze(r) {
  return un(r) || ir(r) || $(r);
}
function kr(r) {
  return l(r, "Literal");
}
function Ar(r) {
  return l(r, "MappedKey");
}
function _(r) {
  return l(r, "MappedResult");
}
function fn(r) {
  return l(r, "Never");
}
function $t(r) {
  return l(r, "Not");
}
function te(r) {
  return l(r, "Null");
}
function Vr(r) {
  return l(r, "Number");
}
function nr(r) {
  return l(r, "Object");
}
function vn(r) {
  return l(r, "Promise");
}
function Tn(r) {
  return l(r, "Record");
}
function E(r) {
  return l(r, "Ref");
}
function ro(r) {
  return l(r, "RegExp");
}
function dn(r) {
  return l(r, "String");
}
function ie(r) {
  return l(r, "Symbol");
}
function vr(r) {
  return l(r, "TemplateLiteral");
}
function It(r) {
  return l(r, "This");
}
function Sn(r) {
  return x(r) && q in r;
}
function Tr(r) {
  return l(r, "Tuple");
}
function ue(r) {
  return l(r, "Undefined");
}
function S(r) {
  return l(r, "Union");
}
function yt(r) {
  return l(r, "Uint8Array");
}
function xt(r) {
  return l(r, "Unknown");
}
function wt(r) {
  return l(r, "Unsafe");
}
function kt(r) {
  return l(r, "Void");
}
function At(r) {
  return x(r) && d in r && $(r[d]);
}
function pr(r) {
  return Xe(r) || Ye(r) || Wr(r) || sn(r) || kn(r) || wn(r) || Kr(r) || Br(r) || Rt(r) || Dr(r) || Hr(r) || Q(r) || An(r) || kr(r) || Ar(r) || _(r) || fn(r) || $t(r) || te(r) || Vr(r) || nr(r) || vn(r) || Tn(r) || E(r) || ro(r) || dn(r) || ie(r) || vr(r) || It(r) || Tr(r) || ue(r) || S(r) || yt(r) || xt(r) || wt(r) || kt(r) || At(r);
}
const vt = [
  "Argument",
  "Any",
  "Array",
  "AsyncIterator",
  "BigInt",
  "Boolean",
  "Computed",
  "Constructor",
  "Date",
  "Enum",
  "Function",
  "Integer",
  "Intersect",
  "Iterator",
  "Literal",
  "MappedKey",
  "MappedResult",
  "Not",
  "Null",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Ref",
  "RegExp",
  "String",
  "Symbol",
  "TemplateLiteral",
  "This",
  "Tuple",
  "Undefined",
  "Union",
  "Uint8Array",
  "Unknown",
  "Void"
];
function no(r) {
  try {
    return new RegExp(r), !0;
  } catch {
    return !1;
  }
}
function ce(r) {
  if (!$(r))
    return !1;
  for (let n = 0; n < r.length; n++) {
    const e = r.charCodeAt(n);
    if (e >= 7 && e <= 13 || e === 27 || e === 127)
      return !1;
  }
  return !0;
}
function eo(r) {
  return ae(r) || C(r);
}
function Jr(r) {
  return I(r) || Qe(r);
}
function F(r) {
  return I(r) || ir(r);
}
function ae(r) {
  return I(r) || un(r);
}
function g(r) {
  return I(r) || $(r);
}
function Tt(r) {
  return I(r) || $(r) && ce(r) && no(r);
}
function St(r) {
  return I(r) || $(r) && ce(r);
}
function oo(r) {
  return I(r) || C(r);
}
function In(r) {
  return x(r) && r[sr] === "Optional";
}
function X(r) {
  return p(r, "Any") && g(r.$id);
}
function Pt(r) {
  return p(r, "Argument") && ir(r.index);
}
function Sr(r) {
  return p(r, "Array") && r.type === "array" && g(r.$id) && C(r.items) && F(r.minItems) && F(r.maxItems) && ae(r.uniqueItems) && oo(r.contains) && F(r.minContains) && F(r.maxContains);
}
function se(r) {
  return p(r, "AsyncIterator") && r.type === "AsyncIterator" && g(r.$id) && C(r.items);
}
function Pn(r) {
  return p(r, "BigInt") && r.type === "bigint" && g(r.$id) && Jr(r.exclusiveMaximum) && Jr(r.exclusiveMinimum) && Jr(r.maximum) && Jr(r.minimum) && Jr(r.multipleOf);
}
function Pr(r) {
  return p(r, "Boolean") && r.type === "boolean" && g(r.$id);
}
function Ct(r) {
  return p(r, "Computed") && $(r.target) && K(r.parameters) && r.parameters.every((n) => C(n));
}
function Cn(r) {
  return p(r, "Constructor") && r.type === "Constructor" && g(r.$id) && K(r.parameters) && r.parameters.every((n) => C(n)) && C(r.returns);
}
function jn(r) {
  return p(r, "Date") && r.type === "Date" && g(r.$id) && F(r.exclusiveMaximumTimestamp) && F(r.exclusiveMinimumTimestamp) && F(r.maximumTimestamp) && F(r.minimumTimestamp) && F(r.multipleOfTimestamp);
}
function Un(r) {
  return p(r, "Function") && r.type === "Function" && g(r.$id) && K(r.parameters) && r.parameters.every((n) => C(n)) && C(r.returns);
}
function fr(r) {
  return p(r, "Integer") && r.type === "integer" && g(r.$id) && F(r.exclusiveMaximum) && F(r.exclusiveMinimum) && F(r.maximum) && F(r.minimum) && F(r.multipleOf);
}
function to(r) {
  return x(r) && Object.entries(r).every(([n, e]) => ce(n) && C(e));
}
function Cr(r) {
  return p(r, "Intersect") && !($(r.type) && r.type !== "object") && K(r.allOf) && r.allOf.every((n) => C(n) && !Et(n)) && g(r.type) && (ae(r.unevaluatedProperties) || oo(r.unevaluatedProperties)) && g(r.$id);
}
function fe(r) {
  return p(r, "Iterator") && r.type === "Iterator" && g(r.$id) && C(r.items);
}
function p(r, n) {
  return x(r) && d in r && r[d] === n;
}
function io(r) {
  return gr(r) && $(r.const);
}
function uo(r) {
  return gr(r) && ir(r.const);
}
function co(r) {
  return gr(r) && un(r.const);
}
function gr(r) {
  return p(r, "Literal") && g(r.$id) && jt(r.const);
}
function jt(r) {
  return un(r) || ir(r) || $(r);
}
function Ut(r) {
  return p(r, "MappedKey") && K(r.keys) && r.keys.every((n) => ir(n) || $(n));
}
function Nt(r) {
  return p(r, "MappedResult") && to(r.properties);
}
function Fr(r) {
  return p(r, "Never") && x(r.not) && Object.getOwnPropertyNames(r.not).length === 0;
}
function Nr(r) {
  return p(r, "Not") && C(r.not);
}
function de(r) {
  return p(r, "Null") && r.type === "null" && g(r.$id);
}
function L(r) {
  return p(r, "Number") && r.type === "number" && g(r.$id) && F(r.exclusiveMaximum) && F(r.exclusiveMinimum) && F(r.maximum) && F(r.minimum) && F(r.multipleOf);
}
function O(r) {
  return p(r, "Object") && r.type === "object" && g(r.$id) && to(r.properties) && eo(r.additionalProperties) && F(r.minProperties) && F(r.maxProperties);
}
function me(r) {
  return p(r, "Promise") && r.type === "Promise" && g(r.$id) && C(r.item);
}
function P(r) {
  return p(r, "Record") && r.type === "object" && g(r.$id) && eo(r.additionalProperties) && x(r.patternProperties) && ((n) => {
    const e = Object.getOwnPropertyNames(n.patternProperties);
    return e.length === 1 && no(e[0]) && x(n.patternProperties) && C(n.patternProperties[e[0]]);
  })(r);
}
function Mt(r) {
  return p(r, "Ref") && g(r.$id) && $(r.$ref);
}
function Zr(r) {
  return p(r, "RegExp") && g(r.$id) && $(r.source) && $(r.flags) && F(r.maxLength) && F(r.minLength);
}
function Y(r) {
  return p(r, "String") && r.type === "string" && g(r.$id) && F(r.minLength) && F(r.maxLength) && Tt(r.pattern) && St(r.format);
}
function rn(r) {
  return p(r, "Symbol") && r.type === "symbol" && g(r.$id);
}
function nn(r) {
  return p(r, "TemplateLiteral") && r.type === "string" && $(r.pattern) && r.pattern[0] === "^" && r.pattern[r.pattern.length - 1] === "$";
}
function Lt(r) {
  return p(r, "This") && g(r.$id) && $(r.$ref);
}
function Et(r) {
  return x(r) && q in r;
}
function Nn(r) {
  return p(r, "Tuple") && r.type === "array" && g(r.$id) && ir(r.minItems) && ir(r.maxItems) && r.minItems === r.maxItems && // empty
  (I(r.items) && I(r.additionalItems) && r.minItems === 0 || K(r.items) && r.items.every((n) => C(n)));
}
function yr(r) {
  return p(r, "Undefined") && r.type === "undefined" && g(r.$id);
}
function ar(r) {
  return p(r, "Union") && g(r.$id) && x(r) && K(r.anyOf) && r.anyOf.every((n) => C(n));
}
function mn(r) {
  return p(r, "Uint8Array") && r.type === "Uint8Array" && g(r.$id) && F(r.minByteLength) && F(r.maxByteLength);
}
function Z(r) {
  return p(r, "Unknown") && g(r.$id);
}
function Wt(r) {
  return p(r, "Unsafe");
}
function Mn(r) {
  return p(r, "Void") && r.type === "void" && g(r.$id);
}
function Kt(r) {
  return x(r) && d in r && $(r[d]) && !vt.includes(r[d]);
}
function C(r) {
  return x(r) && (X(r) || Pt(r) || Sr(r) || Pr(r) || Pn(r) || se(r) || Ct(r) || Cn(r) || jn(r) || Un(r) || fr(r) || Cr(r) || fe(r) || gr(r) || Ut(r) || Nt(r) || Fr(r) || Nr(r) || de(r) || L(r) || O(r) || me(r) || P(r) || Mt(r) || Zr(r) || Y(r) || rn(r) || nn(r) || Lt(r) || Nn(r) || yr(r) || ar(r) || mn(r) || Z(r) || Wt(r) || Mn(r) || Kt(r));
}
const Bt = "(true|false)", On = "(0|[1-9][0-9]*)", ao = "(.*)", Dt = "(?!.*)", Mr = `^${On}$`, Lr = `^${ao}$`, Ht = `^${Dt}$`;
function Vt(r, n) {
  return r.includes(n);
}
function _t(r) {
  return [...new Set(r)];
}
function Gt(r, n) {
  return r.filter((e) => n.includes(e));
}
function qt(r, n) {
  return r.reduce((e, t) => Gt(e, t), n);
}
function zt(r) {
  return r.length === 1 ? r[0] : r.length > 1 ? qt(r.slice(1), r[0]) : [];
}
function Qt(r) {
  const n = [];
  for (const e of r)
    n.push(...e);
  return n;
}
function en(r) {
  return a({ [d]: "Any" }, r);
}
function le(r, n) {
  return a({ [d]: "Array", type: "array", items: r }, n);
}
function Jt(r) {
  return a({ [d]: "Argument", index: r });
}
function pe(r, n) {
  return a({ [d]: "AsyncIterator", type: "AsyncIterator", items: r }, n);
}
function v(r, n, e) {
  return a({ [d]: "Computed", target: r, parameters: n }, e);
}
function Xt(r, n) {
  const { [n]: e, ...t } = r;
  return t;
}
function H(r, n) {
  return n.reduce((e, t) => Xt(e, t), r);
}
function w(r) {
  return a({ [d]: "Never", not: {} }, r);
}
function j(r) {
  return a({
    [d]: "MappedResult",
    properties: r
  });
}
function be(r, n, e) {
  return a({ [d]: "Constructor", type: "Constructor", parameters: r, returns: n }, e);
}
function ln(r, n, e) {
  return a({ [d]: "Function", type: "Function", parameters: r, returns: n }, e);
}
function Jn(r, n) {
  return a({ [d]: "Union", anyOf: r }, n);
}
function Yt(r) {
  return r.some((n) => br(n));
}
function Ee(r) {
  return r.map((n) => br(n) ? Zt(n) : n);
}
function Zt(r) {
  return H(r, [sr]);
}
function ri(r, n) {
  return Yt(r) ? Rr(Jn(Ee(r), n)) : Jn(Ee(r), n);
}
function _r(r, n) {
  return r.length === 1 ? a(r[0], n) : r.length === 0 ? w(n) : ri(r, n);
}
function U(r, n) {
  return r.length === 0 ? w(n) : r.length === 1 ? a(r[0], n) : Jn(r, n);
}
class We extends wr {
}
function ni(r) {
  return r.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function ge(r, n, e) {
  return r[n] === e && r.charCodeAt(n - 1) !== 92;
}
function cr(r, n) {
  return ge(r, n, "(");
}
function on(r, n) {
  return ge(r, n, ")");
}
function so(r, n) {
  return ge(r, n, "|");
}
function ei(r) {
  if (!(cr(r, 0) && on(r, r.length - 1)))
    return !1;
  let n = 0;
  for (let e = 0; e < r.length; e++)
    if (cr(r, e) && (n += 1), on(r, e) && (n -= 1), n === 0 && e !== r.length - 1)
      return !1;
  return !0;
}
function oi(r) {
  return r.slice(1, r.length - 1);
}
function ti(r) {
  let n = 0;
  for (let e = 0; e < r.length; e++)
    if (cr(r, e) && (n += 1), on(r, e) && (n -= 1), so(r, e) && n === 0)
      return !0;
  return !1;
}
function ii(r) {
  for (let n = 0; n < r.length; n++)
    if (cr(r, n))
      return !0;
  return !1;
}
function ui(r) {
  let [n, e] = [0, 0];
  const t = [];
  for (let s = 0; s < r.length; s++)
    if (cr(r, s) && (n += 1), on(r, s) && (n -= 1), so(r, s) && n === 0) {
      const f = r.slice(e, s);
      f.length > 0 && t.push(Er(f)), e = s + 1;
    }
  const u = r.slice(e);
  return u.length > 0 && t.push(Er(u)), t.length === 0 ? { type: "const", const: "" } : t.length === 1 ? t[0] : { type: "or", expr: t };
}
function ci(r) {
  function n(u, s) {
    if (!cr(u, s))
      throw new We("TemplateLiteralParser: Index must point to open parens");
    let f = 0;
    for (let m = s; m < u.length; m++)
      if (cr(u, m) && (f += 1), on(u, m) && (f -= 1), f === 0)
        return [s, m];
    throw new We("TemplateLiteralParser: Unclosed group parens in expression");
  }
  function e(u, s) {
    for (let f = s; f < u.length; f++)
      if (cr(u, f))
        return [s, f];
    return [s, u.length];
  }
  const t = [];
  for (let u = 0; u < r.length; u++)
    if (cr(r, u)) {
      const [s, f] = n(r, u), m = r.slice(s, f + 1);
      t.push(Er(m)), u = f;
    } else {
      const [s, f] = e(r, u), m = r.slice(s, f);
      m.length > 0 && t.push(Er(m)), u = f - 1;
    }
  return t.length === 0 ? { type: "const", const: "" } : t.length === 1 ? t[0] : { type: "and", expr: t };
}
function Er(r) {
  return ei(r) ? Er(oi(r)) : ti(r) ? ui(r) : ii(r) ? ci(r) : { type: "const", const: ni(r) };
}
function Fe(r) {
  return Er(r.slice(1, r.length - 1));
}
class ai extends wr {
}
function si(r) {
  return r.type === "or" && r.expr.length === 2 && r.expr[0].type === "const" && r.expr[0].const === "0" && r.expr[1].type === "const" && r.expr[1].const === "[1-9][0-9]*";
}
function fi(r) {
  return r.type === "or" && r.expr.length === 2 && r.expr[0].type === "const" && r.expr[0].const === "true" && r.expr[1].type === "const" && r.expr[1].const === "false";
}
function di(r) {
  return r.type === "const" && r.const === ".*";
}
function tn(r) {
  return si(r) || di(r) ? !1 : fi(r) ? !0 : r.type === "and" ? r.expr.every((n) => tn(n)) : r.type === "or" ? r.expr.every((n) => tn(n)) : r.type === "const" ? !0 : (() => {
    throw new ai("Unknown expression type");
  })();
}
function mi(r) {
  const n = Fe(r.pattern);
  return tn(n);
}
class li extends wr {
}
function* fo(r) {
  if (r.length === 1)
    return yield* r[0];
  for (const n of r[0])
    for (const e of fo(r.slice(1)))
      yield `${n}${e}`;
}
function* pi(r) {
  return yield* fo(r.expr.map((n) => [...Ln(n)]));
}
function* bi(r) {
  for (const n of r.expr)
    yield* Ln(n);
}
function* gi(r) {
  return yield r.const;
}
function* Ln(r) {
  return r.type === "and" ? yield* pi(r) : r.type === "or" ? yield* bi(r) : r.type === "const" ? yield* gi(r) : (() => {
    throw new li("Unknown expression");
  })();
}
function mo(r) {
  const n = Fe(r.pattern);
  return tn(n) ? [...Ln(n)] : [];
}
function y(r, n) {
  return a({
    [d]: "Literal",
    const: r,
    type: typeof r
  }, n);
}
function lo(r) {
  return a({ [d]: "Boolean", type: "boolean" }, r);
}
function he(r) {
  return a({ [d]: "BigInt", type: "bigint" }, r);
}
function jr(r) {
  return a({ [d]: "Number", type: "number" }, r);
}
function xr(r) {
  return a({ [d]: "String", type: "string" }, r);
}
function* Fi(r) {
  const n = r.trim().replace(/"|'/g, "");
  return n === "boolean" ? yield lo() : n === "number" ? yield jr() : n === "bigint" ? yield he() : n === "string" ? yield xr() : yield (() => {
    const e = n.split("|").map((t) => y(t.trim()));
    return e.length === 0 ? w() : e.length === 1 ? e[0] : _r(e);
  })();
}
function* hi(r) {
  if (r[1] !== "{") {
    const n = y("$"), e = Xn(r.slice(1));
    return yield* [n, ...e];
  }
  for (let n = 2; n < r.length; n++)
    if (r[n] === "}") {
      const e = Fi(r.slice(2, n)), t = Xn(r.slice(n + 1));
      return yield* [...e, ...t];
    }
  yield y(r);
}
function* Xn(r) {
  for (let n = 0; n < r.length; n++)
    if (r[n] === "$") {
      const e = y(r.slice(0, n)), t = hi(r.slice(n));
      return yield* [e, ...t];
    }
  yield y(r);
}
function Oi(r) {
  return [...Xn(r)];
}
class Ri extends wr {
}
function $i(r) {
  return r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function po(r, n) {
  return vr(r) ? r.pattern.slice(1, r.pattern.length - 1) : S(r) ? `(${r.anyOf.map((e) => po(e, n)).join("|")})` : Vr(r) ? `${n}${On}` : Hr(r) ? `${n}${On}` : kn(r) ? `${n}${On}` : dn(r) ? `${n}${ao}` : kr(r) ? `${n}${$i(r.const.toString())}` : sn(r) ? `${n}${Bt}` : (() => {
    throw new Ri(`Unexpected Kind '${r[d]}'`);
  })();
}
function Ke(r) {
  return `^${r.map((n) => po(n, "")).join("")}$`;
}
function yn(r) {
  const e = mo(r).map((t) => y(t));
  return _r(e);
}
function bo(r, n) {
  const e = $(r) ? Ke(Oi(r)) : Ke(r);
  return a({ [d]: "TemplateLiteral", type: "string", pattern: e }, n);
}
function Ii(r) {
  return mo(r).map((e) => e.toString());
}
function yi(r) {
  const n = [];
  for (const e of r)
    n.push(...hr(e));
  return n;
}
function xi(r) {
  return [r.toString()];
}
function hr(r) {
  return [...new Set(vr(r) ? Ii(r) : S(r) ? yi(r.anyOf) : kr(r) ? xi(r.const) : Vr(r) ? ["[number]"] : Hr(r) ? ["[number]"] : [])];
}
function wi(r, n, e) {
  const t = {};
  for (const u of Object.getOwnPropertyNames(n))
    t[u] = En(r, hr(n[u]), e);
  return t;
}
function ki(r, n, e) {
  return wi(r, n.properties, e);
}
function Ai(r, n, e) {
  const t = ki(r, n, e);
  return j(t);
}
function go(r, n) {
  return r.map((e) => Fo(e, n));
}
function vi(r) {
  return r.filter((n) => !fn(n));
}
function Ti(r, n) {
  return $o(vi(go(r, n)));
}
function Si(r) {
  return r.some((n) => fn(n)) ? [] : r;
}
function Pi(r, n) {
  return _r(Si(go(r, n)));
}
function Ci(r, n) {
  return n in r ? r[n] : n === "[number]" ? _r(r) : w();
}
function ji(r, n) {
  return n === "[number]" ? r : w();
}
function Ui(r, n) {
  return n in r ? r[n] : w();
}
function Fo(r, n) {
  return Q(r) ? Ti(r.allOf, n) : S(r) ? Pi(r.anyOf, n) : Tr(r) ? Ci(r.items ?? [], n) : Wr(r) ? ji(r.items, n) : nr(r) ? Ui(r.properties, n) : w();
}
function ho(r, n) {
  return n.map((e) => Fo(r, e));
}
function Be(r, n) {
  return _r(ho(r, n));
}
function En(r, n, e) {
  if (E(r) || E(n)) {
    const t = "Index types using Ref parameters require both Type and Key to be of TSchema";
    if (!pr(r) || !pr(n))
      throw new wr(t);
    return v("Index", [r, n]);
  }
  return _(n) ? Ai(r, n, e) : Ar(n) ? Ei(r, n, e) : a(pr(n) ? Be(r, hr(n)) : Be(r, n), e);
}
function Ni(r, n, e) {
  return { [n]: En(r, [n], D(e)) };
}
function Mi(r, n, e) {
  return n.reduce((t, u) => ({ ...t, ...Ni(r, u, e) }), {});
}
function Li(r, n, e) {
  return Mi(r, n.keys, e);
}
function Ei(r, n, e) {
  const t = Li(r, n, e);
  return j(t);
}
function Oe(r, n) {
  return a({ [d]: "Iterator", type: "Iterator", items: r }, n);
}
function Wi(r) {
  return globalThis.Object.keys(r).filter((n) => !br(r[n]));
}
function Ki(r, n) {
  const e = Wi(r), t = e.length > 0 ? { [d]: "Object", type: "object", required: e, properties: r } : { [d]: "Object", type: "object", properties: r };
  return a(t, n);
}
var T = Ki;
function Oo(r, n) {
  return a({ [d]: "Promise", type: "Promise", item: r }, n);
}
function Bi(r) {
  return a(H(r, [an]));
}
function Di(r) {
  return a({ ...r, [an]: "Readonly" });
}
function Hi(r, n) {
  return n === !1 ? Bi(r) : Di(r);
}
function Or(r, n) {
  const e = n ?? !0;
  return _(r) ? Gi(r, e) : Hi(r, e);
}
function Vi(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = Or(r[t], n);
  return e;
}
function _i(r, n) {
  return Vi(r.properties, n);
}
function Gi(r, n) {
  const e = _i(r, n);
  return j(e);
}
function Gr(r, n) {
  return a(r.length > 0 ? { [d]: "Tuple", type: "array", items: r, additionalItems: !1, minItems: r.length, maxItems: r.length } : { [d]: "Tuple", type: "array", minItems: r.length, maxItems: r.length }, n);
}
function Ro(r, n) {
  return r in n ? G(r, n[r]) : j(n);
}
function qi(r) {
  return { [r]: y(r) };
}
function zi(r) {
  const n = {};
  for (const e of r)
    n[e] = y(e);
  return n;
}
function Qi(r, n) {
  return Vt(n, r) ? qi(r) : zi(n);
}
function Ji(r, n) {
  const e = Qi(r, n);
  return Ro(r, e);
}
function Xr(r, n) {
  return n.map((e) => G(r, e));
}
function Xi(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(n))
    e[t] = G(r, n[t]);
  return e;
}
function G(r, n) {
  const e = { ...n };
  return (
    // unevaluated modifier types
    br(n) ? Rr(G(r, H(n, [sr]))) : oe(n) ? Or(G(r, H(n, [an]))) : (
      // unevaluated mapped types
      _(n) ? Ro(r, n.properties) : Ar(n) ? Ji(r, n.keys) : (
        // unevaluated types
        Br(n) ? be(Xr(r, n.parameters), G(r, n.returns), e) : Dr(n) ? ln(Xr(r, n.parameters), G(r, n.returns), e) : wn(n) ? pe(G(r, n.items), e) : An(n) ? Oe(G(r, n.items), e) : Q(n) ? $r(Xr(r, n.allOf), e) : S(n) ? U(Xr(r, n.anyOf), e) : Tr(n) ? Gr(Xr(r, n.items ?? []), e) : nr(n) ? T(Xi(r, n.properties), e) : Wr(n) ? le(G(r, n.items), e) : vn(n) ? Oo(G(r, n.item), e) : n
      )
    )
  );
}
function Yi(r, n) {
  const e = {};
  for (const t of r)
    e[t] = G(t, n);
  return e;
}
function Zi(r, n, e) {
  const t = pr(r) ? hr(r) : r, u = n({ [d]: "MappedKey", keys: t }), s = Yi(t, u);
  return T(s, e);
}
function ru(r) {
  return a(H(r, [sr]));
}
function nu(r) {
  return a({ ...r, [sr]: "Optional" });
}
function eu(r, n) {
  return n === !1 ? ru(r) : nu(r);
}
function Rr(r, n) {
  const e = n ?? !0;
  return _(r) ? iu(r, e) : eu(r, e);
}
function ou(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = Rr(r[t], n);
  return e;
}
function tu(r, n) {
  return ou(r.properties, n);
}
function iu(r, n) {
  const e = tu(r, n);
  return j(e);
}
function Yn(r, n = {}) {
  const e = r.every((u) => nr(u)), t = pr(n.unevaluatedProperties) ? { unevaluatedProperties: n.unevaluatedProperties } : {};
  return a(n.unevaluatedProperties === !1 || pr(n.unevaluatedProperties) || e ? { ...t, [d]: "Intersect", type: "object", allOf: r } : { ...t, [d]: "Intersect", allOf: r }, n);
}
function uu(r) {
  return r.every((n) => br(n));
}
function cu(r) {
  return H(r, [sr]);
}
function De(r) {
  return r.map((n) => br(n) ? cu(n) : n);
}
function au(r, n) {
  return uu(r) ? Rr(Yn(De(r), n)) : Yn(De(r), n);
}
function $o(r, n = {}) {
  if (r.length === 1)
    return a(r[0], n);
  if (r.length === 0)
    return w(n);
  if (r.some((e) => Sn(e)))
    throw new Error("Cannot intersect transform types");
  return au(r, n);
}
function $r(r, n) {
  if (r.length === 1)
    return a(r[0], n);
  if (r.length === 0)
    return w(n);
  if (r.some((e) => Sn(e)))
    throw new Error("Cannot intersect transform types");
  return Yn(r, n);
}
function pn(...r) {
  const [n, e] = typeof r[0] == "string" ? [r[0], r[1]] : [r[0].$id, r[1]];
  if (typeof n != "string")
    throw new wr("Ref: $ref must be a string");
  return a({ [d]: "Ref", $ref: n }, e);
}
function su(r, n) {
  return v("Awaited", [v(r, n)]);
}
function fu(r) {
  return v("Awaited", [pn(r)]);
}
function du(r) {
  return $r(Io(r));
}
function mu(r) {
  return U(Io(r));
}
function lu(r) {
  return Wn(r);
}
function Io(r) {
  return r.map((n) => Wn(n));
}
function Wn(r, n) {
  return a(Kr(r) ? su(r.target, r.parameters) : Q(r) ? du(r.allOf) : S(r) ? mu(r.anyOf) : vn(r) ? lu(r.item) : E(r) ? fu(r.$ref) : r, n);
}
function yo(r) {
  const n = [];
  for (const e of r)
    n.push(Re(e));
  return n;
}
function pu(r) {
  const n = yo(r);
  return Qt(n);
}
function bu(r) {
  const n = yo(r);
  return zt(n);
}
function gu(r) {
  return r.map((n, e) => e.toString());
}
function Fu(r) {
  return ["[number]"];
}
function hu(r) {
  return globalThis.Object.getOwnPropertyNames(r);
}
function Ou(r) {
  return [];
}
function Re(r) {
  return Q(r) ? pu(r.allOf) : S(r) ? bu(r.anyOf) : Tr(r) ? gu(r.items ?? []) : Wr(r) ? Fu(r.items) : nr(r) ? hu(r.properties) : Tn(r) ? Ou(r.patternProperties) : [];
}
function Ru(r, n) {
  return v("KeyOf", [v(r, n)]);
}
function $u(r) {
  return v("KeyOf", [pn(r)]);
}
function Iu(r, n) {
  const e = Re(r), t = yu(e), u = _r(t);
  return a(u, n);
}
function yu(r) {
  return r.map((n) => n === "[number]" ? jr() : y(n));
}
function $e(r, n) {
  return Kr(r) ? Ru(r.target, r.parameters) : E(r) ? $u(r.$ref) : _(r) ? ku(r, n) : Iu(r, n);
}
function xu(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = $e(r[t], D(n));
  return e;
}
function wu(r, n) {
  return xu(r.properties, n);
}
function ku(r, n) {
  const e = wu(r, n);
  return j(e);
}
function Au(r) {
  const n = [];
  for (const e of r)
    n.push(...Re(e));
  return _t(n);
}
function vu(r) {
  return r.filter((n) => !fn(n));
}
function Tu(r, n) {
  const e = [];
  for (const t of r)
    e.push(...ho(t, [n]));
  return vu(e);
}
function Su(r, n) {
  const e = {};
  for (const t of n)
    e[t] = $o(Tu(r, t));
  return e;
}
function Pu(r, n) {
  const e = Au(r), t = Su(r, e);
  return T(t, n);
}
function xo(r) {
  return a({ [d]: "Date", type: "Date" }, r);
}
function wo(r) {
  return a({ [d]: "Null", type: "null" }, r);
}
function ko(r) {
  return a({ [d]: "Symbol", type: "symbol" }, r);
}
function Ao(r) {
  return a({ [d]: "Undefined", type: "undefined" }, r);
}
function vo(r) {
  return a({ [d]: "Uint8Array", type: "Uint8Array" }, r);
}
function Kn(r) {
  return a({ [d]: "Unknown" }, r);
}
function Cu(r) {
  return r.map((n) => Ie(n, !1));
}
function ju(r) {
  const n = {};
  for (const e of globalThis.Object.getOwnPropertyNames(r))
    n[e] = Or(Ie(r[e], !1));
  return n;
}
function hn(r, n) {
  return n === !0 ? r : Or(r);
}
function Ie(r, n) {
  return tt(r) || ut(r) ? hn(en(), n) : K(r) ? Or(Gr(Cu(r))) : cn(r) ? vo() : ne(r) ? xo() : x(r) ? hn(T(ju(r)), n) : it(r) ? hn(ln([], Kn()), n) : I(r) ? Ao() : ct(r) ? wo() : at(r) ? ko() : Qe(r) ? he() : ir(r) || un(r) || $(r) ? y(r) : T({});
}
function Uu(r, n) {
  return a(Ie(r, !0), n);
}
function Nu(r, n) {
  return Br(r) ? Gr(r.parameters, n) : w(n);
}
function Mu(r, n) {
  if (I(r))
    throw new Error("Enum undefined or empty");
  const e = globalThis.Object.getOwnPropertyNames(r).filter((s) => isNaN(s)).map((s) => r[s]), u = [...new Set(e)].map((s) => y(s));
  return U(u, { ...n, [xn]: "Enum" });
}
class Lu extends wr {
}
var i;
(function(r) {
  r[r.Union = 0] = "Union", r[r.True = 1] = "True", r[r.False = 2] = "False";
})(i || (i = {}));
function z(r) {
  return r === i.False ? r : i.True;
}
function qr(r) {
  throw new Lu(r);
}
function k(r) {
  return Fr(r) || Cr(r) || ar(r) || Z(r) || X(r);
}
function A(r, n) {
  return Fr(n) ? Po() : Cr(n) ? Bn(r, n) : ar(n) ? xe(r, n) : Z(n) ? No() : X(n) ? ye() : qr("StructuralRight");
}
function ye(r, n) {
  return i.True;
}
function Eu(r, n) {
  return Cr(n) ? Bn(r, n) : ar(n) && n.anyOf.some((e) => X(e) || Z(e)) ? i.True : ar(n) ? i.Union : Z(n) || X(n) ? i.True : i.Union;
}
function Wu(r, n) {
  return Z(r) ? i.False : X(r) ? i.Union : Fr(r) ? i.True : i.False;
}
function Ku(r, n) {
  return O(n) && Dn(n) ? i.True : k(n) ? A(r, n) : Sr(n) ? z(b(r.items, n.items)) : i.False;
}
function Bu(r, n) {
  return k(n) ? A(r, n) : se(n) ? z(b(r.items, n.items)) : i.False;
}
function Du(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : Pn(n) ? i.True : i.False;
}
function To(r, n) {
  return co(r) || Pr(r) ? i.True : i.False;
}
function Hu(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : Pr(n) ? i.True : i.False;
}
function Vu(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : Cn(n) ? r.parameters.length > n.parameters.length ? i.False : r.parameters.every((e, t) => z(b(n.parameters[t], e)) === i.True) ? z(b(r.returns, n.returns)) : i.False : i.False;
}
function _u(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : jn(n) ? i.True : i.False;
}
function Gu(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : Un(n) ? r.parameters.length > n.parameters.length ? i.False : r.parameters.every((e, t) => z(b(n.parameters[t], e)) === i.True) ? z(b(r.returns, n.returns)) : i.False : i.False;
}
function So(r, n) {
  return gr(r) && ir(r.const) || L(r) || fr(r) ? i.True : i.False;
}
function qu(r, n) {
  return fr(n) || L(n) ? i.True : k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : i.False;
}
function Bn(r, n) {
  return n.allOf.every((e) => b(r, e) === i.True) ? i.True : i.False;
}
function zu(r, n) {
  return r.allOf.some((e) => b(e, n) === i.True) ? i.True : i.False;
}
function Qu(r, n) {
  return k(n) ? A(r, n) : fe(n) ? z(b(r.items, n.items)) : i.False;
}
function Ju(r, n) {
  return gr(n) && n.const === r.const ? i.True : k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : Y(n) ? Uo(r) : L(n) ? Co(r) : fr(n) ? So(r) : Pr(n) ? To(r) : i.False;
}
function Po(r, n) {
  return i.False;
}
function Xu(r, n) {
  return i.True;
}
function He(r) {
  let [n, e] = [r, 0];
  for (; Nr(n); )
    n = n.not, e += 1;
  return e % 2 === 0 ? n : Kn();
}
function Yu(r, n) {
  return Nr(r) ? b(He(r), n) : Nr(n) ? b(r, He(n)) : qr("Invalid fallthrough for Not");
}
function Zu(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : de(n) ? i.True : i.False;
}
function Co(r, n) {
  return uo(r) || L(r) || fr(r) ? i.True : i.False;
}
function rc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : fr(n) || L(n) ? i.True : i.False;
}
function W(r, n) {
  return Object.getOwnPropertyNames(r.properties).length === n;
}
function Ve(r) {
  return Dn(r);
}
function _e(r) {
  return W(r, 0) || W(r, 1) && "description" in r.properties && ar(r.properties.description) && r.properties.description.anyOf.length === 2 && (Y(r.properties.description.anyOf[0]) && yr(r.properties.description.anyOf[1]) || Y(r.properties.description.anyOf[1]) && yr(r.properties.description.anyOf[0]));
}
function qn(r) {
  return W(r, 0);
}
function Ge(r) {
  return W(r, 0);
}
function nc(r) {
  return W(r, 0);
}
function ec(r) {
  return W(r, 0);
}
function oc(r) {
  return Dn(r);
}
function tc(r) {
  const n = jr();
  return W(r, 0) || W(r, 1) && "length" in r.properties && z(b(r.properties.length, n)) === i.True;
}
function ic(r) {
  return W(r, 0);
}
function Dn(r) {
  const n = jr();
  return W(r, 0) || W(r, 1) && "length" in r.properties && z(b(r.properties.length, n)) === i.True;
}
function uc(r) {
  const n = ln([en()], en());
  return W(r, 0) || W(r, 1) && "then" in r.properties && z(b(r.properties.then, n)) === i.True;
}
function jo(r, n) {
  return b(r, n) === i.False || In(r) && !In(n) ? i.False : i.True;
}
function N(r, n) {
  return Z(r) ? i.False : X(r) ? i.Union : Fr(r) || io(r) && Ve(n) || uo(r) && qn(n) || co(r) && Ge(n) || rn(r) && _e(n) || Pn(r) && nc(n) || Y(r) && Ve(n) || rn(r) && _e(n) || L(r) && qn(n) || fr(r) && qn(n) || Pr(r) && Ge(n) || mn(r) && oc(n) || jn(r) && ec(n) || Cn(r) && ic(n) || Un(r) && tc(n) ? i.True : P(r) && Y(Zn(r)) ? n[xn] === "Record" ? i.True : i.False : P(r) && L(Zn(r)) ? W(n, 0) ? i.True : i.False : i.False;
}
function cc(r, n) {
  return k(n) ? A(r, n) : P(n) ? J(r, n) : O(n) ? (() => {
    for (const e of Object.getOwnPropertyNames(n.properties)) {
      if (!(e in r.properties) && !In(n.properties[e]))
        return i.False;
      if (In(n.properties[e]))
        return i.True;
      if (jo(r.properties[e], n.properties[e]) === i.False)
        return i.False;
    }
    return i.True;
  })() : i.False;
}
function ac(r, n) {
  return k(n) ? A(r, n) : O(n) && uc(n) ? i.True : me(n) ? z(b(r.item, n.item)) : i.False;
}
function Zn(r) {
  return Mr in r.patternProperties ? jr() : Lr in r.patternProperties ? xr() : qr("Unknown record key pattern");
}
function re(r) {
  return Mr in r.patternProperties ? r.patternProperties[Mr] : Lr in r.patternProperties ? r.patternProperties[Lr] : qr("Unable to get record value schema");
}
function J(r, n) {
  const [e, t] = [Zn(n), re(n)];
  return io(r) && L(e) && z(b(r, t)) === i.True ? i.True : mn(r) && L(e) || Y(r) && L(e) || Sr(r) && L(e) ? b(r, t) : O(r) ? (() => {
    for (const u of Object.getOwnPropertyNames(r.properties))
      if (jo(t, r.properties[u]) === i.False)
        return i.False;
    return i.True;
  })() : i.False;
}
function sc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? b(re(r), re(n)) : i.False;
}
function fc(r, n) {
  const e = Zr(r) ? xr() : r, t = Zr(n) ? xr() : n;
  return b(e, t);
}
function Uo(r, n) {
  return gr(r) && $(r.const) || Y(r) ? i.True : i.False;
}
function dc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : Y(n) ? i.True : i.False;
}
function mc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : rn(n) ? i.True : i.False;
}
function lc(r, n) {
  return nn(r) ? b(yn(r), n) : nn(n) ? b(r, yn(n)) : qr("Invalid fallthrough for TemplateLiteral");
}
function pc(r, n) {
  return Sr(n) && r.items !== void 0 && r.items.every((e) => b(e, n.items) === i.True);
}
function bc(r, n) {
  return Fr(r) ? i.True : Z(r) ? i.False : X(r) ? i.Union : i.False;
}
function gc(r, n) {
  return k(n) ? A(r, n) : O(n) && Dn(n) || Sr(n) && pc(r, n) ? i.True : Nn(n) ? I(r.items) && !I(n.items) || !I(r.items) && I(n.items) ? i.False : I(r.items) && !I(n.items) || r.items.every((e, t) => b(e, n.items[t]) === i.True) ? i.True : i.False : i.False;
}
function Fc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : mn(n) ? i.True : i.False;
}
function hc(r, n) {
  return k(n) ? A(r, n) : O(n) ? N(r, n) : P(n) ? J(r, n) : Mn(n) ? $c(r) : yr(n) ? i.True : i.False;
}
function xe(r, n) {
  return n.anyOf.some((e) => b(r, e) === i.True) ? i.True : i.False;
}
function Oc(r, n) {
  return r.anyOf.every((e) => b(e, n) === i.True) ? i.True : i.False;
}
function No(r, n) {
  return i.True;
}
function Rc(r, n) {
  return Fr(n) ? Po() : Cr(n) ? Bn(r, n) : ar(n) ? xe(r, n) : X(n) ? ye() : Y(n) ? Uo(r) : L(n) ? Co(r) : fr(n) ? So(r) : Pr(n) ? To(r) : Sr(n) ? Wu(r) : Nn(n) ? bc(r) : O(n) ? N(r, n) : Z(n) ? i.True : i.False;
}
function $c(r, n) {
  return yr(r) || yr(r) ? i.True : i.False;
}
function Ic(r, n) {
  return Cr(n) ? Bn(r, n) : ar(n) ? xe(r, n) : Z(n) ? No() : X(n) ? ye() : O(n) ? N(r, n) : Mn(n) ? i.True : i.False;
}
function b(r, n) {
  return (
    // resolvable
    nn(r) || nn(n) ? lc(r, n) : Zr(r) || Zr(n) ? fc(r, n) : Nr(r) || Nr(n) ? Yu(r, n) : (
      // standard
      X(r) ? Eu(r, n) : Sr(r) ? Ku(r, n) : Pn(r) ? Du(r, n) : Pr(r) ? Hu(r, n) : se(r) ? Bu(r, n) : Cn(r) ? Vu(r, n) : jn(r) ? _u(r, n) : Un(r) ? Gu(r, n) : fr(r) ? qu(r, n) : Cr(r) ? zu(r, n) : fe(r) ? Qu(r, n) : gr(r) ? Ju(r, n) : Fr(r) ? Xu() : de(r) ? Zu(r, n) : L(r) ? rc(r, n) : O(r) ? cc(r, n) : P(r) ? sc(r, n) : Y(r) ? dc(r, n) : rn(r) ? mc(r, n) : Nn(r) ? gc(r, n) : me(r) ? ac(r, n) : mn(r) ? Fc(r, n) : yr(r) ? hc(r, n) : ar(r) ? Oc(r, n) : Z(r) ? Rc(r, n) : Mn(r) ? Ic(r, n) : qr(`Unknown left type operand '${r[d]}'`)
    )
  );
}
function bn(r, n) {
  return b(r, n);
}
function yc(r, n, e, t, u) {
  const s = {};
  for (const f of globalThis.Object.getOwnPropertyNames(r))
    s[f] = we(r[f], n, e, t, D(u));
  return s;
}
function xc(r, n, e, t, u) {
  return yc(r.properties, n, e, t, u);
}
function wc(r, n, e, t, u) {
  const s = xc(r, n, e, t, u);
  return j(s);
}
function kc(r, n, e, t) {
  const u = bn(r, n);
  return u === i.Union ? U([e, t]) : u === i.True ? e : t;
}
function we(r, n, e, t, u) {
  return _(r) ? wc(r, n, e, t, u) : Ar(r) ? a(Sc(r, n, e, t, u)) : a(kc(r, n, e, t), u);
}
function Ac(r, n, e, t, u) {
  return {
    [r]: we(y(r), n, e, t, D(u))
  };
}
function vc(r, n, e, t, u) {
  return r.reduce((s, f) => ({ ...s, ...Ac(f, n, e, t, u) }), {});
}
function Tc(r, n, e, t, u) {
  return vc(r.keys, n, e, t, u);
}
function Sc(r, n, e, t, u) {
  const s = Tc(r, n, e, t, u);
  return j(s);
}
function Pc(r, n) {
  return ke(yn(r), n);
}
function Cc(r, n) {
  const e = r.filter((t) => bn(t, n) === i.False);
  return e.length === 1 ? e[0] : U(e);
}
function ke(r, n, e = {}) {
  return vr(r) ? a(Pc(r, n), e) : _(r) ? a(Nc(r, n), e) : a(S(r) ? Cc(r.anyOf, n) : bn(r, n) !== i.False ? w() : r, e);
}
function jc(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = ke(r[t], n);
  return e;
}
function Uc(r, n) {
  return jc(r.properties, n);
}
function Nc(r, n) {
  const e = Uc(r, n);
  return j(e);
}
function Mc(r, n) {
  return Ae(yn(r), n);
}
function Lc(r, n) {
  const e = r.filter((t) => bn(t, n) !== i.False);
  return e.length === 1 ? e[0] : U(e);
}
function Ae(r, n, e) {
  return vr(r) ? a(Mc(r, n), e) : _(r) ? a(Kc(r, n), e) : a(S(r) ? Lc(r.anyOf, n) : bn(r, n) !== i.False ? r : w(), e);
}
function Ec(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = Ae(r[t], n);
  return e;
}
function Wc(r, n) {
  return Ec(r.properties, n);
}
function Kc(r, n) {
  const e = Wc(r, n);
  return j(e);
}
function Bc(r, n) {
  return Br(r) ? a(r.returns, n) : w(n);
}
function Mo(r) {
  return Or(Rr(r));
}
function Ur(r, n, e) {
  return a({ [d]: "Record", type: "object", patternProperties: { [r]: n } }, e);
}
function ve(r, n, e) {
  const t = {};
  for (const u of r)
    t[u] = n;
  return T(t, { ...e, [xn]: "Record" });
}
function Dc(r, n, e) {
  return mi(r) ? ve(hr(r), n, e) : Ur(r.pattern, n, e);
}
function Hc(r, n, e) {
  return ve(hr(U(r)), n, e);
}
function Vc(r, n, e) {
  return ve([r.toString()], n, e);
}
function _c(r, n, e) {
  return Ur(r.source, n, e);
}
function Gc(r, n, e) {
  const t = I(r.pattern) ? Lr : r.pattern;
  return Ur(t, n, e);
}
function qc(r, n, e) {
  return Ur(Lr, n, e);
}
function zc(r, n, e) {
  return Ur(Ht, n, e);
}
function Qc(r, n, e) {
  return T({ true: n, false: n }, e);
}
function Jc(r, n, e) {
  return Ur(Mr, n, e);
}
function Xc(r, n, e) {
  return Ur(Mr, n, e);
}
function Lo(r, n, e = {}) {
  return S(r) ? Hc(r.anyOf, n, e) : vr(r) ? Dc(r, n, e) : kr(r) ? Vc(r.const, n, e) : sn(r) ? Qc(r, n, e) : Hr(r) ? Jc(r, n, e) : Vr(r) ? Xc(r, n, e) : ro(r) ? _c(r, n, e) : dn(r) ? Gc(r, n, e) : Xe(r) ? qc(r, n, e) : fn(r) ? zc(r, n, e) : w(e);
}
function Te(r) {
  return globalThis.Object.getOwnPropertyNames(r.patternProperties)[0];
}
function Yc(r) {
  const n = Te(r);
  return n === Lr ? xr() : n === Mr ? jr() : xr({ pattern: n });
}
function Eo(r) {
  return r.patternProperties[Te(r)];
}
function Zc(r, n) {
  return n.parameters = gn(r, n.parameters), n.returns = rr(r, n.returns), n;
}
function ra(r, n) {
  return n.parameters = gn(r, n.parameters), n.returns = rr(r, n.returns), n;
}
function na(r, n) {
  return n.allOf = gn(r, n.allOf), n;
}
function ea(r, n) {
  return n.anyOf = gn(r, n.anyOf), n;
}
function oa(r, n) {
  return I(n.items) || (n.items = gn(r, n.items)), n;
}
function ta(r, n) {
  return n.items = rr(r, n.items), n;
}
function ia(r, n) {
  return n.items = rr(r, n.items), n;
}
function ua(r, n) {
  return n.items = rr(r, n.items), n;
}
function ca(r, n) {
  return n.item = rr(r, n.item), n;
}
function aa(r, n) {
  const e = ma(r, n.properties);
  return { ...n, ...T(e) };
}
function sa(r, n) {
  const e = rr(r, Yc(n)), t = rr(r, Eo(n)), u = Lo(e, t);
  return { ...n, ...u };
}
function fa(r, n) {
  return n.index in r ? r[n.index] : Kn();
}
function da(r, n) {
  const e = oe(n), t = br(n), u = rr(r, n);
  return e && t ? Mo(u) : e && !t ? Or(u) : !e && t ? Rr(u) : u;
}
function ma(r, n) {
  return globalThis.Object.getOwnPropertyNames(n).reduce((e, t) => ({ ...e, [t]: da(r, n[t]) }), {});
}
function gn(r, n) {
  return n.map((e) => rr(r, e));
}
function rr(r, n) {
  return Br(n) ? Zc(r, n) : Dr(n) ? ra(r, n) : Q(n) ? na(r, n) : S(n) ? ea(r, n) : Tr(n) ? oa(r, n) : Wr(n) ? ta(r, n) : wn(n) ? ia(r, n) : An(n) ? ua(r, n) : vn(n) ? ca(r, n) : nr(n) ? aa(r, n) : Tn(n) ? sa(r, n) : Ye(n) ? fa(r, n) : n;
}
function la(r, n) {
  return rr(n, ee(r));
}
function pa(r) {
  return a({ [d]: "Integer", type: "integer" }, r);
}
function ba(r, n, e) {
  return {
    [r]: zr(y(r), n, D(e))
  };
}
function ga(r, n, e) {
  return r.reduce((u, s) => ({ ...u, ...ba(s, n, e) }), {});
}
function Fa(r, n, e) {
  return ga(r.keys, n, e);
}
function ha(r, n, e) {
  const t = Fa(r, n, e);
  return j(t);
}
function Oa(r) {
  const [n, e] = [r.slice(0, 1), r.slice(1)];
  return [n.toLowerCase(), e].join("");
}
function Ra(r) {
  const [n, e] = [r.slice(0, 1), r.slice(1)];
  return [n.toUpperCase(), e].join("");
}
function $a(r) {
  return r.toUpperCase();
}
function Ia(r) {
  return r.toLowerCase();
}
function ya(r, n, e) {
  const t = Fe(r.pattern);
  if (!tn(t))
    return { ...r, pattern: Wo(r.pattern, n) };
  const f = [...Ln(t)].map((h) => y(h)), m = Ko(f, n), R = U(m);
  return bo([R], e);
}
function Wo(r, n) {
  return typeof r == "string" ? n === "Uncapitalize" ? Oa(r) : n === "Capitalize" ? Ra(r) : n === "Uppercase" ? $a(r) : n === "Lowercase" ? Ia(r) : r : r.toString();
}
function Ko(r, n) {
  return r.map((e) => zr(e, n));
}
function zr(r, n, e = {}) {
  return (
    // Intrinsic-Mapped-Inference
    Ar(r) ? ha(r, n, e) : (
      // Standard-Inference
      vr(r) ? ya(r, n, e) : S(r) ? U(Ko(r.anyOf, n), e) : kr(r) ? y(Wo(r.const, n), e) : (
        // Default Type
        a(r, e)
      )
    )
  );
}
function xa(r, n = {}) {
  return zr(r, "Capitalize", n);
}
function wa(r, n = {}) {
  return zr(r, "Lowercase", n);
}
function ka(r, n = {}) {
  return zr(r, "Uncapitalize", n);
}
function Aa(r, n = {}) {
  return zr(r, "Uppercase", n);
}
function va(r, n, e) {
  const t = {};
  for (const u of globalThis.Object.getOwnPropertyNames(r))
    t[u] = Hn(r[u], n, D(e));
  return t;
}
function Ta(r, n, e) {
  return va(r.properties, n, e);
}
function Sa(r, n, e) {
  const t = Ta(r, n, e);
  return j(t);
}
function Pa(r, n) {
  return r.map((e) => Se(e, n));
}
function Ca(r, n) {
  return r.map((e) => Se(e, n));
}
function ja(r, n) {
  const { [n]: e, ...t } = r;
  return t;
}
function Ua(r, n) {
  return n.reduce((e, t) => ja(e, t), r);
}
function Na(r, n, e) {
  const t = H(r, [q, "$id", "required", "properties"]), u = Ua(e, n);
  return T(u, t);
}
function Ma(r) {
  const n = r.reduce((e, t) => Ze(t) ? [...e, y(t)] : e, []);
  return U(n);
}
function Se(r, n) {
  return Q(r) ? $r(Pa(r.allOf, n)) : S(r) ? U(Ca(r.anyOf, n)) : nr(r) ? Na(r, n, r.properties) : T({});
}
function Hn(r, n, e) {
  const t = K(n) ? Ma(n) : n, u = pr(n) ? hr(n) : n, s = E(r), f = E(n);
  return _(r) ? Sa(r, u, e) : Ar(n) ? Ka(r, n, e) : s && f ? v("Omit", [r, t], e) : !s && f ? v("Omit", [r, t], e) : s && !f ? v("Omit", [r, t], e) : a({ ...Se(r, u), ...e });
}
function La(r, n, e) {
  return { [n]: Hn(r, [n], D(e)) };
}
function Ea(r, n, e) {
  return n.reduce((t, u) => ({ ...t, ...La(r, u, e) }), {});
}
function Wa(r, n, e) {
  return Ea(r, n.keys, e);
}
function Ka(r, n, e) {
  const t = Wa(r, n, e);
  return j(t);
}
function Ba(r, n, e) {
  const t = {};
  for (const u of globalThis.Object.getOwnPropertyNames(r))
    t[u] = Vn(r[u], n, D(e));
  return t;
}
function Da(r, n, e) {
  return Ba(r.properties, n, e);
}
function Ha(r, n, e) {
  const t = Da(r, n, e);
  return j(t);
}
function Va(r, n) {
  return r.map((e) => Pe(e, n));
}
function _a(r, n) {
  return r.map((e) => Pe(e, n));
}
function Ga(r, n) {
  const e = {};
  for (const t of n)
    t in r && (e[t] = r[t]);
  return e;
}
function qa(r, n, e) {
  const t = H(r, [q, "$id", "required", "properties"]), u = Ga(e, n);
  return T(u, t);
}
function za(r) {
  const n = r.reduce((e, t) => Ze(t) ? [...e, y(t)] : e, []);
  return U(n);
}
function Pe(r, n) {
  return Q(r) ? $r(Va(r.allOf, n)) : S(r) ? U(_a(r.anyOf, n)) : nr(r) ? qa(r, n, r.properties) : T({});
}
function Vn(r, n, e) {
  const t = K(n) ? za(n) : n, u = pr(n) ? hr(n) : n, s = E(r), f = E(n);
  return _(r) ? Ha(r, u, e) : Ar(n) ? Ya(r, n, e) : s && f ? v("Pick", [r, t], e) : !s && f ? v("Pick", [r, t], e) : s && !f ? v("Pick", [r, t], e) : a({ ...Pe(r, u), ...e });
}
function Qa(r, n, e) {
  return {
    [n]: Vn(r, [n], D(e))
  };
}
function Ja(r, n, e) {
  return n.reduce((t, u) => ({ ...t, ...Qa(r, u, e) }), {});
}
function Xa(r, n, e) {
  return Ja(r, n.keys, e);
}
function Ya(r, n, e) {
  const t = Xa(r, n, e);
  return j(t);
}
function Za(r, n) {
  return v("Partial", [v(r, n)]);
}
function rs(r) {
  return v("Partial", [pn(r)]);
}
function ns(r) {
  const n = {};
  for (const e of globalThis.Object.getOwnPropertyNames(r))
    n[e] = Rr(r[e]);
  return n;
}
function es(r, n) {
  const e = H(r, [q, "$id", "required", "properties"]), t = ns(n);
  return T(t, e);
}
function qe(r) {
  return r.map((n) => Bo(n));
}
function Bo(r) {
  return (
    // Mappable
    Kr(r) ? Za(r.target, r.parameters) : E(r) ? rs(r.$ref) : Q(r) ? $r(qe(r.allOf)) : S(r) ? U(qe(r.anyOf)) : nr(r) ? es(r, r.properties) : (
      // Intrinsic
      kn(r) || sn(r) || Hr(r) || kr(r) || te(r) || Vr(r) || dn(r) || ie(r) || ue(r) ? r : (
        // Passthrough
        T({})
      )
    )
  );
}
function Ce(r, n) {
  return _(r) ? is(r, n) : a({ ...Bo(r), ...n });
}
function os(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = Ce(r[t], D(n));
  return e;
}
function ts(r, n) {
  return os(r.properties, n);
}
function is(r, n) {
  const e = ts(r, n);
  return j(e);
}
function us(r, n) {
  return v("Required", [v(r, n)]);
}
function cs(r) {
  return v("Required", [pn(r)]);
}
function as(r) {
  const n = {};
  for (const e of globalThis.Object.getOwnPropertyNames(r))
    n[e] = H(r[e], [sr]);
  return n;
}
function ss(r, n) {
  const e = H(r, [q, "$id", "required", "properties"]), t = as(n);
  return T(t, e);
}
function ze(r) {
  return r.map((n) => Do(n));
}
function Do(r) {
  return (
    // Mappable
    Kr(r) ? us(r.target, r.parameters) : E(r) ? cs(r.$ref) : Q(r) ? $r(ze(r.allOf)) : S(r) ? U(ze(r.anyOf)) : nr(r) ? ss(r, r.properties) : (
      // Intrinsic
      kn(r) || sn(r) || Hr(r) || kr(r) || te(r) || Vr(r) || dn(r) || ie(r) || ue(r) ? r : (
        // Passthrough
        T({})
      )
    )
  );
}
function je(r, n) {
  return _(r) ? ms(r, n) : a({ ...Do(r), ...n });
}
function fs(r, n) {
  const e = {};
  for (const t of globalThis.Object.getOwnPropertyNames(r))
    e[t] = je(r[t], n);
  return e;
}
function ds(r, n) {
  return fs(r.properties, n);
}
function ms(r, n) {
  const e = ds(r, n);
  return j(e);
}
function ls(r, n) {
  return n.map((e) => E(e) ? Ue(r, e.$ref) : V(r, e));
}
function Ue(r, n) {
  return n in r ? E(r[n]) ? Ue(r, r[n].$ref) : V(r, r[n]) : w();
}
function ps(r) {
  return Wn(r[0]);
}
function bs(r) {
  return En(r[0], r[1]);
}
function gs(r) {
  return $e(r[0]);
}
function Fs(r) {
  return Ce(r[0]);
}
function hs(r) {
  return Hn(r[0], r[1]);
}
function Os(r) {
  return Vn(r[0], r[1]);
}
function Rs(r) {
  return je(r[0]);
}
function $s(r, n, e) {
  const t = ls(r, e);
  return n === "Awaited" ? ps(t) : n === "Index" ? bs(t) : n === "KeyOf" ? gs(t) : n === "Partial" ? Fs(t) : n === "Omit" ? hs(t) : n === "Pick" ? Os(t) : n === "Required" ? Rs(t) : w();
}
function Is(r, n) {
  return le(V(r, n));
}
function ys(r, n) {
  return pe(V(r, n));
}
function xs(r, n, e) {
  return be(Fn(r, n), V(r, e));
}
function ws(r, n, e) {
  return ln(Fn(r, n), V(r, e));
}
function ks(r, n) {
  return $r(Fn(r, n));
}
function As(r, n) {
  return Oe(V(r, n));
}
function vs(r, n) {
  return T(globalThis.Object.keys(n).reduce((e, t) => ({ ...e, [t]: V(r, n[t]) }), {}));
}
function Ts(r, n) {
  const [e, t] = [V(r, Eo(n)), Te(n)], u = ee(n);
  return u.patternProperties[t] = e, u;
}
function Ss(r, n) {
  return E(n) ? { ...Ue(r, n.$ref), [q]: n[q] } : n;
}
function Ps(r, n) {
  return Gr(Fn(r, n));
}
function Cs(r, n) {
  return U(Fn(r, n));
}
function Fn(r, n) {
  return n.map((e) => V(r, e));
}
function V(r, n) {
  return (
    // Modifiers
    br(n) ? a(V(r, H(n, [sr])), n) : oe(n) ? a(V(r, H(n, [an])), n) : (
      // Transform
      Sn(n) ? a(Ss(r, n), n) : (
        // Types
        Wr(n) ? a(Is(r, n.items), n) : wn(n) ? a(ys(r, n.items), n) : Kr(n) ? a($s(r, n.target, n.parameters)) : Br(n) ? a(xs(r, n.parameters, n.returns), n) : Dr(n) ? a(ws(r, n.parameters, n.returns), n) : Q(n) ? a(ks(r, n.allOf), n) : An(n) ? a(As(r, n.items), n) : nr(n) ? a(vs(r, n.properties), n) : Tn(n) ? a(Ts(r, n)) : Tr(n) ? a(Ps(r, n.items || []), n) : S(n) ? a(Cs(r, n.anyOf), n) : n
      )
    )
  );
}
function js(r, n) {
  return n in r ? V(r, r[n]) : w();
}
function Us(r) {
  return globalThis.Object.getOwnPropertyNames(r).reduce((n, e) => ({ ...n, [e]: js(r, e) }), {});
}
class Ns {
  constructor(n) {
    const e = Us(n), t = this.WithIdentifiers(e);
    this.$defs = t;
  }
  /** `[Json]` Imports a Type by Key. */
  Import(n, e) {
    const t = { ...this.$defs, [n]: a(this.$defs[n], e) };
    return a({ [d]: "Import", $defs: t, $ref: n });
  }
  // prettier-ignore
  WithIdentifiers(n) {
    return globalThis.Object.getOwnPropertyNames(n).reduce((e, t) => ({ ...e, [t]: { ...n[t], $id: t } }), {});
  }
}
function Ms(r) {
  return new Ns(r);
}
function Ls(r, n) {
  return a({ [d]: "Not", not: r }, n);
}
function Es(r, n) {
  return Dr(r) ? Gr(r.parameters, n) : w();
}
let Ws = 0;
function Ks(r, n = {}) {
  I(n.$id) && (n.$id = `T${Ws++}`);
  const e = ee(r({ [d]: "This", $ref: `${n.$id}` }));
  return e.$id = n.$id, a({ [xn]: "Recursive", ...e }, n);
}
function Bs(r, n) {
  const e = $(r) ? new globalThis.RegExp(r) : r;
  return a({ [d]: "RegExp", type: "RegExp", source: e.source, flags: e.flags }, n);
}
function Ds(r) {
  return Q(r) ? r.allOf : S(r) ? r.anyOf : Tr(r) ? r.items ?? [] : [];
}
function Hs(r) {
  return Ds(r);
}
function Vs(r, n) {
  return Dr(r) ? a(r.returns, n) : w(n);
}
class _s {
  constructor(n) {
    this.schema = n;
  }
  Decode(n) {
    return new Gs(this.schema, n);
  }
}
class Gs {
  constructor(n, e) {
    this.schema = n, this.decode = e;
  }
  EncodeTransform(n, e) {
    const s = { Encode: (f) => e[q].Encode(n(f)), Decode: (f) => this.decode(e[q].Decode(f)) };
    return { ...e, [q]: s };
  }
  EncodeSchema(n, e) {
    const t = { Decode: this.decode, Encode: n };
    return { ...e, [q]: t };
  }
  Encode(n) {
    return Sn(this.schema) ? this.EncodeTransform(n, this.schema) : this.EncodeSchema(n, this.schema);
  }
}
function qs(r) {
  return new _s(r);
}
function zs(r = {}) {
  return a({ [d]: r[d] ?? "Unsafe" }, r);
}
function Qs(r) {
  return a({ [d]: "Void", type: "void" }, r);
}
const Js = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Any: en,
  Argument: Jt,
  Array: le,
  AsyncIterator: pe,
  Awaited: Wn,
  BigInt: he,
  Boolean: lo,
  Capitalize: xa,
  Composite: Pu,
  Const: Uu,
  Constructor: be,
  ConstructorParameters: Nu,
  Date: xo,
  Enum: Mu,
  Exclude: ke,
  Extends: we,
  Extract: Ae,
  Function: ln,
  Index: En,
  InstanceType: Bc,
  Instantiate: la,
  Integer: pa,
  Intersect: $r,
  Iterator: Oe,
  KeyOf: $e,
  Literal: y,
  Lowercase: wa,
  Mapped: Zi,
  Module: Ms,
  Never: w,
  Not: Ls,
  Null: wo,
  Number: jr,
  Object: T,
  Omit: Hn,
  Optional: Rr,
  Parameters: Es,
  Partial: Ce,
  Pick: Vn,
  Promise: Oo,
  Readonly: Or,
  ReadonlyOptional: Mo,
  Record: Lo,
  Recursive: Ks,
  Ref: pn,
  RegExp: Bs,
  Required: je,
  Rest: Hs,
  ReturnType: Vs,
  String: xr,
  Symbol: ko,
  TemplateLiteral: bo,
  Transform: qs,
  Tuple: Gr,
  Uint8Array: vo,
  Uncapitalize: ka,
  Undefined: Ao,
  Union: U,
  Unknown: Kn,
  Unsafe: zs,
  Uppercase: Aa,
  Void: Qs
}, Symbol.toStringTag, { value: "Module" })), o = Js, c = o.String({ $id: "Color" }), M = o.String({ $id: "FamilyName" }), ur = o.String({ $id: "FontWeight" }), mr = o.String({ $id: "Length" }), lr = o.String({ $id: "Percentage" }), Yr = o.String({ $id: "BoxShadow" }), Xs = o.String({ $id: "Number" }), Ys = o.String({ $id: "Size" }), dr = o.Union([o.String(), o.Literal("thin"), o.Literal("medium"), o.Literal("thick")], {
  $id: "LineWidth"
}), zn = o.Optional(o.Object({
  columnGap: o.Optional(o.Union([o.Ref(mr), o.Ref(lr)])),
  rowGap: o.Optional(o.Union([o.Ref(mr), o.Ref(lr)])),
  field: o.Optional(o.Object({
    label: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    input: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      backgroundSubdued: o.Optional(o.Ref(c)),
      foreground: o.Optional(o.Ref(c)),
      foregroundSubdued: o.Optional(o.Ref(c)),
      borderColor: o.Optional(o.Ref(c)),
      borderColorHover: o.Optional(o.Ref(c)),
      borderColorFocus: o.Optional(o.Ref(c)),
      boxShadow: o.Optional(o.Ref(Yr)),
      boxShadowHover: o.Optional(o.Ref(Yr)),
      boxShadowFocus: o.Optional(o.Ref(Yr)),
      height: o.Optional(o.Ref(Ys)),
      padding: o.Optional(o.Union([o.Ref(mr), o.Ref(lr)]))
    }))
  }))
})), Zs = o.Object({
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base border styles
  borderRadius: o.Optional(o.Union([o.Ref(mr), o.Ref(lr)])),
  borderWidth: o.Optional(o.Ref(dr)),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base color palette
  foreground: o.Optional(o.Ref(c)),
  foregroundSubdued: o.Optional(o.Ref(c)),
  foregroundAccent: o.Optional(o.Ref(c)),
  background: o.Optional(o.Ref(c)),
  backgroundNormal: o.Optional(o.Ref(c)),
  backgroundAccent: o.Optional(o.Ref(c)),
  backgroundSubdued: o.Optional(o.Ref(c)),
  borderColor: o.Optional(o.Ref(c)),
  borderColorAccent: o.Optional(o.Ref(c)),
  borderColorSubdued: o.Optional(o.Ref(c)),
  primary: o.Optional(o.Ref(c)),
  primaryBackground: o.Optional(o.Ref(c)),
  primarySubdued: o.Optional(o.Ref(c)),
  primaryAccent: o.Optional(o.Ref(c)),
  secondary: o.Optional(o.Ref(c)),
  secondaryBackground: o.Optional(o.Ref(c)),
  secondarySubdued: o.Optional(o.Ref(c)),
  secondaryAccent: o.Optional(o.Ref(c)),
  success: o.Optional(o.Ref(c)),
  successBackground: o.Optional(o.Ref(c)),
  successSubdued: o.Optional(o.Ref(c)),
  successAccent: o.Optional(o.Ref(c)),
  warning: o.Optional(o.Ref(c)),
  warningBackground: o.Optional(o.Ref(c)),
  warningSubdued: o.Optional(o.Ref(c)),
  warningAccent: o.Optional(o.Ref(c)),
  danger: o.Optional(o.Ref(c)),
  dangerBackground: o.Optional(o.Ref(c)),
  dangerSubdued: o.Optional(o.Ref(c)),
  dangerAccent: o.Optional(o.Ref(c)),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base fonts
  fonts: o.Optional(o.Object({
    display: o.Optional(o.Object({
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    sans: o.Optional(o.Object({
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    serif: o.Optional(o.Object({
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    monospace: o.Optional(o.Object({
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    }))
  })),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Scopes
  navigation: o.Optional(o.Object({
    background: o.Optional(o.Ref(c)),
    backgroundAccent: o.Optional(o.Ref(c)),
    borderWidth: o.Optional(o.Ref(dr)),
    borderColor: o.Optional(o.Ref(c)),
    project: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      borderWidth: o.Optional(o.Ref(dr)),
      borderColor: o.Optional(o.Ref(c))
    })),
    modules: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      borderWidth: o.Optional(o.Ref(dr)),
      borderColor: o.Optional(o.Ref(c)),
      button: o.Optional(o.Object({
        foreground: o.Optional(o.Ref(c)),
        foregroundHover: o.Optional(o.Ref(c)),
        foregroundActive: o.Optional(o.Ref(c)),
        background: o.Optional(o.Ref(c)),
        backgroundHover: o.Optional(o.Ref(c)),
        backgroundActive: o.Optional(o.Ref(c))
      }))
    })),
    list: o.Optional(o.Object({
      icon: o.Optional(o.Object({
        foreground: o.Optional(o.Ref(c)),
        foregroundHover: o.Optional(o.Ref(c)),
        foregroundActive: o.Optional(o.Ref(c))
      })),
      foreground: o.Optional(o.Ref(c)),
      foregroundHover: o.Optional(o.Ref(c)),
      foregroundActive: o.Optional(o.Ref(c)),
      background: o.Optional(o.Ref(c)),
      backgroundHover: o.Optional(o.Ref(c)),
      backgroundActive: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      divider: o.Object({
        borderColor: o.Optional(o.Ref(c)),
        borderWidth: o.Optional(o.Ref(dr))
      })
    }))
  })),
  header: o.Optional(o.Object({
    background: o.Optional(o.Ref(c)),
    borderWidth: o.Optional(o.Ref(dr)),
    borderColor: o.Optional(o.Ref(c)),
    boxShadow: o.Optional(o.Ref(Yr)),
    headline: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M))
    })),
    title: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    }))
  })),
  form: zn,
  sidebar: o.Optional(o.Object({
    background: o.Optional(o.Ref(c)),
    foreground: o.Optional(o.Ref(c)),
    fontFamily: o.Optional(o.Ref(M)),
    borderWidth: o.Optional(o.Ref(dr)),
    borderColor: o.Optional(o.Ref(c)),
    section: o.Optional(o.Object({
      toggle: o.Optional(o.Object({
        icon: o.Optional(o.Object({
          foreground: o.Optional(o.Ref(c)),
          foregroundHover: o.Optional(o.Ref(c)),
          foregroundActive: o.Optional(o.Ref(c))
        })),
        foreground: o.Optional(o.Ref(c)),
        foregroundHover: o.Optional(o.Ref(c)),
        foregroundActive: o.Optional(o.Ref(c)),
        background: o.Optional(o.Ref(c)),
        backgroundHover: o.Optional(o.Ref(c)),
        backgroundActive: o.Optional(o.Ref(c)),
        fontFamily: o.Optional(o.Ref(M)),
        borderWidth: o.Optional(o.Ref(dr)),
        borderColor: o.Optional(o.Ref(c))
      })),
      form: zn
    }))
  })),
  public: o.Optional(o.Object({
    background: o.Optional(o.Ref(c)),
    foreground: o.Optional(o.Ref(c)),
    foregroundAccent: o.Optional(o.Ref(c)),
    art: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      primary: o.Optional(o.Ref(c)),
      secondary: o.Optional(o.Ref(c)),
      speed: o.Optional(o.Ref(Xs))
    })),
    form: zn
  })),
  popover: o.Optional(o.Object({
    menu: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      borderRadius: o.Optional(o.Optional(o.Union([o.Ref(mr), o.Ref(lr)]))),
      boxShadow: o.Optional(o.Ref(Yr))
    }))
  })),
  banner: o.Optional(o.Object({
    background: o.Optional(o.Ref(c)),
    padding: o.Optional(o.Union([o.Ref(mr), o.Ref(lr)])),
    borderRadius: o.Optional(o.Optional(o.Union([o.Ref(mr), o.Ref(lr)]))),
    avatar: o.Optional(o.Object({
      background: o.Optional(o.Ref(c)),
      foreground: o.Optional(o.Ref(c)),
      borderRadius: o.Optional(o.Optional(o.Union([o.Ref(mr), o.Ref(lr)])))
    })),
    headline: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    title: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    subtitle: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c)),
      fontFamily: o.Optional(o.Ref(M)),
      fontWeight: o.Optional(o.Ref(ur))
    })),
    art: o.Optional(o.Object({
      foreground: o.Optional(o.Ref(c))
    }))
  }))
}), rf = o.Object({
  id: o.String(),
  name: o.String(),
  appearance: o.Union([o.Literal("light"), o.Literal("dark")]),
  rules: Zs
}), nf = (r) => {
  const n = Ir(() => {
    const u = /* @__PURE__ */ new Map(), s = (f, m = []) => {
      for (const [R, h] of Object.entries(f))
        typeof h == "object" && h !== null && ("type" in h && h.type === "object" && "properties" in h && s(h.properties, [...m, R]), "$ref" in h && h.$ref === "FamilyName" && (u.has(m) ? u.set(m, { family: R, weight: u.get(m).weight }) : u.set(m, { family: R, weight: null })), "$ref" in h && h.$ref === "FontWeight" && (u.has(m) ? u.set(m, { family: u.get(m).family, weight: R }) : u.set(m, { family: null, weight: R })));
    };
    return s(rf.properties.rules.properties), u;
  }), e = Ir(() => {
    const u = /* @__PURE__ */ new Map();
    for (const [s, { family: f, weight: m }] of n.value.entries()) {
      let R = null, h = null;
      if (f && (R = Le(B(r).rules, [...s, f])), m && (h = Le(B(r).rules, [...s, m])), R) {
        const er = R.split(",");
        for (const or of er) {
          const tr = or.trim();
          if (tr.startsWith("var(--")) {
            er.push(ot(tr.slice(6, -1)));
            continue;
          }
          if ((tr.startsWith('"') && tr.endsWith('"')) === !1)
            continue;
          const Qr = tr.slice(1, -1);
          u.has(Qr) ? u.get(Qr).add(h ?? "400") : u.set(Qr, /* @__PURE__ */ new Set([h ?? "400"]));
        }
      }
    }
    return u;
  });
  return { googleFonts: Ir(() => {
    const u = [];
    for (const [s, f] of e.value.entries())
      if (["Inter", "Merriweather", "Fira Mono"].includes(s) === !1) {
        const R = Array.from(f).sort((h, er) => Number(h) - Number(er)).join(";");
        u.push(`${s.replaceAll(" ", "+")}:wght@${R}`);
      }
    return u;
  }) };
}, _n = (r) => r, Ne = _n({
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
        fontFamily: '"Inter", system-ui',
        fontWeight: "700"
      },
      sans: {
        fontFamily: '"Inter", system-ui',
        fontWeight: "500"
      },
      serif: {
        fontFamily: '"Merriweather", serif',
        fontWeight: "500"
      },
      monospace: {
        fontFamily: '"Fira Mono", monospace',
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
          field: {
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
              height: "52px",
              padding: "12px"
            }
          }
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
    popover: {
      menu: {
        background: "#161b22",
        borderRadius: "var(--theme--border-radius)",
        boxShadow: "0px 0px 6px 0px black"
      }
    },
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
      art: {
        foreground: "#2e3a4d"
      }
    }
  }
}), ef = _n({
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
    fonts: {
      display: {
        fontFamily: '"Montserrat", system-ui',
        fontWeight: "400"
      }
    },
    form: {
      field: {
        input: { background: "#FFFFFF", backgroundSubdued: "color-mix(in srgb, #FFFFFF, var(--theme--primary) 13%)" }
      }
    },
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
      project: { borderWidth: "1px", background: "#FFFFFF", borderColor: "var(--theme--border-color-subdued)" },
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
      section: {
        toggle: {
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
        }
      }
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
}), Me = _n({
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
        fontFamily: '"Inter", system-ui',
        fontWeight: "700"
      },
      sans: {
        fontFamily: '"Inter", system-ui',
        fontWeight: "500"
      },
      serif: {
        fontFamily: '"Merriweather", serif',
        fontWeight: "500"
      },
      monospace: {
        fontFamily: '"Fira Mono", monospace',
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
          field: {
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
              height: "52px",
              padding: "12px"
            }
          }
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
        field: {
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
    popover: {
      menu: {
        background: "#fafcfd",
        borderRadius: "var(--theme--border-radius)",
        boxShadow: "0px 0px 6px 0px rgb(23, 41, 64, 0.2), 0px 0px 12px 2px rgb(23, 41, 64, 0.05)"
      }
    },
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
      art: {
        foreground: "#2e3a4d"
      }
    }
  }
}), of = _n({
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
        icon: {
          foreground: "#0F172A"
        },
        divider: {
          borderColor: "var(--theme--border-color)"
        }
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
      field: {
        input: {
          background: "#FFFFFF",
          backgroundSubdued: "#F8FAFC",
          boxShadowFocus: "none",
          height: "52px"
        }
      }
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
        form: {
          field: {
            input: {
              height: "42px"
            }
          }
        }
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
    fonts: {
      display: {
        fontFamily: "system-ui"
      }
    }
  }
}), tf = [Ne], uf = [Me, of, ef], cf = Zo("🎨 Themes", () => {
  const r = Ho({ light: uf, dark: tf });
  return { themes: r, registerTheme: (e) => {
    e.appearance === "light" ? r.light.push(e) : r.dark.push(e);
  } };
}), af = (r, n, e, t, u) => {
  const { themes: s } = rt(cf());
  return { theme: Ir(() => {
    const m = B(r) ? B(e) : B(n), R = B(r) ? Ne : Me, h = B(r) ? B(u) : B(t), er = B(s)[B(r) ? "dark" : "light"].find((or) => or.id === m);
    return er ? h ? Gn({}, R, er, { rules: h }) : Gn(R, er) : (m && m !== R.id && console.warn(`Theme "${m}" doesn't exist.`), h ? Gn({}, R, { rules: h }) : R);
  }) };
}, sf = (r) => {
  const n = et(r, { delimiter: "--" }), e = (t) => `--theme--${nt(t, { separator: "-" })}`;
  return Yo(n, (t, u) => e(u));
}, Ff = /* @__PURE__ */ Vo({
  __name: "theme-provider",
  props: {
    darkMode: { type: Boolean },
    themeLight: { default: Me.name },
    themeLightOverrides: { default: () => ({}) },
    themeDark: { default: Ne.name },
    themeDarkOverrides: { default: () => ({}) }
  },
  setup(r) {
    const n = r, { darkMode: e, themeLight: t, themeDark: u, themeLightOverrides: s, themeDarkOverrides: f } = _o(n), { theme: m } = af(e, t, u, s, f), R = Ir(() => sf(B(m).rules)), { googleFonts: h } = nf(m);
    Xo({
      link: Ir(() => {
        let or = "";
        if (h.value.length > 0) {
          const tr = h.value.join("&family=");
          or += `https://fonts.googleapis.com/css2?family=${tr}`, or += `
`;
        }
        return or ? [
          {
            rel: "stylesheet",
            href: or
          }
        ] : [];
      })
    });
    const er = Ir(() => `:root {${Object.entries(B(R)).map(([tr, Qr]) => `${tr}: ${Qr};`).join(" ")}}`);
    return (or, tr) => (Go(), qo(zo, { to: "#theme" }, [
      Qo(Jo(er.value), 1)
    ]));
  }
});
export {
  Ff as ThemeProvider,
  _n as defineTheme,
  sf as rulesToCssVars,
  nf as useFonts,
  af as useTheme,
  cf as useThemeStore
};
