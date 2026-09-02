import { computed as Ve, unref as ae, reactive as eu, defineComponent as nu, toRefs as ru, openBlock as tu, createBlock as ou, Teleport as iu, createTextVNode as uu, toDisplayString as cu } from "vue";
import { useHead as su } from "@unhead/vue";
import { get as Ht, merge as Lr, mapKeys as au } from "lodash-es";
import { defineStore as fu, storeToRefs as du } from "pinia";
import lu from "decamelize";
import { flatten as mu } from "flat";
import { cssVar as pu } from "@directus/utils/browser";
var Gt;
function d(e, n, r) {
  function t(s, a) {
    if (s._zod || Object.defineProperty(s, "_zod", {
      value: {
        def: a,
        constr: c,
        traits: /* @__PURE__ */ new Set()
      },
      enumerable: !1
    }), s._zod.traits.has(e))
      return;
    s._zod.traits.add(e), n(s, a);
    const l = c.prototype, m = Object.keys(l);
    for (let h = 0; h < m.length; h++) {
      const b = m[h];
      b in s || (s[b] = l[b].bind(s));
    }
  }
  const o = (r == null ? void 0 : r.Parent) ?? Object;
  class u extends o {
  }
  Object.defineProperty(u, "name", { value: e });
  function c(s) {
    var a;
    const l = r != null && r.Parent ? new u() : this;
    t(l, s), (a = l._zod).deferred ?? (a.deferred = []);
    for (const m of l._zod.deferred)
      m();
    return l;
  }
  return Object.defineProperty(c, "init", { value: t }), Object.defineProperty(c, Symbol.hasInstance, {
    value: (s) => {
      var a, l;
      return r != null && r.Parent && s instanceof r.Parent ? !0 : (l = (a = s == null ? void 0 : s._zod) == null ? void 0 : a.traits) == null ? void 0 : l.has(e);
    }
  }), Object.defineProperty(c, "name", { value: e }), c;
}
class dn extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}
class xo extends Error {
  constructor(n) {
    super(`Encountered unidirectional transform during encode: ${n}`), this.name = "ZodEncodeError";
  }
}
(Gt = globalThis).__zod_globalConfig ?? (Gt.__zod_globalConfig = {});
const rt = globalThis.__zod_globalConfig;
function Je(e) {
  return rt;
}
function To(e) {
  const n = Object.values(e).filter((t) => typeof t == "number");
  return Object.entries(e).filter(([t, o]) => n.indexOf(+t) === -1).map(([t, o]) => o);
}
function Vr(e, n) {
  return typeof n == "bigint" ? n.toString() : n;
}
function tt(e) {
  return {
    get value() {
      {
        const n = e();
        return Object.defineProperty(this, "value", { value: n }), n;
      }
    }
  };
}
function ot(e) {
  return e == null;
}
function it(e) {
  const n = e.startsWith("^") ? 1 : 0, r = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(n, r);
}
function hu(e, n) {
  const r = e / n, t = Math.round(r), o = Number.EPSILON * Math.max(Math.abs(r), 1);
  return Math.abs(r - t) < o ? 0 : r - t;
}
const qt = /* @__PURE__ */ Symbol("evaluating");
function k(e, n, r) {
  let t;
  Object.defineProperty(e, n, {
    get() {
      if (t !== qt)
        return t === void 0 && (t = qt, t = r()), t;
    },
    set(o) {
      Object.defineProperty(e, n, {
        value: o
        // configurable: true,
      });
    },
    configurable: !0
  });
}
function Ye(e, n, r) {
  Object.defineProperty(e, n, {
    value: r,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function Ee(...e) {
  const n = {};
  for (const r of e) {
    const t = Object.getOwnPropertyDescriptors(r);
    Object.assign(n, t);
  }
  return Object.defineProperties({}, n);
}
function Yt(e) {
  return JSON.stringify(e);
}
function gu(e) {
  return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const Po = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function sr(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const bu = /* @__PURE__ */ tt(() => {
  var e;
  if (rt.jitless || typeof navigator < "u" && ((e = navigator == null ? void 0 : navigator.userAgent) != null && e.includes("Cloudflare")))
    return !1;
  try {
    const n = Function;
    return new n(""), !0;
  } catch {
    return !1;
  }
});
function jn(e) {
  if (sr(e) === !1)
    return !1;
  const n = e.constructor;
  if (n === void 0 || typeof n != "function")
    return !0;
  const r = n.prototype;
  return !(sr(r) === !1 || Object.prototype.hasOwnProperty.call(r, "isPrototypeOf") === !1);
}
function Zo(e) {
  return jn(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
const Fu = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function mn(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Ne(e, n, r) {
  const t = new e._zod.constr(n ?? e._zod.def);
  return (!n || r != null && r.parent) && (t._zod.parent = e), t;
}
function _(e) {
  const n = e;
  if (!n)
    return {};
  if (typeof n == "string")
    return { error: () => n };
  if ((n == null ? void 0 : n.message) !== void 0) {
    if ((n == null ? void 0 : n.error) !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    n.error = n.message;
  }
  return delete n.message, typeof n.error == "string" ? { ...n, error: () => n.error } : n;
}
function _u(e) {
  return Object.keys(e).filter((n) => e[n]._zod.optin === "optional" && e[n]._zod.optout === "optional");
}
const Ou = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function vu(e, n) {
  const r = e._zod.def, t = r.checks;
  if (t && t.length > 0)
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  const u = Ee(e._zod.def, {
    get shape() {
      const c = {};
      for (const s in n) {
        if (!(s in r.shape))
          throw new Error(`Unrecognized key: "${s}"`);
        n[s] && (c[s] = r.shape[s]);
      }
      return Ye(this, "shape", c), c;
    },
    checks: []
  });
  return Ne(e, u);
}
function yu(e, n) {
  const r = e._zod.def, t = r.checks;
  if (t && t.length > 0)
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  const u = Ee(e._zod.def, {
    get shape() {
      const c = { ...e._zod.def.shape };
      for (const s in n) {
        if (!(s in r.shape))
          throw new Error(`Unrecognized key: "${s}"`);
        n[s] && delete c[s];
      }
      return Ye(this, "shape", c), c;
    },
    checks: []
  });
  return Ne(e, u);
}
function $u(e, n) {
  if (!jn(n))
    throw new Error("Invalid input to extend: expected a plain object");
  const r = e._zod.def.checks;
  if (r && r.length > 0) {
    const u = e._zod.def.shape;
    for (const c in n)
      if (Object.getOwnPropertyDescriptor(u, c) !== void 0)
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
  }
  const o = Ee(e._zod.def, {
    get shape() {
      const u = { ...e._zod.def.shape, ...n };
      return Ye(this, "shape", u), u;
    }
  });
  return Ne(e, o);
}
function wu(e, n) {
  if (!jn(n))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  const r = Ee(e._zod.def, {
    get shape() {
      const t = { ...e._zod.def.shape, ...n };
      return Ye(this, "shape", t), t;
    }
  });
  return Ne(e, r);
}
function ku(e, n) {
  var t;
  if ((t = e._zod.def.checks) != null && t.length)
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  const r = Ee(e._zod.def, {
    get shape() {
      const o = { ...e._zod.def.shape, ...n._zod.def.shape };
      return Ye(this, "shape", o), o;
    },
    get catchall() {
      return n._zod.def.catchall;
    },
    checks: n._zod.def.checks ?? []
  });
  return Ne(e, r);
}
function Iu(e, n, r) {
  const o = n._zod.def.checks;
  if (o && o.length > 0)
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  const c = Ee(n._zod.def, {
    get shape() {
      const s = n._zod.def.shape, a = { ...s };
      if (r)
        for (const l in r) {
          if (!(l in s))
            throw new Error(`Unrecognized key: "${l}"`);
          r[l] && (a[l] = e ? new e({
            type: "optional",
            innerType: s[l]
          }) : s[l]);
        }
      else
        for (const l in s)
          a[l] = e ? new e({
            type: "optional",
            innerType: s[l]
          }) : s[l];
      return Ye(this, "shape", a), a;
    },
    checks: []
  });
  return Ne(n, c);
}
function Ru(e, n, r) {
  const t = Ee(n._zod.def, {
    get shape() {
      const o = n._zod.def.shape, u = { ...o };
      if (r)
        for (const c in r) {
          if (!(c in u))
            throw new Error(`Unrecognized key: "${c}"`);
          r[c] && (u[c] = new e({
            type: "nonoptional",
            innerType: o[c]
          }));
        }
      else
        for (const c in o)
          u[c] = new e({
            type: "nonoptional",
            innerType: o[c]
          });
      return Ye(this, "shape", u), u;
    }
  });
  return Ne(n, t);
}
function fn(e, n = 0) {
  var r;
  if (e.aborted === !0)
    return !0;
  for (let t = n; t < e.issues.length; t++)
    if (((r = e.issues[t]) == null ? void 0 : r.continue) !== !0)
      return !0;
  return !1;
}
function zu(e, n = 0) {
  var r;
  if (e.aborted === !0)
    return !0;
  for (let t = n; t < e.issues.length; t++)
    if (((r = e.issues[t]) == null ? void 0 : r.continue) === !1)
      return !0;
  return !1;
}
function jo(e, n) {
  return n.map((r) => {
    var t;
    return (t = r).path ?? (t.path = []), r.path.unshift(e), r;
  });
}
function tr(e) {
  return typeof e == "string" ? e : e == null ? void 0 : e.message;
}
function He(e, n, r) {
  var a, l, m, h, b, F;
  const t = e.message ? e.message : tr((m = (l = (a = e.inst) == null ? void 0 : a._zod.def) == null ? void 0 : l.error) == null ? void 0 : m.call(l, e)) ?? tr((h = n == null ? void 0 : n.error) == null ? void 0 : h.call(n, e)) ?? tr((b = r.customError) == null ? void 0 : b.call(r, e)) ?? tr((F = r.localeError) == null ? void 0 : F.call(r, e)) ?? "Invalid input", { inst: o, continue: u, input: c, ...s } = e;
  return s.path ?? (s.path = []), s.message = t, n != null && n.reportInput && (s.input = c), s;
}
function ut(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function En(...e) {
  const [n, r, t] = e;
  return typeof n == "string" ? {
    message: n,
    code: "custom",
    input: r,
    inst: t
  } : { ...n };
}
const Eo = (e, n) => {
  e.name = "$ZodError", Object.defineProperty(e, "_zod", {
    value: e._zod,
    enumerable: !1
  }), Object.defineProperty(e, "issues", {
    value: n,
    enumerable: !1
  }), e.message = JSON.stringify(n, Vr, 2), Object.defineProperty(e, "toString", {
    value: () => e.message,
    enumerable: !1
  });
}, No = d("$ZodError", Eo), Co = d("$ZodError", Eo, { Parent: Error });
function Su(e, n = (r) => r.message) {
  const r = {}, t = [];
  for (const o of e.issues)
    o.path.length > 0 ? (r[o.path[0]] = r[o.path[0]] || [], r[o.path[0]].push(n(o))) : t.push(n(o));
  return { formErrors: t, fieldErrors: r };
}
function Au(e, n = (r) => r.message) {
  const r = { _errors: [] }, t = (o, u = []) => {
    for (const c of o.issues)
      if (c.code === "invalid_union" && c.errors.length)
        c.errors.map((s) => t({ issues: s }, [...u, ...c.path]));
      else if (c.code === "invalid_key")
        t({ issues: c.issues }, [...u, ...c.path]);
      else if (c.code === "invalid_element")
        t({ issues: c.issues }, [...u, ...c.path]);
      else {
        const s = [...u, ...c.path];
        if (s.length === 0)
          r._errors.push(n(c));
        else {
          let a = r, l = 0;
          for (; l < s.length; ) {
            const m = s[l];
            l === s.length - 1 ? (a[m] = a[m] || { _errors: [] }, a[m]._errors.push(n(c))) : a[m] = a[m] || { _errors: [] }, a = a[m], l++;
          }
        }
      }
  };
  return t(e), r;
}
const ct = (e) => (n, r, t, o) => {
  const u = t ? { ...t, async: !1 } : { async: !1 }, c = n._zod.run({ value: r, issues: [] }, u);
  if (c instanceof Promise)
    throw new dn();
  if (c.issues.length) {
    const s = new ((o == null ? void 0 : o.Err) ?? e)(c.issues.map((a) => He(a, u, Je())));
    throw Po(s, o == null ? void 0 : o.callee), s;
  }
  return c.value;
}, st = (e) => async (n, r, t, o) => {
  const u = t ? { ...t, async: !0 } : { async: !0 };
  let c = n._zod.run({ value: r, issues: [] }, u);
  if (c instanceof Promise && (c = await c), c.issues.length) {
    const s = new ((o == null ? void 0 : o.Err) ?? e)(c.issues.map((a) => He(a, u, Je())));
    throw Po(s, o == null ? void 0 : o.callee), s;
  }
  return c.value;
}, gr = (e) => (n, r, t) => {
  const o = t ? { ...t, async: !1 } : { async: !1 }, u = n._zod.run({ value: r, issues: [] }, o);
  if (u instanceof Promise)
    throw new dn();
  return u.issues.length ? {
    success: !1,
    error: new (e ?? No)(u.issues.map((c) => He(c, o, Je())))
  } : { success: !0, data: u.value };
}, xu = /* @__PURE__ */ gr(Co), br = (e) => async (n, r, t) => {
  const o = t ? { ...t, async: !0 } : { async: !0 };
  let u = n._zod.run({ value: r, issues: [] }, o);
  return u instanceof Promise && (u = await u), u.issues.length ? {
    success: !1,
    error: new e(u.issues.map((c) => He(c, o, Je())))
  } : { success: !0, data: u.value };
}, Tu = /* @__PURE__ */ br(Co), Pu = (e) => (n, r, t) => {
  const o = t ? { ...t, direction: "backward" } : { direction: "backward" };
  return ct(e)(n, r, o);
}, Zu = (e) => (n, r, t) => ct(e)(n, r, t), ju = (e) => async (n, r, t) => {
  const o = t ? { ...t, direction: "backward" } : { direction: "backward" };
  return st(e)(n, r, o);
}, Eu = (e) => async (n, r, t) => st(e)(n, r, t), Nu = (e) => (n, r, t) => {
  const o = t ? { ...t, direction: "backward" } : { direction: "backward" };
  return gr(e)(n, r, o);
}, Cu = (e) => (n, r, t) => gr(e)(n, r, t), Uu = (e) => async (n, r, t) => {
  const o = t ? { ...t, direction: "backward" } : { direction: "backward" };
  return br(e)(n, r, o);
}, Mu = (e) => async (n, r, t) => br(e)(n, r, t), Lu = /^[cC][0-9a-z]{6,}$/, Du = /^[0-9a-z]+$/, Wu = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, Bu = /^[0-9a-vA-V]{20}$/, Ku = /^[A-Za-z0-9]{27}$/, Vu = /^[a-zA-Z0-9_-]{21}$/, Ju = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Hu = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Xt = (e) => e ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Gu = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, qu = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function Yu() {
  return new RegExp(qu, "u");
}
const Xu = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Qu = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, ec = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, nc = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, rc = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, Uo = /^[A-Za-z0-9_-]*$/, tc = /^https?$/, oc = /^\+[1-9]\d{6,14}$/, Mo = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", ic = /* @__PURE__ */ new RegExp(`^${Mo}$`);
function Lo(e) {
  const n = "(?:[01]\\d|2[0-3]):[0-5]\\d";
  return typeof e.precision == "number" ? e.precision === -1 ? `${n}` : e.precision === 0 ? `${n}:[0-5]\\d` : `${n}:[0-5]\\d\\.\\d{${e.precision}}` : `${n}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function uc(e) {
  return new RegExp(`^${Lo(e)}$`);
}
function cc(e) {
  const n = Lo({ precision: e.precision }), r = ["Z"];
  e.local && r.push(""), e.offset && r.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  const t = `${n}(?:${r.join("|")})`;
  return new RegExp(`^${Mo}T(?:${t})$`);
}
const sc = (e) => {
  const n = e ? `[\\s\\S]{${(e == null ? void 0 : e.minimum) ?? 0},${(e == null ? void 0 : e.maximum) ?? ""}}` : "[\\s\\S]*";
  return new RegExp(`^${n}$`);
}, ac = /^-?\d+$/, fc = /^-?\d+(?:\.\d+)?$/, dc = /^(?:true|false)$/i, lc = /^[^A-Z]*$/, mc = /^[^a-z]*$/, ce = /* @__PURE__ */ d("$ZodCheck", (e, n) => {
  var r;
  e._zod ?? (e._zod = {}), e._zod.def = n, (r = e._zod).onattach ?? (r.onattach = []);
}), Do = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, Wo = /* @__PURE__ */ d("$ZodCheckLessThan", (e, n) => {
  ce.init(e, n);
  const r = Do[typeof n.value];
  e._zod.onattach.push((t) => {
    const o = t._zod.bag, u = (n.inclusive ? o.maximum : o.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    n.value < u && (n.inclusive ? o.maximum = n.value : o.exclusiveMaximum = n.value);
  }), e._zod.check = (t) => {
    (n.inclusive ? t.value <= n.value : t.value < n.value) || t.issues.push({
      origin: r,
      code: "too_big",
      maximum: typeof n.value == "object" ? n.value.getTime() : n.value,
      input: t.value,
      inclusive: n.inclusive,
      inst: e,
      continue: !n.abort
    });
  };
}), Bo = /* @__PURE__ */ d("$ZodCheckGreaterThan", (e, n) => {
  ce.init(e, n);
  const r = Do[typeof n.value];
  e._zod.onattach.push((t) => {
    const o = t._zod.bag, u = (n.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    n.value > u && (n.inclusive ? o.minimum = n.value : o.exclusiveMinimum = n.value);
  }), e._zod.check = (t) => {
    (n.inclusive ? t.value >= n.value : t.value > n.value) || t.issues.push({
      origin: r,
      code: "too_small",
      minimum: typeof n.value == "object" ? n.value.getTime() : n.value,
      input: t.value,
      inclusive: n.inclusive,
      inst: e,
      continue: !n.abort
    });
  };
}), pc = /* @__PURE__ */ d("$ZodCheckMultipleOf", (e, n) => {
  ce.init(e, n), e._zod.onattach.push((r) => {
    var t;
    (t = r._zod.bag).multipleOf ?? (t.multipleOf = n.value);
  }), e._zod.check = (r) => {
    if (typeof r.value != typeof n.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof r.value == "bigint" ? r.value % n.value === BigInt(0) : hu(r.value, n.value) === 0) || r.issues.push({
      origin: typeof r.value,
      code: "not_multiple_of",
      divisor: n.value,
      input: r.value,
      inst: e,
      continue: !n.abort
    });
  };
}), hc = /* @__PURE__ */ d("$ZodCheckNumberFormat", (e, n) => {
  var c;
  ce.init(e, n), n.format = n.format || "float64";
  const r = (c = n.format) == null ? void 0 : c.includes("int"), t = r ? "int" : "number", [o, u] = Ou[n.format];
  e._zod.onattach.push((s) => {
    const a = s._zod.bag;
    a.format = n.format, a.minimum = o, a.maximum = u, r && (a.pattern = ac);
  }), e._zod.check = (s) => {
    const a = s.value;
    if (r) {
      if (!Number.isInteger(a)) {
        s.issues.push({
          expected: t,
          format: n.format,
          code: "invalid_type",
          continue: !1,
          input: a,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(a)) {
        a > 0 ? s.issues.push({
          input: a,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: t,
          inclusive: !0,
          continue: !n.abort
        }) : s.issues.push({
          input: a,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: t,
          inclusive: !0,
          continue: !n.abort
        });
        return;
      }
    }
    a < o && s.issues.push({
      origin: "number",
      input: a,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !n.abort
    }), a > u && s.issues.push({
      origin: "number",
      input: a,
      code: "too_big",
      maximum: u,
      inclusive: !0,
      inst: e,
      continue: !n.abort
    });
  };
}), gc = /* @__PURE__ */ d("$ZodCheckMaxLength", (e, n) => {
  var r;
  ce.init(e, n), (r = e._zod.def).when ?? (r.when = (t) => {
    const o = t.value;
    return !ot(o) && o.length !== void 0;
  }), e._zod.onattach.push((t) => {
    const o = t._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    n.maximum < o && (t._zod.bag.maximum = n.maximum);
  }), e._zod.check = (t) => {
    const o = t.value;
    if (o.length <= n.maximum)
      return;
    const c = ut(o);
    t.issues.push({
      origin: c,
      code: "too_big",
      maximum: n.maximum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !n.abort
    });
  };
}), bc = /* @__PURE__ */ d("$ZodCheckMinLength", (e, n) => {
  var r;
  ce.init(e, n), (r = e._zod.def).when ?? (r.when = (t) => {
    const o = t.value;
    return !ot(o) && o.length !== void 0;
  }), e._zod.onattach.push((t) => {
    const o = t._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    n.minimum > o && (t._zod.bag.minimum = n.minimum);
  }), e._zod.check = (t) => {
    const o = t.value;
    if (o.length >= n.minimum)
      return;
    const c = ut(o);
    t.issues.push({
      origin: c,
      code: "too_small",
      minimum: n.minimum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !n.abort
    });
  };
}), Fc = /* @__PURE__ */ d("$ZodCheckLengthEquals", (e, n) => {
  var r;
  ce.init(e, n), (r = e._zod.def).when ?? (r.when = (t) => {
    const o = t.value;
    return !ot(o) && o.length !== void 0;
  }), e._zod.onattach.push((t) => {
    const o = t._zod.bag;
    o.minimum = n.length, o.maximum = n.length, o.length = n.length;
  }), e._zod.check = (t) => {
    const o = t.value, u = o.length;
    if (u === n.length)
      return;
    const c = ut(o), s = u > n.length;
    t.issues.push({
      origin: c,
      ...s ? { code: "too_big", maximum: n.length } : { code: "too_small", minimum: n.length },
      inclusive: !0,
      exact: !0,
      input: t.value,
      inst: e,
      continue: !n.abort
    });
  };
}), Fr = /* @__PURE__ */ d("$ZodCheckStringFormat", (e, n) => {
  var r, t;
  ce.init(e, n), e._zod.onattach.push((o) => {
    const u = o._zod.bag;
    u.format = n.format, n.pattern && (u.patterns ?? (u.patterns = /* @__PURE__ */ new Set()), u.patterns.add(n.pattern));
  }), n.pattern ? (r = e._zod).check ?? (r.check = (o) => {
    n.pattern.lastIndex = 0, !n.pattern.test(o.value) && o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: n.format,
      input: o.value,
      ...n.pattern ? { pattern: n.pattern.toString() } : {},
      inst: e,
      continue: !n.abort
    });
  }) : (t = e._zod).check ?? (t.check = () => {
  });
}), _c = /* @__PURE__ */ d("$ZodCheckRegex", (e, n) => {
  Fr.init(e, n), e._zod.check = (r) => {
    n.pattern.lastIndex = 0, !n.pattern.test(r.value) && r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: r.value,
      pattern: n.pattern.toString(),
      inst: e,
      continue: !n.abort
    });
  };
}), Oc = /* @__PURE__ */ d("$ZodCheckLowerCase", (e, n) => {
  n.pattern ?? (n.pattern = lc), Fr.init(e, n);
}), vc = /* @__PURE__ */ d("$ZodCheckUpperCase", (e, n) => {
  n.pattern ?? (n.pattern = mc), Fr.init(e, n);
}), yc = /* @__PURE__ */ d("$ZodCheckIncludes", (e, n) => {
  ce.init(e, n);
  const r = mn(n.includes), t = new RegExp(typeof n.position == "number" ? `^.{${n.position}}${r}` : r);
  n.pattern = t, e._zod.onattach.push((o) => {
    const u = o._zod.bag;
    u.patterns ?? (u.patterns = /* @__PURE__ */ new Set()), u.patterns.add(t);
  }), e._zod.check = (o) => {
    o.value.includes(n.includes, n.position) || o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: n.includes,
      input: o.value,
      inst: e,
      continue: !n.abort
    });
  };
}), $c = /* @__PURE__ */ d("$ZodCheckStartsWith", (e, n) => {
  ce.init(e, n);
  const r = new RegExp(`^${mn(n.prefix)}.*`);
  n.pattern ?? (n.pattern = r), e._zod.onattach.push((t) => {
    const o = t._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(r);
  }), e._zod.check = (t) => {
    t.value.startsWith(n.prefix) || t.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: n.prefix,
      input: t.value,
      inst: e,
      continue: !n.abort
    });
  };
}), wc = /* @__PURE__ */ d("$ZodCheckEndsWith", (e, n) => {
  ce.init(e, n);
  const r = new RegExp(`.*${mn(n.suffix)}$`);
  n.pattern ?? (n.pattern = r), e._zod.onattach.push((t) => {
    const o = t._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(r);
  }), e._zod.check = (t) => {
    t.value.endsWith(n.suffix) || t.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: n.suffix,
      input: t.value,
      inst: e,
      continue: !n.abort
    });
  };
}), kc = /* @__PURE__ */ d("$ZodCheckOverwrite", (e, n) => {
  ce.init(e, n), e._zod.check = (r) => {
    r.value = n.tx(r.value);
  };
});
class Ic {
  constructor(n = []) {
    this.content = [], this.indent = 0, this && (this.args = n);
  }
  indented(n) {
    this.indent += 1, n(this), this.indent -= 1;
  }
  write(n) {
    if (typeof n == "function") {
      n(this, { execution: "sync" }), n(this, { execution: "async" });
      return;
    }
    const t = n.split(`
`).filter((c) => c), o = Math.min(...t.map((c) => c.length - c.trimStart().length)), u = t.map((c) => c.slice(o)).map((c) => " ".repeat(this.indent * 2) + c);
    for (const c of u)
      this.content.push(c);
  }
  compile() {
    const n = Function, r = this == null ? void 0 : this.args, o = [...((this == null ? void 0 : this.content) ?? [""]).map((u) => `  ${u}`)];
    return new n(...r, o.join(`
`));
  }
}
const Rc = {
  major: 4,
  minor: 4,
  patch: 3
}, T = /* @__PURE__ */ d("$ZodType", (e, n) => {
  var o;
  var r;
  e ?? (e = {}), e._zod.def = n, e._zod.bag = e._zod.bag || {}, e._zod.version = Rc;
  const t = [...e._zod.def.checks ?? []];
  e._zod.traits.has("$ZodCheck") && t.unshift(e);
  for (const u of t)
    for (const c of u._zod.onattach)
      c(e);
  if (t.length === 0)
    (r = e._zod).deferred ?? (r.deferred = []), (o = e._zod.deferred) == null || o.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const u = (s, a, l) => {
      let m = fn(s), h;
      for (const b of a) {
        if (b._zod.def.when) {
          if (zu(s) || !b._zod.def.when(s))
            continue;
        } else if (m)
          continue;
        const F = s.issues.length, I = b._zod.check(s);
        if (I instanceof Promise && (l == null ? void 0 : l.async) === !1)
          throw new dn();
        if (h || I instanceof Promise)
          h = (h ?? Promise.resolve()).then(async () => {
            await I, s.issues.length !== F && (m || (m = fn(s, F)));
          });
        else {
          if (s.issues.length === F)
            continue;
          m || (m = fn(s, F));
        }
      }
      return h ? h.then(() => s) : s;
    }, c = (s, a, l) => {
      if (fn(s))
        return s.aborted = !0, s;
      const m = u(a, t, l);
      if (m instanceof Promise) {
        if (l.async === !1)
          throw new dn();
        return m.then((h) => e._zod.parse(h, l));
      }
      return e._zod.parse(m, l);
    };
    e._zod.run = (s, a) => {
      if (a.skipChecks)
        return e._zod.parse(s, a);
      if (a.direction === "backward") {
        const m = e._zod.parse({ value: s.value, issues: [] }, { ...a, skipChecks: !0 });
        return m instanceof Promise ? m.then((h) => c(h, s, a)) : c(m, s, a);
      }
      const l = e._zod.parse(s, a);
      if (l instanceof Promise) {
        if (a.async === !1)
          throw new dn();
        return l.then((m) => u(m, t, a));
      }
      return u(l, t, a);
    };
  }
  k(e, "~standard", () => ({
    validate: (u) => {
      var c;
      try {
        const s = xu(e, u);
        return s.success ? { value: s.data } : { issues: (c = s.error) == null ? void 0 : c.issues };
      } catch {
        return Tu(e, u).then((a) => {
          var l;
          return a.success ? { value: a.data } : { issues: (l = a.error) == null ? void 0 : l.issues };
        });
      }
    },
    vendor: "zod",
    version: 1
  }));
}), at = /* @__PURE__ */ d("$ZodString", (e, n) => {
  var r;
  T.init(e, n), e._zod.pattern = [...((r = e == null ? void 0 : e._zod.bag) == null ? void 0 : r.patterns) ?? []].pop() ?? sc(e._zod.bag), e._zod.parse = (t, o) => {
    if (n.coerce)
      try {
        t.value = String(t.value);
      } catch {
      }
    return typeof t.value == "string" || t.issues.push({
      expected: "string",
      code: "invalid_type",
      input: t.value,
      inst: e
    }), t;
  };
}), z = /* @__PURE__ */ d("$ZodStringFormat", (e, n) => {
  Fr.init(e, n), at.init(e, n);
}), zc = /* @__PURE__ */ d("$ZodGUID", (e, n) => {
  n.pattern ?? (n.pattern = Hu), z.init(e, n);
}), Sc = /* @__PURE__ */ d("$ZodUUID", (e, n) => {
  if (n.version) {
    const t = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[n.version];
    if (t === void 0)
      throw new Error(`Invalid UUID version: "${n.version}"`);
    n.pattern ?? (n.pattern = Xt(t));
  } else
    n.pattern ?? (n.pattern = Xt());
  z.init(e, n);
}), Ac = /* @__PURE__ */ d("$ZodEmail", (e, n) => {
  n.pattern ?? (n.pattern = Gu), z.init(e, n);
}), xc = /* @__PURE__ */ d("$ZodURL", (e, n) => {
  z.init(e, n), e._zod.check = (r) => {
    var t;
    try {
      const o = r.value.trim();
      if (!n.normalize && ((t = n.protocol) == null ? void 0 : t.source) === tc.source && !/^https?:\/\//i.test(o)) {
        r.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: r.value,
          inst: e,
          continue: !n.abort
        });
        return;
      }
      const u = new URL(o);
      n.hostname && (n.hostname.lastIndex = 0, n.hostname.test(u.hostname) || r.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid hostname",
        pattern: n.hostname.source,
        input: r.value,
        inst: e,
        continue: !n.abort
      })), n.protocol && (n.protocol.lastIndex = 0, n.protocol.test(u.protocol.endsWith(":") ? u.protocol.slice(0, -1) : u.protocol) || r.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid protocol",
        pattern: n.protocol.source,
        input: r.value,
        inst: e,
        continue: !n.abort
      })), n.normalize ? r.value = u.href : r.value = o;
      return;
    } catch {
      r.issues.push({
        code: "invalid_format",
        format: "url",
        input: r.value,
        inst: e,
        continue: !n.abort
      });
    }
  };
}), Tc = /* @__PURE__ */ d("$ZodEmoji", (e, n) => {
  n.pattern ?? (n.pattern = Yu()), z.init(e, n);
}), Pc = /* @__PURE__ */ d("$ZodNanoID", (e, n) => {
  n.pattern ?? (n.pattern = Vu), z.init(e, n);
}), Zc = /* @__PURE__ */ d("$ZodCUID", (e, n) => {
  n.pattern ?? (n.pattern = Lu), z.init(e, n);
}), jc = /* @__PURE__ */ d("$ZodCUID2", (e, n) => {
  n.pattern ?? (n.pattern = Du), z.init(e, n);
}), Ec = /* @__PURE__ */ d("$ZodULID", (e, n) => {
  n.pattern ?? (n.pattern = Wu), z.init(e, n);
}), Nc = /* @__PURE__ */ d("$ZodXID", (e, n) => {
  n.pattern ?? (n.pattern = Bu), z.init(e, n);
}), Cc = /* @__PURE__ */ d("$ZodKSUID", (e, n) => {
  n.pattern ?? (n.pattern = Ku), z.init(e, n);
}), Uc = /* @__PURE__ */ d("$ZodISODateTime", (e, n) => {
  n.pattern ?? (n.pattern = cc(n)), z.init(e, n);
}), Mc = /* @__PURE__ */ d("$ZodISODate", (e, n) => {
  n.pattern ?? (n.pattern = ic), z.init(e, n);
}), Lc = /* @__PURE__ */ d("$ZodISOTime", (e, n) => {
  n.pattern ?? (n.pattern = uc(n)), z.init(e, n);
}), Dc = /* @__PURE__ */ d("$ZodISODuration", (e, n) => {
  n.pattern ?? (n.pattern = Ju), z.init(e, n);
}), Wc = /* @__PURE__ */ d("$ZodIPv4", (e, n) => {
  n.pattern ?? (n.pattern = Xu), z.init(e, n), e._zod.bag.format = "ipv4";
}), Bc = /* @__PURE__ */ d("$ZodIPv6", (e, n) => {
  n.pattern ?? (n.pattern = Qu), z.init(e, n), e._zod.bag.format = "ipv6", e._zod.check = (r) => {
    try {
      new URL(`http://[${r.value}]`);
    } catch {
      r.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: r.value,
        inst: e,
        continue: !n.abort
      });
    }
  };
}), Kc = /* @__PURE__ */ d("$ZodCIDRv4", (e, n) => {
  n.pattern ?? (n.pattern = ec), z.init(e, n);
}), Vc = /* @__PURE__ */ d("$ZodCIDRv6", (e, n) => {
  n.pattern ?? (n.pattern = nc), z.init(e, n), e._zod.check = (r) => {
    const t = r.value.split("/");
    try {
      if (t.length !== 2)
        throw new Error();
      const [o, u] = t;
      if (!u)
        throw new Error();
      const c = Number(u);
      if (`${c}` !== u)
        throw new Error();
      if (c < 0 || c > 128)
        throw new Error();
      new URL(`http://[${o}]`);
    } catch {
      r.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: r.value,
        inst: e,
        continue: !n.abort
      });
    }
  };
});
function Ko(e) {
  if (e === "")
    return !0;
  if (/\s/.test(e) || e.length % 4 !== 0)
    return !1;
  try {
    return atob(e), !0;
  } catch {
    return !1;
  }
}
const Jc = /* @__PURE__ */ d("$ZodBase64", (e, n) => {
  n.pattern ?? (n.pattern = rc), z.init(e, n), e._zod.bag.contentEncoding = "base64", e._zod.check = (r) => {
    Ko(r.value) || r.issues.push({
      code: "invalid_format",
      format: "base64",
      input: r.value,
      inst: e,
      continue: !n.abort
    });
  };
});
function Hc(e) {
  if (!Uo.test(e))
    return !1;
  const n = e.replace(/[-_]/g, (t) => t === "-" ? "+" : "/"), r = n.padEnd(Math.ceil(n.length / 4) * 4, "=");
  return Ko(r);
}
const Gc = /* @__PURE__ */ d("$ZodBase64URL", (e, n) => {
  n.pattern ?? (n.pattern = Uo), z.init(e, n), e._zod.bag.contentEncoding = "base64url", e._zod.check = (r) => {
    Hc(r.value) || r.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: r.value,
      inst: e,
      continue: !n.abort
    });
  };
}), qc = /* @__PURE__ */ d("$ZodE164", (e, n) => {
  n.pattern ?? (n.pattern = oc), z.init(e, n);
});
function Yc(e, n = null) {
  try {
    const r = e.split(".");
    if (r.length !== 3)
      return !1;
    const [t] = r;
    if (!t)
      return !1;
    const o = JSON.parse(atob(t));
    return !("typ" in o && (o == null ? void 0 : o.typ) !== "JWT" || !o.alg || n && (!("alg" in o) || o.alg !== n));
  } catch {
    return !1;
  }
}
const Xc = /* @__PURE__ */ d("$ZodJWT", (e, n) => {
  z.init(e, n), e._zod.check = (r) => {
    Yc(r.value, n.alg) || r.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: r.value,
      inst: e,
      continue: !n.abort
    });
  };
}), Vo = /* @__PURE__ */ d("$ZodNumber", (e, n) => {
  T.init(e, n), e._zod.pattern = e._zod.bag.pattern ?? fc, e._zod.parse = (r, t) => {
    if (n.coerce)
      try {
        r.value = Number(r.value);
      } catch {
      }
    const o = r.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o))
      return r;
    const u = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : "Infinity" : void 0;
    return r.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...u ? { received: u } : {}
    }), r;
  };
}), Qc = /* @__PURE__ */ d("$ZodNumberFormat", (e, n) => {
  hc.init(e, n), Vo.init(e, n);
}), es = /* @__PURE__ */ d("$ZodBoolean", (e, n) => {
  T.init(e, n), e._zod.pattern = dc, e._zod.parse = (r, t) => {
    if (n.coerce)
      try {
        r.value = !!r.value;
      } catch {
      }
    const o = r.value;
    return typeof o == "boolean" || r.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: o,
      inst: e
    }), r;
  };
}), ns = /* @__PURE__ */ d("$ZodUnknown", (e, n) => {
  T.init(e, n), e._zod.parse = (r) => r;
}), rs = /* @__PURE__ */ d("$ZodNever", (e, n) => {
  T.init(e, n), e._zod.parse = (r, t) => (r.issues.push({
    expected: "never",
    code: "invalid_type",
    input: r.value,
    inst: e
  }), r);
});
function Qt(e, n, r) {
  e.issues.length && n.issues.push(...jo(r, e.issues)), n.value[r] = e.value;
}
const ts = /* @__PURE__ */ d("$ZodArray", (e, n) => {
  T.init(e, n), e._zod.parse = (r, t) => {
    const o = r.value;
    if (!Array.isArray(o))
      return r.issues.push({
        expected: "array",
        code: "invalid_type",
        input: o,
        inst: e
      }), r;
    r.value = Array(o.length);
    const u = [];
    for (let c = 0; c < o.length; c++) {
      const s = o[c], a = n.element._zod.run({
        value: s,
        issues: []
      }, t);
      a instanceof Promise ? u.push(a.then((l) => Qt(l, r, c))) : Qt(a, r, c);
    }
    return u.length ? Promise.all(u).then(() => r) : r;
  };
});
function ar(e, n, r, t, o, u) {
  const c = r in t;
  if (e.issues.length) {
    if (o && u && !c)
      return;
    n.issues.push(...jo(r, e.issues));
  }
  if (!c && !o) {
    e.issues.length || n.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: void 0,
      path: [r]
    });
    return;
  }
  e.value === void 0 ? c && (n.value[r] = void 0) : n.value[r] = e.value;
}
function Jo(e) {
  var t, o, u, c;
  const n = Object.keys(e.shape);
  for (const s of n)
    if (!((c = (u = (o = (t = e.shape) == null ? void 0 : t[s]) == null ? void 0 : o._zod) == null ? void 0 : u.traits) != null && c.has("$ZodType")))
      throw new Error(`Invalid element at key "${s}": expected a Zod schema`);
  const r = _u(e.shape);
  return {
    ...e,
    keys: n,
    keySet: new Set(n),
    numKeys: n.length,
    optionalKeys: new Set(r)
  };
}
function Ho(e, n, r, t, o, u) {
  const c = [], s = o.keySet, a = o.catchall._zod, l = a.def.type, m = a.optin === "optional", h = a.optout === "optional";
  for (const b in n) {
    if (b === "__proto__" || s.has(b))
      continue;
    if (l === "never") {
      c.push(b);
      continue;
    }
    const F = a.run({ value: n[b], issues: [] }, t);
    F instanceof Promise ? e.push(F.then((I) => ar(I, r, b, n, m, h))) : ar(F, r, b, n, m, h);
  }
  return c.length && r.issues.push({
    code: "unrecognized_keys",
    keys: c,
    input: n,
    inst: u
  }), e.length ? Promise.all(e).then(() => r) : r;
}
const os = /* @__PURE__ */ d("$ZodObject", (e, n) => {
  T.init(e, n);
  const r = Object.getOwnPropertyDescriptor(n, "shape");
  if (!(r != null && r.get)) {
    const s = n.shape;
    Object.defineProperty(n, "shape", {
      get: () => {
        const a = { ...s };
        return Object.defineProperty(n, "shape", {
          value: a
        }), a;
      }
    });
  }
  const t = tt(() => Jo(n));
  k(e._zod, "propValues", () => {
    const s = n.shape, a = {};
    for (const l in s) {
      const m = s[l]._zod;
      if (m.values) {
        a[l] ?? (a[l] = /* @__PURE__ */ new Set());
        for (const h of m.values)
          a[l].add(h);
      }
    }
    return a;
  });
  const o = sr, u = n.catchall;
  let c;
  e._zod.parse = (s, a) => {
    c ?? (c = t.value);
    const l = s.value;
    if (!o(l))
      return s.issues.push({
        expected: "object",
        code: "invalid_type",
        input: l,
        inst: e
      }), s;
    s.value = {};
    const m = [], h = c.shape;
    for (const b of c.keys) {
      const F = h[b], I = F._zod.optin === "optional", Z = F._zod.optout === "optional", ne = F._zod.run({ value: l[b], issues: [] }, a);
      ne instanceof Promise ? m.push(ne.then((D) => ar(D, s, b, l, I, Z))) : ar(ne, s, b, l, I, Z);
    }
    return u ? Ho(m, l, s, a, t.value, e) : m.length ? Promise.all(m).then(() => s) : s;
  };
}), is = /* @__PURE__ */ d("$ZodObjectJIT", (e, n) => {
  os.init(e, n);
  const r = e._zod.parse, t = tt(() => Jo(n)), o = (b) => {
    var Sn, re;
    const F = new Ic(["shape", "payload", "ctx"]), I = t.value, Z = (ke) => {
      const x = Yt(ke);
      return `shape[${x}]._zod.run({ value: input[${x}], issues: [] }, ctx)`;
    };
    F.write("const input = payload.value;");
    const ne = /* @__PURE__ */ Object.create(null);
    let D = 0;
    for (const ke of I.keys)
      ne[ke] = `key_${D++}`;
    F.write("const newResult = {};");
    for (const ke of I.keys) {
      const x = ne[ke], J = Yt(ke), an = b[ke], Jt = ((Sn = an == null ? void 0 : an._zod) == null ? void 0 : Sn.optin) === "optional", Qi = ((re = an == null ? void 0 : an._zod) == null ? void 0 : re.optout) === "optional";
      F.write(`const ${x} = ${Z(ke)};`), Jt && Qi ? F.write(`
        if (${x}.issues.length) {
          if (${J} in input) {
            payload.issues = payload.issues.concat(${x}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${J}, ...iss.path] : [${J}]
            })));
          }
        }
        
        if (${x}.value === undefined) {
          if (${J} in input) {
            newResult[${J}] = undefined;
          }
        } else {
          newResult[${J}] = ${x}.value;
        }
        
      `) : Jt ? F.write(`
        if (${x}.issues.length) {
          payload.issues = payload.issues.concat(${x}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${J}, ...iss.path] : [${J}]
          })));
        }
        
        if (${x}.value === undefined) {
          if (${J} in input) {
            newResult[${J}] = undefined;
          }
        } else {
          newResult[${J}] = ${x}.value;
        }
        
      `) : F.write(`
        const ${x}_present = ${J} in input;
        if (${x}.issues.length) {
          payload.issues = payload.issues.concat(${x}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${J}, ...iss.path] : [${J}]
          })));
        }
        if (!${x}_present && !${x}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${J}]
          });
        }

        if (${x}_present) {
          if (${x}.value === undefined) {
            newResult[${J}] = undefined;
          } else {
            newResult[${J}] = ${x}.value;
          }
        }

      `);
    }
    F.write("payload.value = newResult;"), F.write("return payload;");
    const V = F.compile();
    return (ke, x) => V(b, ke, x);
  };
  let u;
  const c = sr, s = !rt.jitless, l = s && bu.value, m = n.catchall;
  let h;
  e._zod.parse = (b, F) => {
    h ?? (h = t.value);
    const I = b.value;
    return c(I) ? s && l && (F == null ? void 0 : F.async) === !1 && F.jitless !== !0 ? (u || (u = o(n.shape)), b = u(b, F), m ? Ho([], I, b, F, h, e) : b) : r(b, F) : (b.issues.push({
      expected: "object",
      code: "invalid_type",
      input: I,
      inst: e
    }), b);
  };
});
function eo(e, n, r, t) {
  for (const u of e)
    if (u.issues.length === 0)
      return n.value = u.value, n;
  const o = e.filter((u) => !fn(u));
  return o.length === 1 ? (n.value = o[0].value, o[0]) : (n.issues.push({
    code: "invalid_union",
    input: n.value,
    inst: r,
    errors: e.map((u) => u.issues.map((c) => He(c, t, Je())))
  }), n);
}
const us = /* @__PURE__ */ d("$ZodUnion", (e, n) => {
  T.init(e, n), k(e._zod, "optin", () => n.options.some((t) => t._zod.optin === "optional") ? "optional" : void 0), k(e._zod, "optout", () => n.options.some((t) => t._zod.optout === "optional") ? "optional" : void 0), k(e._zod, "values", () => {
    if (n.options.every((t) => t._zod.values))
      return new Set(n.options.flatMap((t) => Array.from(t._zod.values)));
  }), k(e._zod, "pattern", () => {
    if (n.options.every((t) => t._zod.pattern)) {
      const t = n.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${t.map((o) => it(o.source)).join("|")})$`);
    }
  });
  const r = n.options.length === 1 ? n.options[0]._zod.run : null;
  e._zod.parse = (t, o) => {
    if (r)
      return r(t, o);
    let u = !1;
    const c = [];
    for (const s of n.options) {
      const a = s._zod.run({
        value: t.value,
        issues: []
      }, o);
      if (a instanceof Promise)
        c.push(a), u = !0;
      else {
        if (a.issues.length === 0)
          return a;
        c.push(a);
      }
    }
    return u ? Promise.all(c).then((s) => eo(s, t, e, o)) : eo(c, t, e, o);
  };
}), cs = /* @__PURE__ */ d("$ZodIntersection", (e, n) => {
  T.init(e, n), e._zod.parse = (r, t) => {
    const o = r.value, u = n.left._zod.run({ value: o, issues: [] }, t), c = n.right._zod.run({ value: o, issues: [] }, t);
    return u instanceof Promise || c instanceof Promise ? Promise.all([u, c]).then(([a, l]) => no(r, a, l)) : no(r, u, c);
  };
});
function Jr(e, n) {
  if (e === n)
    return { valid: !0, data: e };
  if (e instanceof Date && n instanceof Date && +e == +n)
    return { valid: !0, data: e };
  if (jn(e) && jn(n)) {
    const r = Object.keys(n), t = Object.keys(e).filter((u) => r.indexOf(u) !== -1), o = { ...e, ...n };
    for (const u of t) {
      const c = Jr(e[u], n[u]);
      if (!c.valid)
        return {
          valid: !1,
          mergeErrorPath: [u, ...c.mergeErrorPath]
        };
      o[u] = c.data;
    }
    return { valid: !0, data: o };
  }
  if (Array.isArray(e) && Array.isArray(n)) {
    if (e.length !== n.length)
      return { valid: !1, mergeErrorPath: [] };
    const r = [];
    for (let t = 0; t < e.length; t++) {
      const o = e[t], u = n[t], c = Jr(o, u);
      if (!c.valid)
        return {
          valid: !1,
          mergeErrorPath: [t, ...c.mergeErrorPath]
        };
      r.push(c.data);
    }
    return { valid: !0, data: r };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function no(e, n, r) {
  const t = /* @__PURE__ */ new Map();
  let o;
  for (const s of n.issues)
    if (s.code === "unrecognized_keys") {
      o ?? (o = s);
      for (const a of s.keys)
        t.has(a) || t.set(a, {}), t.get(a).l = !0;
    } else
      e.issues.push(s);
  for (const s of r.issues)
    if (s.code === "unrecognized_keys")
      for (const a of s.keys)
        t.has(a) || t.set(a, {}), t.get(a).r = !0;
    else
      e.issues.push(s);
  const u = [...t].filter(([, s]) => s.l && s.r).map(([s]) => s);
  if (u.length && o && e.issues.push({ ...o, keys: u }), fn(e))
    return e;
  const c = Jr(n.value, r.value);
  if (!c.valid)
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
  return e.value = c.data, e;
}
const ss = /* @__PURE__ */ d("$ZodEnum", (e, n) => {
  T.init(e, n);
  const r = To(n.entries), t = new Set(r);
  e._zod.values = t, e._zod.pattern = new RegExp(`^(${r.filter((o) => Fu.has(typeof o)).map((o) => typeof o == "string" ? mn(o) : o.toString()).join("|")})$`), e._zod.parse = (o, u) => {
    const c = o.value;
    return t.has(c) || o.issues.push({
      code: "invalid_value",
      values: r,
      input: c,
      inst: e
    }), o;
  };
}), as = /* @__PURE__ */ d("$ZodLiteral", (e, n) => {
  if (T.init(e, n), n.values.length === 0)
    throw new Error("Cannot create literal schema with no valid values");
  const r = new Set(n.values);
  e._zod.values = r, e._zod.pattern = new RegExp(`^(${n.values.map((t) => typeof t == "string" ? mn(t) : t ? mn(t.toString()) : String(t)).join("|")})$`), e._zod.parse = (t, o) => {
    const u = t.value;
    return r.has(u) || t.issues.push({
      code: "invalid_value",
      values: n.values,
      input: u,
      inst: e
    }), t;
  };
}), fs = /* @__PURE__ */ d("$ZodTransform", (e, n) => {
  T.init(e, n), e._zod.optin = "optional", e._zod.parse = (r, t) => {
    if (t.direction === "backward")
      throw new xo(e.constructor.name);
    const o = n.transform(r.value, r);
    if (t.async)
      return (o instanceof Promise ? o : Promise.resolve(o)).then((c) => (r.value = c, r.fallback = !0, r));
    if (o instanceof Promise)
      throw new dn();
    return r.value = o, r.fallback = !0, r;
  };
});
function ro(e, n) {
  return n === void 0 && (e.issues.length || e.fallback) ? { issues: [], value: void 0 } : e;
}
const Go = /* @__PURE__ */ d("$ZodOptional", (e, n) => {
  T.init(e, n), e._zod.optin = "optional", e._zod.optout = "optional", k(e._zod, "values", () => n.innerType._zod.values ? /* @__PURE__ */ new Set([...n.innerType._zod.values, void 0]) : void 0), k(e._zod, "pattern", () => {
    const r = n.innerType._zod.pattern;
    return r ? new RegExp(`^(${it(r.source)})?$`) : void 0;
  }), e._zod.parse = (r, t) => {
    if (n.innerType._zod.optin === "optional") {
      const o = r.value, u = n.innerType._zod.run(r, t);
      return u instanceof Promise ? u.then((c) => ro(c, o)) : ro(u, o);
    }
    return r.value === void 0 ? r : n.innerType._zod.run(r, t);
  };
}), ds = /* @__PURE__ */ d("$ZodExactOptional", (e, n) => {
  Go.init(e, n), k(e._zod, "values", () => n.innerType._zod.values), k(e._zod, "pattern", () => n.innerType._zod.pattern), e._zod.parse = (r, t) => n.innerType._zod.run(r, t);
}), ls = /* @__PURE__ */ d("$ZodNullable", (e, n) => {
  T.init(e, n), k(e._zod, "optin", () => n.innerType._zod.optin), k(e._zod, "optout", () => n.innerType._zod.optout), k(e._zod, "pattern", () => {
    const r = n.innerType._zod.pattern;
    return r ? new RegExp(`^(${it(r.source)}|null)$`) : void 0;
  }), k(e._zod, "values", () => n.innerType._zod.values ? /* @__PURE__ */ new Set([...n.innerType._zod.values, null]) : void 0), e._zod.parse = (r, t) => r.value === null ? r : n.innerType._zod.run(r, t);
}), ms = /* @__PURE__ */ d("$ZodDefault", (e, n) => {
  T.init(e, n), e._zod.optin = "optional", k(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (r, t) => {
    if (t.direction === "backward")
      return n.innerType._zod.run(r, t);
    if (r.value === void 0)
      return r.value = n.defaultValue, r;
    const o = n.innerType._zod.run(r, t);
    return o instanceof Promise ? o.then((u) => to(u, n)) : to(o, n);
  };
});
function to(e, n) {
  return e.value === void 0 && (e.value = n.defaultValue), e;
}
const ps = /* @__PURE__ */ d("$ZodPrefault", (e, n) => {
  T.init(e, n), e._zod.optin = "optional", k(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (r, t) => (t.direction === "backward" || r.value === void 0 && (r.value = n.defaultValue), n.innerType._zod.run(r, t));
}), hs = /* @__PURE__ */ d("$ZodNonOptional", (e, n) => {
  T.init(e, n), k(e._zod, "values", () => {
    const r = n.innerType._zod.values;
    return r ? new Set([...r].filter((t) => t !== void 0)) : void 0;
  }), e._zod.parse = (r, t) => {
    const o = n.innerType._zod.run(r, t);
    return o instanceof Promise ? o.then((u) => oo(u, e)) : oo(o, e);
  };
});
function oo(e, n) {
  return !e.issues.length && e.value === void 0 && e.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: e.value,
    inst: n
  }), e;
}
const gs = /* @__PURE__ */ d("$ZodCatch", (e, n) => {
  T.init(e, n), e._zod.optin = "optional", k(e._zod, "optout", () => n.innerType._zod.optout), k(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (r, t) => {
    if (t.direction === "backward")
      return n.innerType._zod.run(r, t);
    const o = n.innerType._zod.run(r, t);
    return o instanceof Promise ? o.then((u) => (r.value = u.value, u.issues.length && (r.value = n.catchValue({
      ...r,
      error: {
        issues: u.issues.map((c) => He(c, t, Je()))
      },
      input: r.value
    }), r.issues = [], r.fallback = !0), r)) : (r.value = o.value, o.issues.length && (r.value = n.catchValue({
      ...r,
      error: {
        issues: o.issues.map((u) => He(u, t, Je()))
      },
      input: r.value
    }), r.issues = [], r.fallback = !0), r);
  };
}), bs = /* @__PURE__ */ d("$ZodPipe", (e, n) => {
  T.init(e, n), k(e._zod, "values", () => n.in._zod.values), k(e._zod, "optin", () => n.in._zod.optin), k(e._zod, "optout", () => n.out._zod.optout), k(e._zod, "propValues", () => n.in._zod.propValues), e._zod.parse = (r, t) => {
    if (t.direction === "backward") {
      const u = n.out._zod.run(r, t);
      return u instanceof Promise ? u.then((c) => or(c, n.in, t)) : or(u, n.in, t);
    }
    const o = n.in._zod.run(r, t);
    return o instanceof Promise ? o.then((u) => or(u, n.out, t)) : or(o, n.out, t);
  };
});
function or(e, n, r) {
  return e.issues.length ? (e.aborted = !0, e) : n._zod.run({ value: e.value, issues: e.issues, fallback: e.fallback }, r);
}
const Fs = /* @__PURE__ */ d("$ZodReadonly", (e, n) => {
  T.init(e, n), k(e._zod, "propValues", () => n.innerType._zod.propValues), k(e._zod, "values", () => n.innerType._zod.values), k(e._zod, "optin", () => {
    var r, t;
    return (t = (r = n.innerType) == null ? void 0 : r._zod) == null ? void 0 : t.optin;
  }), k(e._zod, "optout", () => {
    var r, t;
    return (t = (r = n.innerType) == null ? void 0 : r._zod) == null ? void 0 : t.optout;
  }), e._zod.parse = (r, t) => {
    if (t.direction === "backward")
      return n.innerType._zod.run(r, t);
    const o = n.innerType._zod.run(r, t);
    return o instanceof Promise ? o.then(io) : io(o);
  };
});
function io(e) {
  return e.value = Object.freeze(e.value), e;
}
const _s = /* @__PURE__ */ d("$ZodCustom", (e, n) => {
  ce.init(e, n), T.init(e, n), e._zod.parse = (r, t) => r, e._zod.check = (r) => {
    const t = r.value, o = n.fn(t);
    if (o instanceof Promise)
      return o.then((u) => uo(u, r, t, e));
    uo(o, r, t, e);
  };
});
function uo(e, n, r, t) {
  if (!e) {
    const o = {
      code: "custom",
      input: r,
      inst: t,
      // incorporates params.error into issue reporting
      path: [...t._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !t._zod.def.abort
      // params: inst._zod.def.params,
    };
    t._zod.def.params && (o.params = t._zod.def.params), n.issues.push(En(o));
  }
}
var co;
class Os {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(n, ...r) {
    const t = r[0];
    return this._map.set(n, t), t && typeof t == "object" && "id" in t && this._idmap.set(t.id, n), this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(n) {
    const r = this._map.get(n);
    return r && typeof r == "object" && "id" in r && this._idmap.delete(r.id), this._map.delete(n), this;
  }
  get(n) {
    const r = n._zod.parent;
    if (r) {
      const t = { ...this.get(r) ?? {} };
      delete t.id;
      const o = { ...t, ...this._map.get(n) };
      return Object.keys(o).length ? o : void 0;
    }
    return this._map.get(n);
  }
  has(n) {
    return this._map.has(n);
  }
}
function vs() {
  return new Os();
}
(co = globalThis).__zod_globalRegistry ?? (co.__zod_globalRegistry = vs());
const Pn = globalThis.__zod_globalRegistry;
// @__NO_SIDE_EFFECTS__
function ys(e, n) {
  return new e({
    type: "string",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function $s(e, n) {
  return new e({
    type: "string",
    format: "email",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function so(e, n) {
  return new e({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function ws(e, n) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function ks(e, n) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v4",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Is(e, n) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v6",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Rs(e, n) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v7",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function zs(e, n) {
  return new e({
    type: "string",
    format: "url",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ss(e, n) {
  return new e({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function As(e, n) {
  return new e({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function xs(e, n) {
  return new e({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ts(e, n) {
  return new e({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ps(e, n) {
  return new e({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Zs(e, n) {
  return new e({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function js(e, n) {
  return new e({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Es(e, n) {
  return new e({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ns(e, n) {
  return new e({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Cs(e, n) {
  return new e({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Us(e, n) {
  return new e({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ms(e, n) {
  return new e({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ls(e, n) {
  return new e({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ds(e, n) {
  return new e({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ws(e, n) {
  return new e({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: !1,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Bs(e, n) {
  return new e({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: !1,
    local: !1,
    precision: null,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ks(e, n) {
  return new e({
    type: "string",
    format: "date",
    check: "string_format",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Vs(e, n) {
  return new e({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Js(e, n) {
  return new e({
    type: "string",
    format: "duration",
    check: "string_format",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Hs(e, n) {
  return new e({
    type: "number",
    checks: [],
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Gs(e, n) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function qs(e, n) {
  return new e({
    type: "boolean",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ys(e) {
  return new e({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function Xs(e, n) {
  return new e({
    type: "never",
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function ao(e, n) {
  return new Wo({
    check: "less_than",
    ..._(n),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function Dr(e, n) {
  return new Wo({
    check: "less_than",
    ..._(n),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function fo(e, n) {
  return new Bo({
    check: "greater_than",
    ..._(n),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function Wr(e, n) {
  return new Bo({
    check: "greater_than",
    ..._(n),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function lo(e, n) {
  return new pc({
    check: "multiple_of",
    ..._(n),
    value: e
  });
}
// @__NO_SIDE_EFFECTS__
function qo(e, n) {
  return new gc({
    check: "max_length",
    ..._(n),
    maximum: e
  });
}
// @__NO_SIDE_EFFECTS__
function fr(e, n) {
  return new bc({
    check: "min_length",
    ..._(n),
    minimum: e
  });
}
// @__NO_SIDE_EFFECTS__
function Yo(e, n) {
  return new Fc({
    check: "length_equals",
    ..._(n),
    length: e
  });
}
// @__NO_SIDE_EFFECTS__
function Qs(e, n) {
  return new _c({
    check: "string_format",
    format: "regex",
    ..._(n),
    pattern: e
  });
}
// @__NO_SIDE_EFFECTS__
function ea(e) {
  return new Oc({
    check: "string_format",
    format: "lowercase",
    ..._(e)
  });
}
// @__NO_SIDE_EFFECTS__
function na(e) {
  return new vc({
    check: "string_format",
    format: "uppercase",
    ..._(e)
  });
}
// @__NO_SIDE_EFFECTS__
function ra(e, n) {
  return new yc({
    check: "string_format",
    format: "includes",
    ..._(n),
    includes: e
  });
}
// @__NO_SIDE_EFFECTS__
function ta(e, n) {
  return new $c({
    check: "string_format",
    format: "starts_with",
    ..._(n),
    prefix: e
  });
}
// @__NO_SIDE_EFFECTS__
function oa(e, n) {
  return new wc({
    check: "string_format",
    format: "ends_with",
    ..._(n),
    suffix: e
  });
}
// @__NO_SIDE_EFFECTS__
function Fn(e) {
  return new kc({
    check: "overwrite",
    tx: e
  });
}
// @__NO_SIDE_EFFECTS__
function ia(e) {
  return /* @__PURE__ */ Fn((n) => n.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function ua() {
  return /* @__PURE__ */ Fn((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function ca() {
  return /* @__PURE__ */ Fn((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function sa() {
  return /* @__PURE__ */ Fn((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function aa() {
  return /* @__PURE__ */ Fn((e) => gu(e));
}
// @__NO_SIDE_EFFECTS__
function fa(e, n, r) {
  return new e({
    type: "array",
    element: n,
    // get element() {
    //   return element;
    // },
    ..._(r)
  });
}
// @__NO_SIDE_EFFECTS__
function da(e, n, r) {
  return new e({
    type: "custom",
    check: "custom",
    fn: n,
    ..._(r)
  });
}
// @__NO_SIDE_EFFECTS__
function la(e, n) {
  const r = /* @__PURE__ */ ma((t) => (t.addIssue = (o) => {
    if (typeof o == "string")
      t.issues.push(En(o, t.value, r._zod.def));
    else {
      const u = o;
      u.fatal && (u.continue = !1), u.code ?? (u.code = "custom"), u.input ?? (u.input = t.value), u.inst ?? (u.inst = r), u.continue ?? (u.continue = !r._zod.def.abort), t.issues.push(En(u));
    }
  }, e(t.value, t)), n);
  return r;
}
// @__NO_SIDE_EFFECTS__
function ma(e, n) {
  const r = new ce({
    check: "custom",
    ..._(n)
  });
  return r._zod.check = e, r;
}
function Xo(e) {
  let n = (e == null ? void 0 : e.target) ?? "draft-2020-12";
  return n === "draft-4" && (n = "draft-04"), n === "draft-7" && (n = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: (e == null ? void 0 : e.metadata) ?? Pn,
    target: n,
    unrepresentable: (e == null ? void 0 : e.unrepresentable) ?? "throw",
    override: (e == null ? void 0 : e.override) ?? (() => {
    }),
    io: (e == null ? void 0 : e.io) ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: (e == null ? void 0 : e.cycles) ?? "ref",
    reused: (e == null ? void 0 : e.reused) ?? "inline",
    external: (e == null ? void 0 : e.external) ?? void 0
  };
}
function H(e, n, r = { path: [], schemaPath: [] }) {
  var m, h;
  var t;
  const o = e._zod.def, u = n.seen.get(e);
  if (u)
    return u.count++, r.schemaPath.includes(e) && (u.cycle = r.path), u.schema;
  const c = { schema: {}, count: 1, cycle: void 0, path: r.path };
  n.seen.set(e, c);
  const s = (h = (m = e._zod).toJSONSchema) == null ? void 0 : h.call(m);
  if (s)
    c.schema = s;
  else {
    const b = {
      ...r,
      schemaPath: [...r.schemaPath, e],
      path: r.path
    };
    if (e._zod.processJSONSchema)
      e._zod.processJSONSchema(n, c.schema, b);
    else {
      const I = c.schema, Z = n.processors[o.type];
      if (!Z)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      Z(e, n, I, b);
    }
    const F = e._zod.parent;
    F && (c.ref || (c.ref = F), H(F, n, b), n.seen.get(F).isParent = !0);
  }
  const a = n.metadataRegistry.get(e);
  return a && Object.assign(c.schema, a), n.io === "input" && ee(e) && (delete c.schema.examples, delete c.schema.default), n.io === "input" && "_prefault" in c.schema && ((t = c.schema).default ?? (t.default = c.schema._prefault)), delete c.schema._prefault, n.seen.get(e).schema;
}
function Qo(e, n) {
  var c, s, a, l;
  const r = e.seen.get(n);
  if (!r)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const t = /* @__PURE__ */ new Map();
  for (const m of e.seen.entries()) {
    const h = (c = e.metadataRegistry.get(m[0])) == null ? void 0 : c.id;
    if (h) {
      const b = t.get(h);
      if (b && b !== m[0])
        throw new Error(`Duplicate schema id "${h}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      t.set(h, m[0]);
    }
  }
  const o = (m) => {
    var Z;
    const h = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const ne = (Z = e.external.registry.get(m[0])) == null ? void 0 : Z.id, D = e.external.uri ?? ((Sn) => Sn);
      if (ne)
        return { ref: D(ne) };
      const V = m[1].defId ?? m[1].schema.id ?? `schema${e.counter++}`;
      return m[1].defId = V, { defId: V, ref: `${D("__shared")}#/${h}/${V}` };
    }
    if (m[1] === r)
      return { ref: "#" };
    const F = `#/${h}/`, I = m[1].schema.id ?? `__schema${e.counter++}`;
    return { defId: I, ref: F + I };
  }, u = (m) => {
    if (m[1].schema.$ref)
      return;
    const h = m[1], { ref: b, defId: F } = o(m);
    h.def = { ...h.schema }, F && (h.defId = F);
    const I = h.schema;
    for (const Z in I)
      delete I[Z];
    I.$ref = b;
  };
  if (e.cycles === "throw")
    for (const m of e.seen.entries()) {
      const h = m[1];
      if (h.cycle)
        throw new Error(`Cycle detected: #/${(s = h.cycle) == null ? void 0 : s.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const m of e.seen.entries()) {
    const h = m[1];
    if (n === m[0]) {
      u(m);
      continue;
    }
    if (e.external) {
      const F = (a = e.external.registry.get(m[0])) == null ? void 0 : a.id;
      if (n !== m[0] && F) {
        u(m);
        continue;
      }
    }
    if ((l = e.metadataRegistry.get(m[0])) == null ? void 0 : l.id) {
      u(m);
      continue;
    }
    if (h.cycle) {
      u(m);
      continue;
    }
    if (h.count > 1 && e.reused === "ref") {
      u(m);
      continue;
    }
  }
}
function ei(e, n) {
  var s, a, l, m;
  const r = e.seen.get(n);
  if (!r)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const t = (h) => {
    const b = e.seen.get(h);
    if (b.ref === null)
      return;
    const F = b.def ?? b.schema, I = { ...F }, Z = b.ref;
    if (b.ref = null, Z) {
      t(Z);
      const D = e.seen.get(Z), V = D.schema;
      if (V.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (F.allOf = F.allOf ?? [], F.allOf.push(V)) : Object.assign(F, V), Object.assign(F, I), h._zod.parent === Z)
        for (const re in F)
          re === "$ref" || re === "allOf" || re in I || delete F[re];
      if (V.$ref && D.def)
        for (const re in F)
          re === "$ref" || re === "allOf" || re in D.def && JSON.stringify(F[re]) === JSON.stringify(D.def[re]) && delete F[re];
    }
    const ne = h._zod.parent;
    if (ne && ne !== Z) {
      t(ne);
      const D = e.seen.get(ne);
      if (D != null && D.schema.$ref && (F.$ref = D.schema.$ref, D.def))
        for (const V in F)
          V === "$ref" || V === "allOf" || V in D.def && JSON.stringify(F[V]) === JSON.stringify(D.def[V]) && delete F[V];
    }
    e.override({
      zodSchema: h,
      jsonSchema: F,
      path: b.path ?? []
    });
  };
  for (const h of [...e.seen.entries()].reverse())
    t(h[0]);
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, (s = e.external) != null && s.uri) {
    const h = (a = e.external.registry.get(n)) == null ? void 0 : a.id;
    if (!h)
      throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(h);
  }
  Object.assign(o, r.def ?? r.schema);
  const u = (l = e.metadataRegistry.get(n)) == null ? void 0 : l.id;
  u !== void 0 && o.id === u && delete o.id;
  const c = ((m = e.external) == null ? void 0 : m.defs) ?? {};
  for (const h of e.seen.entries()) {
    const b = h[1];
    b.def && b.defId && (b.def.id === b.defId && delete b.def.id, c[b.defId] = b.def);
  }
  e.external || Object.keys(c).length > 0 && (e.target === "draft-2020-12" ? o.$defs = c : o.definitions = c);
  try {
    const h = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(h, "~standard", {
      value: {
        ...n["~standard"],
        jsonSchema: {
          input: dr(n, "input", e.processors),
          output: dr(n, "output", e.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), h;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function ee(e, n) {
  const r = n ?? { seen: /* @__PURE__ */ new Set() };
  if (r.seen.has(e))
    return !1;
  r.seen.add(e);
  const t = e._zod.def;
  if (t.type === "transform")
    return !0;
  if (t.type === "array")
    return ee(t.element, r);
  if (t.type === "set")
    return ee(t.valueType, r);
  if (t.type === "lazy")
    return ee(t.getter(), r);
  if (t.type === "promise" || t.type === "optional" || t.type === "nonoptional" || t.type === "nullable" || t.type === "readonly" || t.type === "default" || t.type === "prefault")
    return ee(t.innerType, r);
  if (t.type === "intersection")
    return ee(t.left, r) || ee(t.right, r);
  if (t.type === "record" || t.type === "map")
    return ee(t.keyType, r) || ee(t.valueType, r);
  if (t.type === "pipe")
    return e._zod.traits.has("$ZodCodec") ? !0 : ee(t.in, r) || ee(t.out, r);
  if (t.type === "object") {
    for (const o in t.shape)
      if (ee(t.shape[o], r))
        return !0;
    return !1;
  }
  if (t.type === "union") {
    for (const o of t.options)
      if (ee(o, r))
        return !0;
    return !1;
  }
  if (t.type === "tuple") {
    for (const o of t.items)
      if (ee(o, r))
        return !0;
    return !!(t.rest && ee(t.rest, r));
  }
  return !1;
}
const pa = (e, n = {}) => (r) => {
  const t = Xo({ ...r, processors: n });
  return H(e, t), Qo(t, e), ei(t, e);
}, dr = (e, n, r = {}) => (t) => {
  const { libraryOptions: o, target: u } = t ?? {}, c = Xo({ ...o ?? {}, target: u, io: n, processors: r });
  return H(e, c), Qo(c, e), ei(c, e);
}, ha = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
}, ga = (e, n, r, t) => {
  const o = r;
  o.type = "string";
  const { minimum: u, maximum: c, format: s, patterns: a, contentEncoding: l } = e._zod.bag;
  if (typeof u == "number" && (o.minLength = u), typeof c == "number" && (o.maxLength = c), s && (o.format = ha[s] ?? s, o.format === "" && delete o.format, s === "time" && delete o.format), l && (o.contentEncoding = l), a && a.size > 0) {
    const m = [...a];
    m.length === 1 ? o.pattern = m[0].source : m.length > 1 && (o.allOf = [
      ...m.map((h) => ({
        ...n.target === "draft-07" || n.target === "draft-04" || n.target === "openapi-3.0" ? { type: "string" } : {},
        pattern: h.source
      }))
    ]);
  }
}, ba = (e, n, r, t) => {
  const o = r, { minimum: u, maximum: c, format: s, multipleOf: a, exclusiveMaximum: l, exclusiveMinimum: m } = e._zod.bag;
  typeof s == "string" && s.includes("int") ? o.type = "integer" : o.type = "number";
  const h = typeof m == "number" && m >= (u ?? Number.NEGATIVE_INFINITY), b = typeof l == "number" && l <= (c ?? Number.POSITIVE_INFINITY), F = n.target === "draft-04" || n.target === "openapi-3.0";
  h ? F ? (o.minimum = m, o.exclusiveMinimum = !0) : o.exclusiveMinimum = m : typeof u == "number" && (o.minimum = u), b ? F ? (o.maximum = l, o.exclusiveMaximum = !0) : o.exclusiveMaximum = l : typeof c == "number" && (o.maximum = c), typeof a == "number" && (o.multipleOf = a);
}, Fa = (e, n, r, t) => {
  r.type = "boolean";
}, _a = (e, n, r, t) => {
  r.not = {};
}, Oa = (e, n, r, t) => {
}, va = (e, n, r, t) => {
  const o = e._zod.def, u = To(o.entries);
  u.every((c) => typeof c == "number") && (r.type = "number"), u.every((c) => typeof c == "string") && (r.type = "string"), r.enum = u;
}, ya = (e, n, r, t) => {
  const o = e._zod.def, u = [];
  for (const c of o.values)
    if (c === void 0) {
      if (n.unrepresentable === "throw")
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
    } else if (typeof c == "bigint") {
      if (n.unrepresentable === "throw")
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      u.push(Number(c));
    } else
      u.push(c);
  if (u.length !== 0) if (u.length === 1) {
    const c = u[0];
    r.type = c === null ? "null" : typeof c, n.target === "draft-04" || n.target === "openapi-3.0" ? r.enum = [c] : r.const = c;
  } else
    u.every((c) => typeof c == "number") && (r.type = "number"), u.every((c) => typeof c == "string") && (r.type = "string"), u.every((c) => typeof c == "boolean") && (r.type = "boolean"), u.every((c) => c === null) && (r.type = "null"), r.enum = u;
}, $a = (e, n, r, t) => {
  if (n.unrepresentable === "throw")
    throw new Error("Custom types cannot be represented in JSON Schema");
}, wa = (e, n, r, t) => {
  if (n.unrepresentable === "throw")
    throw new Error("Transforms cannot be represented in JSON Schema");
}, ka = (e, n, r, t) => {
  const o = r, u = e._zod.def, { minimum: c, maximum: s } = e._zod.bag;
  typeof c == "number" && (o.minItems = c), typeof s == "number" && (o.maxItems = s), o.type = "array", o.items = H(u.element, n, {
    ...t,
    path: [...t.path, "items"]
  });
}, Ia = (e, n, r, t) => {
  var l;
  const o = r, u = e._zod.def;
  o.type = "object", o.properties = {};
  const c = u.shape;
  for (const m in c)
    o.properties[m] = H(c[m], n, {
      ...t,
      path: [...t.path, "properties", m]
    });
  const s = new Set(Object.keys(c)), a = new Set([...s].filter((m) => {
    const h = u.shape[m]._zod;
    return n.io === "input" ? h.optin === void 0 : h.optout === void 0;
  }));
  a.size > 0 && (o.required = Array.from(a)), ((l = u.catchall) == null ? void 0 : l._zod.def.type) === "never" ? o.additionalProperties = !1 : u.catchall ? u.catchall && (o.additionalProperties = H(u.catchall, n, {
    ...t,
    path: [...t.path, "additionalProperties"]
  })) : n.io === "output" && (o.additionalProperties = !1);
}, Ra = (e, n, r, t) => {
  const o = e._zod.def, u = o.inclusive === !1, c = o.options.map((s, a) => H(s, n, {
    ...t,
    path: [...t.path, u ? "oneOf" : "anyOf", a]
  }));
  u ? r.oneOf = c : r.anyOf = c;
}, za = (e, n, r, t) => {
  const o = e._zod.def, u = H(o.left, n, {
    ...t,
    path: [...t.path, "allOf", 0]
  }), c = H(o.right, n, {
    ...t,
    path: [...t.path, "allOf", 1]
  }), s = (l) => "allOf" in l && Object.keys(l).length === 1, a = [
    ...s(u) ? u.allOf : [u],
    ...s(c) ? c.allOf : [c]
  ];
  r.allOf = a;
}, Sa = (e, n, r, t) => {
  const o = e._zod.def, u = H(o.innerType, n, t), c = n.seen.get(e);
  n.target === "openapi-3.0" ? (c.ref = o.innerType, r.nullable = !0) : r.anyOf = [u, { type: "null" }];
}, Aa = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType;
}, xa = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType, r.default = JSON.parse(JSON.stringify(o.defaultValue));
}, Ta = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType, n.io === "input" && (r._prefault = JSON.parse(JSON.stringify(o.defaultValue)));
}, Pa = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType;
  let c;
  try {
    c = o.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  r.default = c;
}, Za = (e, n, r, t) => {
  const o = e._zod.def, u = o.in._zod.traits.has("$ZodTransform"), c = n.io === "input" ? u ? o.out : o.in : o.out;
  H(c, n, t);
  const s = n.seen.get(e);
  s.ref = c;
}, ja = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType, r.readOnly = !0;
}, ni = (e, n, r, t) => {
  const o = e._zod.def;
  H(o.innerType, n, t);
  const u = n.seen.get(e);
  u.ref = o.innerType;
}, Ea = /* @__PURE__ */ d("ZodISODateTime", (e, n) => {
  Uc.init(e, n), S.init(e, n);
});
function Na(e) {
  return /* @__PURE__ */ Bs(Ea, e);
}
const Ca = /* @__PURE__ */ d("ZodISODate", (e, n) => {
  Mc.init(e, n), S.init(e, n);
});
function Ua(e) {
  return /* @__PURE__ */ Ks(Ca, e);
}
const Ma = /* @__PURE__ */ d("ZodISOTime", (e, n) => {
  Lc.init(e, n), S.init(e, n);
});
function La(e) {
  return /* @__PURE__ */ Vs(Ma, e);
}
const Da = /* @__PURE__ */ d("ZodISODuration", (e, n) => {
  Dc.init(e, n), S.init(e, n);
});
function Wa(e) {
  return /* @__PURE__ */ Js(Da, e);
}
const Ba = (e, n) => {
  No.init(e, n), e.name = "ZodError", Object.defineProperties(e, {
    format: {
      value: (r) => Au(e, r)
      // enumerable: false,
    },
    flatten: {
      value: (r) => Su(e, r)
      // enumerable: false,
    },
    addIssue: {
      value: (r) => {
        e.issues.push(r), e.message = JSON.stringify(e.issues, Vr, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (r) => {
        e.issues.push(...r), e.message = JSON.stringify(e.issues, Vr, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return e.issues.length === 0;
      }
      // enumerable: false,
    }
  });
}, be = /* @__PURE__ */ d("ZodError", Ba, {
  Parent: Error
}), Ka = /* @__PURE__ */ ct(be), Va = /* @__PURE__ */ st(be), Ja = /* @__PURE__ */ gr(be), Ha = /* @__PURE__ */ br(be), Ga = /* @__PURE__ */ Pu(be), qa = /* @__PURE__ */ Zu(be), Ya = /* @__PURE__ */ ju(be), Xa = /* @__PURE__ */ Eu(be), Qa = /* @__PURE__ */ Nu(be), ef = /* @__PURE__ */ Cu(be), nf = /* @__PURE__ */ Uu(be), rf = /* @__PURE__ */ Mu(be), mo = /* @__PURE__ */ new WeakMap();
function Bn(e, n, r) {
  const t = Object.getPrototypeOf(e);
  let o = mo.get(t);
  if (o || (o = /* @__PURE__ */ new Set(), mo.set(t, o)), !o.has(n)) {
    o.add(n);
    for (const u in r) {
      const c = r[u];
      Object.defineProperty(t, u, {
        configurable: !0,
        enumerable: !1,
        get() {
          const s = c.bind(this);
          return Object.defineProperty(this, u, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: s
          }), s;
        },
        set(s) {
          Object.defineProperty(this, u, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: s
          });
        }
      });
    }
  }
}
const P = /* @__PURE__ */ d("ZodType", (e, n) => (T.init(e, n), Object.assign(e["~standard"], {
  jsonSchema: {
    input: dr(e, "input"),
    output: dr(e, "output")
  }
}), e.toJSONSchema = pa(e, {}), e.def = n, e.type = n.type, Object.defineProperty(e, "_def", { value: n }), e.parse = (r, t) => Ka(e, r, t, { callee: e.parse }), e.safeParse = (r, t) => Ja(e, r, t), e.parseAsync = async (r, t) => Va(e, r, t, { callee: e.parseAsync }), e.safeParseAsync = async (r, t) => Ha(e, r, t), e.spa = e.safeParseAsync, e.encode = (r, t) => Ga(e, r, t), e.decode = (r, t) => qa(e, r, t), e.encodeAsync = async (r, t) => Ya(e, r, t), e.decodeAsync = async (r, t) => Xa(e, r, t), e.safeEncode = (r, t) => Qa(e, r, t), e.safeDecode = (r, t) => ef(e, r, t), e.safeEncodeAsync = async (r, t) => nf(e, r, t), e.safeDecodeAsync = async (r, t) => rf(e, r, t), Bn(e, "ZodType", {
  check(...r) {
    const t = this.def;
    return this.clone(Ee(t, {
      checks: [
        ...t.checks ?? [],
        ...r.map((o) => typeof o == "function" ? { _zod: { check: o, def: { check: "custom" }, onattach: [] } } : o)
      ]
    }), { parent: !0 });
  },
  with(...r) {
    return this.check(...r);
  },
  clone(r, t) {
    return Ne(this, r, t);
  },
  brand() {
    return this;
  },
  register(r, t) {
    return r.add(this, t), this;
  },
  refine(r, t) {
    return this.check(Xf(r, t));
  },
  superRefine(r, t) {
    return this.check(Qf(r, t));
  },
  overwrite(r) {
    return this.check(/* @__PURE__ */ Fn(r));
  },
  optional() {
    return ln(this);
  },
  exactOptional() {
    return Uf(this);
  },
  nullable() {
    return bo(this);
  },
  nullish() {
    return ln(bo(this));
  },
  nonoptional(r) {
    return Kf(this, r);
  },
  array() {
    return Hr(this);
  },
  or(r) {
    return ft([this, r]);
  },
  and(r) {
    return Pf(this, r);
  },
  transform(r) {
    return Fo(this, Nf(r));
  },
  default(r) {
    return Df(this, r);
  },
  prefault(r) {
    return Bf(this, r);
  },
  catch(r) {
    return Jf(this, r);
  },
  pipe(r) {
    return Fo(this, r);
  },
  readonly() {
    return qf(this);
  },
  describe(r) {
    const t = this.clone();
    return Pn.add(t, { description: r }), t;
  },
  meta(...r) {
    if (r.length === 0)
      return Pn.get(this);
    const t = this.clone();
    return Pn.add(t, r[0]), t;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(r) {
    return r(this);
  }
}), Object.defineProperty(e, "description", {
  get() {
    var r;
    return (r = Pn.get(e)) == null ? void 0 : r.description;
  },
  configurable: !0
}), e)), ri = /* @__PURE__ */ d("_ZodString", (e, n) => {
  at.init(e, n), P.init(e, n), e._zod.processJSONSchema = (t, o, u) => ga(e, t, o);
  const r = e._zod.bag;
  e.format = r.format ?? null, e.minLength = r.minimum ?? null, e.maxLength = r.maximum ?? null, Bn(e, "_ZodString", {
    regex(...t) {
      return this.check(/* @__PURE__ */ Qs(...t));
    },
    includes(...t) {
      return this.check(/* @__PURE__ */ ra(...t));
    },
    startsWith(...t) {
      return this.check(/* @__PURE__ */ ta(...t));
    },
    endsWith(...t) {
      return this.check(/* @__PURE__ */ oa(...t));
    },
    min(...t) {
      return this.check(/* @__PURE__ */ fr(...t));
    },
    max(...t) {
      return this.check(/* @__PURE__ */ qo(...t));
    },
    length(...t) {
      return this.check(/* @__PURE__ */ Yo(...t));
    },
    nonempty(...t) {
      return this.check(/* @__PURE__ */ fr(1, ...t));
    },
    lowercase(t) {
      return this.check(/* @__PURE__ */ ea(t));
    },
    uppercase(t) {
      return this.check(/* @__PURE__ */ na(t));
    },
    trim() {
      return this.check(/* @__PURE__ */ ua());
    },
    normalize(...t) {
      return this.check(/* @__PURE__ */ ia(...t));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ ca());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ sa());
    },
    slugify() {
      return this.check(/* @__PURE__ */ aa());
    }
  });
}), tf = /* @__PURE__ */ d("ZodString", (e, n) => {
  at.init(e, n), ri.init(e, n), e.email = (r) => e.check(/* @__PURE__ */ $s(of, r)), e.url = (r) => e.check(/* @__PURE__ */ zs(uf, r)), e.jwt = (r) => e.check(/* @__PURE__ */ Ws(vf, r)), e.emoji = (r) => e.check(/* @__PURE__ */ Ss(cf, r)), e.guid = (r) => e.check(/* @__PURE__ */ so(po, r)), e.uuid = (r) => e.check(/* @__PURE__ */ ws(ir, r)), e.uuidv4 = (r) => e.check(/* @__PURE__ */ ks(ir, r)), e.uuidv6 = (r) => e.check(/* @__PURE__ */ Is(ir, r)), e.uuidv7 = (r) => e.check(/* @__PURE__ */ Rs(ir, r)), e.nanoid = (r) => e.check(/* @__PURE__ */ As(sf, r)), e.guid = (r) => e.check(/* @__PURE__ */ so(po, r)), e.cuid = (r) => e.check(/* @__PURE__ */ xs(af, r)), e.cuid2 = (r) => e.check(/* @__PURE__ */ Ts(ff, r)), e.ulid = (r) => e.check(/* @__PURE__ */ Ps(df, r)), e.base64 = (r) => e.check(/* @__PURE__ */ Ms(Ff, r)), e.base64url = (r) => e.check(/* @__PURE__ */ Ls(_f, r)), e.xid = (r) => e.check(/* @__PURE__ */ Zs(lf, r)), e.ksuid = (r) => e.check(/* @__PURE__ */ js(mf, r)), e.ipv4 = (r) => e.check(/* @__PURE__ */ Es(pf, r)), e.ipv6 = (r) => e.check(/* @__PURE__ */ Ns(hf, r)), e.cidrv4 = (r) => e.check(/* @__PURE__ */ Cs(gf, r)), e.cidrv6 = (r) => e.check(/* @__PURE__ */ Us(bf, r)), e.e164 = (r) => e.check(/* @__PURE__ */ Ds(Of, r)), e.datetime = (r) => e.check(Na(r)), e.date = (r) => e.check(Ua(r)), e.time = (r) => e.check(La(r)), e.duration = (r) => e.check(Wa(r));
});
function Nn(e) {
  return /* @__PURE__ */ ys(tf, e);
}
const S = /* @__PURE__ */ d("ZodStringFormat", (e, n) => {
  z.init(e, n), ri.init(e, n);
}), of = /* @__PURE__ */ d("ZodEmail", (e, n) => {
  Ac.init(e, n), S.init(e, n);
}), po = /* @__PURE__ */ d("ZodGUID", (e, n) => {
  zc.init(e, n), S.init(e, n);
}), ir = /* @__PURE__ */ d("ZodUUID", (e, n) => {
  Sc.init(e, n), S.init(e, n);
}), uf = /* @__PURE__ */ d("ZodURL", (e, n) => {
  xc.init(e, n), S.init(e, n);
}), cf = /* @__PURE__ */ d("ZodEmoji", (e, n) => {
  Tc.init(e, n), S.init(e, n);
}), sf = /* @__PURE__ */ d("ZodNanoID", (e, n) => {
  Pc.init(e, n), S.init(e, n);
}), af = /* @__PURE__ */ d("ZodCUID", (e, n) => {
  Zc.init(e, n), S.init(e, n);
}), ff = /* @__PURE__ */ d("ZodCUID2", (e, n) => {
  jc.init(e, n), S.init(e, n);
}), df = /* @__PURE__ */ d("ZodULID", (e, n) => {
  Ec.init(e, n), S.init(e, n);
}), lf = /* @__PURE__ */ d("ZodXID", (e, n) => {
  Nc.init(e, n), S.init(e, n);
}), mf = /* @__PURE__ */ d("ZodKSUID", (e, n) => {
  Cc.init(e, n), S.init(e, n);
}), pf = /* @__PURE__ */ d("ZodIPv4", (e, n) => {
  Wc.init(e, n), S.init(e, n);
}), hf = /* @__PURE__ */ d("ZodIPv6", (e, n) => {
  Bc.init(e, n), S.init(e, n);
}), gf = /* @__PURE__ */ d("ZodCIDRv4", (e, n) => {
  Kc.init(e, n), S.init(e, n);
}), bf = /* @__PURE__ */ d("ZodCIDRv6", (e, n) => {
  Vc.init(e, n), S.init(e, n);
}), Ff = /* @__PURE__ */ d("ZodBase64", (e, n) => {
  Jc.init(e, n), S.init(e, n);
}), _f = /* @__PURE__ */ d("ZodBase64URL", (e, n) => {
  Gc.init(e, n), S.init(e, n);
}), Of = /* @__PURE__ */ d("ZodE164", (e, n) => {
  qc.init(e, n), S.init(e, n);
}), vf = /* @__PURE__ */ d("ZodJWT", (e, n) => {
  Xc.init(e, n), S.init(e, n);
}), ti = /* @__PURE__ */ d("ZodNumber", (e, n) => {
  Vo.init(e, n), P.init(e, n), e._zod.processJSONSchema = (t, o, u) => ba(e, t, o), Bn(e, "ZodNumber", {
    gt(t, o) {
      return this.check(/* @__PURE__ */ fo(t, o));
    },
    gte(t, o) {
      return this.check(/* @__PURE__ */ Wr(t, o));
    },
    min(t, o) {
      return this.check(/* @__PURE__ */ Wr(t, o));
    },
    lt(t, o) {
      return this.check(/* @__PURE__ */ ao(t, o));
    },
    lte(t, o) {
      return this.check(/* @__PURE__ */ Dr(t, o));
    },
    max(t, o) {
      return this.check(/* @__PURE__ */ Dr(t, o));
    },
    int(t) {
      return this.check(ho(t));
    },
    safe(t) {
      return this.check(ho(t));
    },
    positive(t) {
      return this.check(/* @__PURE__ */ fo(0, t));
    },
    nonnegative(t) {
      return this.check(/* @__PURE__ */ Wr(0, t));
    },
    negative(t) {
      return this.check(/* @__PURE__ */ ao(0, t));
    },
    nonpositive(t) {
      return this.check(/* @__PURE__ */ Dr(0, t));
    },
    multipleOf(t, o) {
      return this.check(/* @__PURE__ */ lo(t, o));
    },
    step(t, o) {
      return this.check(/* @__PURE__ */ lo(t, o));
    },
    finite() {
      return this;
    }
  });
  const r = e._zod.bag;
  e.minValue = Math.max(r.minimum ?? Number.NEGATIVE_INFINITY, r.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(r.maximum ?? Number.POSITIVE_INFINITY, r.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (r.format ?? "").includes("int") || Number.isSafeInteger(r.multipleOf ?? 0.5), e.isFinite = !0, e.format = r.format ?? null;
});
function yf(e) {
  return /* @__PURE__ */ Hs(ti, e);
}
const $f = /* @__PURE__ */ d("ZodNumberFormat", (e, n) => {
  Qc.init(e, n), ti.init(e, n);
});
function ho(e) {
  return /* @__PURE__ */ Gs($f, e);
}
const wf = /* @__PURE__ */ d("ZodBoolean", (e, n) => {
  es.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Fa(e, r, t);
});
function kf(e) {
  return /* @__PURE__ */ qs(wf, e);
}
const If = /* @__PURE__ */ d("ZodUnknown", (e, n) => {
  ns.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Oa();
});
function go() {
  return /* @__PURE__ */ Ys(If);
}
const Rf = /* @__PURE__ */ d("ZodNever", (e, n) => {
  rs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => _a(e, r, t);
});
function zf(e) {
  return /* @__PURE__ */ Xs(Rf, e);
}
const Sf = /* @__PURE__ */ d("ZodArray", (e, n) => {
  ts.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => ka(e, r, t, o), e.element = n.element, Bn(e, "ZodArray", {
    min(r, t) {
      return this.check(/* @__PURE__ */ fr(r, t));
    },
    nonempty(r) {
      return this.check(/* @__PURE__ */ fr(1, r));
    },
    max(r, t) {
      return this.check(/* @__PURE__ */ qo(r, t));
    },
    length(r, t) {
      return this.check(/* @__PURE__ */ Yo(r, t));
    },
    unwrap() {
      return this.element;
    }
  });
});
function Hr(e, n) {
  return /* @__PURE__ */ fa(Sf, e, n);
}
const Af = /* @__PURE__ */ d("ZodObject", (e, n) => {
  is.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Ia(e, r, t, o), k(e, "shape", () => n.shape), Bn(e, "ZodObject", {
    keyof() {
      return Zf(Object.keys(this._zod.def.shape));
    },
    catchall(r) {
      return this.clone({ ...this._zod.def, catchall: r });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: go() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: go() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: zf() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: void 0 });
    },
    extend(r) {
      return $u(this, r);
    },
    safeExtend(r) {
      return wu(this, r);
    },
    merge(r) {
      return ku(this, r);
    },
    pick(r) {
      return vu(this, r);
    },
    omit(r) {
      return yu(this, r);
    },
    partial(...r) {
      return Iu(oi, this, r[0]);
    },
    required(...r) {
      return Ru(ii, this, r[0]);
    }
  });
});
function Ke(e, n) {
  const r = {
    type: "object",
    shape: e ?? {},
    ..._(n)
  };
  return new Af(r);
}
const xf = /* @__PURE__ */ d("ZodUnion", (e, n) => {
  us.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Ra(e, r, t, o), e.options = n.options;
});
function ft(e, n) {
  return new xf({
    type: "union",
    options: e,
    ..._(n)
  });
}
const Tf = /* @__PURE__ */ d("ZodIntersection", (e, n) => {
  cs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => za(e, r, t, o);
});
function Pf(e, n) {
  return new Tf({
    type: "intersection",
    left: e,
    right: n
  });
}
const Gr = /* @__PURE__ */ d("ZodEnum", (e, n) => {
  ss.init(e, n), P.init(e, n), e._zod.processJSONSchema = (t, o, u) => va(e, t, o), e.enum = n.entries, e.options = Object.values(n.entries);
  const r = new Set(Object.keys(n.entries));
  e.extract = (t, o) => {
    const u = {};
    for (const c of t)
      if (r.has(c))
        u[c] = n.entries[c];
      else
        throw new Error(`Key ${c} not found in enum`);
    return new Gr({
      ...n,
      checks: [],
      ..._(o),
      entries: u
    });
  }, e.exclude = (t, o) => {
    const u = { ...n.entries };
    for (const c of t)
      if (r.has(c))
        delete u[c];
      else
        throw new Error(`Key ${c} not found in enum`);
    return new Gr({
      ...n,
      checks: [],
      ..._(o),
      entries: u
    });
  };
});
function Zf(e, n) {
  const r = Array.isArray(e) ? Object.fromEntries(e.map((t) => [t, t])) : e;
  return new Gr({
    type: "enum",
    entries: r,
    ..._(n)
  });
}
const jf = /* @__PURE__ */ d("ZodLiteral", (e, n) => {
  as.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => ya(e, r, t), e.values = new Set(n.values), Object.defineProperty(e, "value", {
    get() {
      if (n.values.length > 1)
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      return n.values[0];
    }
  });
});
function An(e, n) {
  return new jf({
    type: "literal",
    values: Array.isArray(e) ? e : [e],
    ..._(n)
  });
}
const Ef = /* @__PURE__ */ d("ZodTransform", (e, n) => {
  fs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => wa(e, r), e._zod.parse = (r, t) => {
    if (t.direction === "backward")
      throw new xo(e.constructor.name);
    r.addIssue = (u) => {
      if (typeof u == "string")
        r.issues.push(En(u, r.value, n));
      else {
        const c = u;
        c.fatal && (c.continue = !1), c.code ?? (c.code = "custom"), c.input ?? (c.input = r.value), c.inst ?? (c.inst = e), r.issues.push(En(c));
      }
    };
    const o = n.transform(r.value, r);
    return o instanceof Promise ? o.then((u) => (r.value = u, r.fallback = !0, r)) : (r.value = o, r.fallback = !0, r);
  };
});
function Nf(e) {
  return new Ef({
    type: "transform",
    transform: e
  });
}
const oi = /* @__PURE__ */ d("ZodOptional", (e, n) => {
  Go.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => ni(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function ln(e) {
  return new oi({
    type: "optional",
    innerType: e
  });
}
const Cf = /* @__PURE__ */ d("ZodExactOptional", (e, n) => {
  ds.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => ni(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function Uf(e) {
  return new Cf({
    type: "optional",
    innerType: e
  });
}
const Mf = /* @__PURE__ */ d("ZodNullable", (e, n) => {
  ls.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Sa(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function bo(e) {
  return new Mf({
    type: "nullable",
    innerType: e
  });
}
const Lf = /* @__PURE__ */ d("ZodDefault", (e, n) => {
  ms.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => xa(e, r, t, o), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function Df(e, n) {
  return new Lf({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof n == "function" ? n() : Zo(n);
    }
  });
}
const Wf = /* @__PURE__ */ d("ZodPrefault", (e, n) => {
  ps.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Ta(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function Bf(e, n) {
  return new Wf({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof n == "function" ? n() : Zo(n);
    }
  });
}
const ii = /* @__PURE__ */ d("ZodNonOptional", (e, n) => {
  hs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Aa(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function Kf(e, n) {
  return new ii({
    type: "nonoptional",
    innerType: e,
    ..._(n)
  });
}
const Vf = /* @__PURE__ */ d("ZodCatch", (e, n) => {
  gs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Pa(e, r, t, o), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Jf(e, n) {
  return new Vf({
    type: "catch",
    innerType: e,
    catchValue: typeof n == "function" ? n : () => n
  });
}
const Hf = /* @__PURE__ */ d("ZodPipe", (e, n) => {
  bs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => Za(e, r, t, o), e.in = n.in, e.out = n.out;
});
function Fo(e, n) {
  return new Hf({
    type: "pipe",
    in: e,
    out: n
    // ...util.normalizeParams(params),
  });
}
const Gf = /* @__PURE__ */ d("ZodReadonly", (e, n) => {
  Fs.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => ja(e, r, t, o), e.unwrap = () => e._zod.def.innerType;
});
function qf(e) {
  return new Gf({
    type: "readonly",
    innerType: e
  });
}
const Yf = /* @__PURE__ */ d("ZodCustom", (e, n) => {
  _s.init(e, n), P.init(e, n), e._zod.processJSONSchema = (r, t, o) => $a(e, r);
});
function Xf(e, n = {}) {
  return /* @__PURE__ */ da(Yf, e, n);
}
function Qf(e, n) {
  return /* @__PURE__ */ la(e, n);
}
Ke({
  app: Nn(),
  api: Nn()
});
const ed = Ke({
  request: ln(Ke({
    urls: Hr(Nn()),
    methods: Hr(ft([An("GET"), An("POST"), An("PATCH"), An("PUT"), An("DELETE")]))
  })),
  log: ln(Ke({})),
  sleep: ln(Ke({}))
});
ln(Ke({
  enabled: kf(),
  requestedScopes: ed
}));
function nd(e) {
  return C(e) && !se(e) && !Vn(e) && Symbol.asyncIterator in e;
}
function se(e) {
  return Array.isArray(e);
}
function ui(e) {
  return typeof e == "bigint";
}
function Kn(e) {
  return typeof e == "boolean";
}
function dt(e) {
  return e instanceof globalThis.Date;
}
function rd(e) {
  return typeof e == "function";
}
function td(e) {
  return C(e) && !se(e) && !Vn(e) && Symbol.iterator in e;
}
function od(e) {
  return e === null;
}
function Ie(e) {
  return typeof e == "number";
}
function C(e) {
  return typeof e == "object" && e !== null;
}
function ci(e) {
  return e instanceof globalThis.RegExp;
}
function j(e) {
  return typeof e == "string";
}
function id(e) {
  return typeof e == "symbol";
}
function Vn(e) {
  return e instanceof globalThis.Uint8Array;
}
function E(e) {
  return e === void 0;
}
function ud(e) {
  return e.map((n) => lr(n));
}
function cd(e) {
  return new Date(e.getTime());
}
function sd(e) {
  return new Uint8Array(e);
}
function ad(e) {
  return new RegExp(e.source, e.flags);
}
function fd(e) {
  const n = {};
  for (const r of Object.getOwnPropertyNames(e))
    n[r] = lr(e[r]);
  for (const r of Object.getOwnPropertySymbols(e))
    n[r] = lr(e[r]);
  return n;
}
function lr(e) {
  return se(e) ? ud(e) : dt(e) ? cd(e) : Vn(e) ? sd(e) : ci(e) ? ad(e) : C(e) ? fd(e) : e;
}
function fe(e) {
  return lr(e);
}
function lt(e, n) {
  return fe(n === void 0 ? e : { ...n, ...e });
}
function dd(e) {
  return e !== null && typeof e == "object";
}
function ld(e) {
  return globalThis.Array.isArray(e) && !globalThis.ArrayBuffer.isView(e);
}
function md(e) {
  return e === void 0;
}
function pd(e) {
  return typeof e == "number";
}
var qr;
(function(e) {
  e.InstanceMode = "default", e.ExactOptionalPropertyTypes = !1, e.AllowArrayObject = !1, e.AllowNaN = !1, e.AllowNullVoid = !1;
  function n(c, s) {
    return e.ExactOptionalPropertyTypes ? s in c : c[s] !== void 0;
  }
  e.IsExactOptionalProperty = n;
  function r(c) {
    const s = dd(c);
    return e.AllowArrayObject ? s : s && !ld(c);
  }
  e.IsObjectLike = r;
  function t(c) {
    return r(c) && !(c instanceof Date) && !(c instanceof Uint8Array);
  }
  e.IsRecordLike = t;
  function o(c) {
    return e.AllowNaN ? pd(c) : Number.isFinite(c);
  }
  e.IsNumberLike = o;
  function u(c) {
    const s = md(c);
    return e.AllowNullVoid ? s || c === null : s;
  }
  e.IsVoidLike = u;
})(qr || (qr = {}));
function hd(e) {
  return globalThis.Object.freeze(e).map((n) => mr(n));
}
function gd(e) {
  const n = {};
  for (const r of Object.getOwnPropertyNames(e))
    n[r] = mr(e[r]);
  for (const r of Object.getOwnPropertySymbols(e))
    n[r] = mr(e[r]);
  return globalThis.Object.freeze(n);
}
function mr(e) {
  return se(e) ? hd(e) : dt(e) ? e : Vn(e) ? e : ci(e) ? e : C(e) ? gd(e) : e;
}
function g(e, n) {
  const r = n !== void 0 ? { ...n, ...e } : e;
  switch (qr.InstanceMode) {
    case "freeze":
      return mr(r);
    case "clone":
      return fe(r);
    default:
      return r;
  }
}
class Xe extends Error {
  constructor(n) {
    super(n);
  }
}
const he = Symbol.for("TypeBox.Transform"), Jn = Symbol.for("TypeBox.Readonly"), Ae = Symbol.for("TypeBox.Optional"), _r = Symbol.for("TypeBox.Hint"), O = Symbol.for("TypeBox.Kind");
function mt(e) {
  return C(e) && e[Jn] === "Readonly";
}
function Ce(e) {
  return C(e) && e[Ae] === "Optional";
}
function si(e) {
  return v(e, "Any");
}
function ai(e) {
  return v(e, "Argument");
}
function _n(e) {
  return v(e, "Array");
}
function Or(e) {
  return v(e, "AsyncIterator");
}
function vr(e) {
  return v(e, "BigInt");
}
function Hn(e) {
  return v(e, "Boolean");
}
function On(e) {
  return v(e, "Computed");
}
function vn(e) {
  return v(e, "Constructor");
}
function bd(e) {
  return v(e, "Date");
}
function yn(e) {
  return v(e, "Function");
}
function $n(e) {
  return v(e, "Integer");
}
function Fe(e) {
  return v(e, "Intersect");
}
function yr(e) {
  return v(e, "Iterator");
}
function v(e, n) {
  return C(e) && O in e && e[O] === n;
}
function fi(e) {
  return Kn(e) || Ie(e) || j(e);
}
function Qe(e) {
  return v(e, "Literal");
}
function en(e) {
  return v(e, "MappedKey");
}
function me(e) {
  return v(e, "MappedResult");
}
function Gn(e) {
  return v(e, "Never");
}
function Fd(e) {
  return v(e, "Not");
}
function pt(e) {
  return v(e, "Null");
}
function wn(e) {
  return v(e, "Number");
}
function we(e) {
  return v(e, "Object");
}
function $r(e) {
  return v(e, "Promise");
}
function wr(e) {
  return v(e, "Record");
}
function ie(e) {
  return v(e, "Ref");
}
function di(e) {
  return v(e, "RegExp");
}
function qn(e) {
  return v(e, "String");
}
function ht(e) {
  return v(e, "Symbol");
}
function nn(e) {
  return v(e, "TemplateLiteral");
}
function _d(e) {
  return v(e, "This");
}
function kr(e) {
  return C(e) && he in e;
}
function rn(e) {
  return v(e, "Tuple");
}
function gt(e) {
  return v(e, "Undefined");
}
function K(e) {
  return v(e, "Union");
}
function Od(e) {
  return v(e, "Uint8Array");
}
function vd(e) {
  return v(e, "Unknown");
}
function yd(e) {
  return v(e, "Unsafe");
}
function $d(e) {
  return v(e, "Void");
}
function wd(e) {
  return C(e) && O in e && j(e[O]);
}
function je(e) {
  return si(e) || ai(e) || _n(e) || Hn(e) || vr(e) || Or(e) || On(e) || vn(e) || bd(e) || yn(e) || $n(e) || Fe(e) || yr(e) || Qe(e) || en(e) || me(e) || Gn(e) || Fd(e) || pt(e) || wn(e) || we(e) || $r(e) || wr(e) || ie(e) || di(e) || qn(e) || ht(e) || nn(e) || _d(e) || rn(e) || gt(e) || K(e) || Od(e) || vd(e) || yd(e) || $d(e) || wd(e);
}
const kd = [
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
function li(e) {
  try {
    return new RegExp(e), !0;
  } catch {
    return !1;
  }
}
function bt(e) {
  if (!j(e))
    return !1;
  for (let n = 0; n < e.length; n++) {
    const r = e.charCodeAt(n);
    if (r >= 7 && r <= 13 || r === 27 || r === 127)
      return !1;
  }
  return !0;
}
function mi(e) {
  return Ft(e) || q(e);
}
function xn(e) {
  return E(e) || ui(e);
}
function R(e) {
  return E(e) || Ie(e);
}
function Ft(e) {
  return E(e) || Kn(e);
}
function w(e) {
  return E(e) || j(e);
}
function Id(e) {
  return E(e) || j(e) && bt(e) && li(e);
}
function Rd(e) {
  return E(e) || j(e) && bt(e);
}
function pi(e) {
  return E(e) || q(e);
}
function pr(e) {
  return C(e) && e[Ae] === "Optional";
}
function Oe(e) {
  return y(e, "Any") && w(e.$id);
}
function zd(e) {
  return y(e, "Argument") && Ie(e.index);
}
function tn(e) {
  return y(e, "Array") && e.type === "array" && w(e.$id) && q(e.items) && R(e.minItems) && R(e.maxItems) && Ft(e.uniqueItems) && pi(e.contains) && R(e.minContains) && R(e.maxContains);
}
function _t(e) {
  return y(e, "AsyncIterator") && e.type === "AsyncIterator" && w(e.$id) && q(e.items);
}
function Ir(e) {
  return y(e, "BigInt") && e.type === "bigint" && w(e.$id) && xn(e.exclusiveMaximum) && xn(e.exclusiveMinimum) && xn(e.maximum) && xn(e.minimum) && xn(e.multipleOf);
}
function on(e) {
  return y(e, "Boolean") && e.type === "boolean" && w(e.$id);
}
function Sd(e) {
  return y(e, "Computed") && j(e.target) && se(e.parameters) && e.parameters.every((n) => q(n));
}
function Rr(e) {
  return y(e, "Constructor") && e.type === "Constructor" && w(e.$id) && se(e.parameters) && e.parameters.every((n) => q(n)) && q(e.returns);
}
function zr(e) {
  return y(e, "Date") && e.type === "Date" && w(e.$id) && R(e.exclusiveMaximumTimestamp) && R(e.exclusiveMinimumTimestamp) && R(e.maximumTimestamp) && R(e.minimumTimestamp) && R(e.multipleOfTimestamp);
}
function Sr(e) {
  return y(e, "Function") && e.type === "Function" && w(e.$id) && se(e.parameters) && e.parameters.every((n) => q(n)) && q(e.returns);
}
function xe(e) {
  return y(e, "Integer") && e.type === "integer" && w(e.$id) && R(e.exclusiveMaximum) && R(e.exclusiveMinimum) && R(e.maximum) && R(e.minimum) && R(e.multipleOf);
}
function hi(e) {
  return C(e) && Object.entries(e).every(([n, r]) => bt(n) && q(r));
}
function un(e) {
  return y(e, "Intersect") && !(j(e.type) && e.type !== "object") && se(e.allOf) && e.allOf.every((n) => q(n) && !jd(n)) && w(e.type) && (Ft(e.unevaluatedProperties) || pi(e.unevaluatedProperties)) && w(e.$id);
}
function Ot(e) {
  return y(e, "Iterator") && e.type === "Iterator" && w(e.$id) && q(e.items);
}
function y(e, n) {
  return C(e) && O in e && e[O] === n;
}
function gi(e) {
  return Ue(e) && j(e.const);
}
function bi(e) {
  return Ue(e) && Ie(e.const);
}
function Fi(e) {
  return Ue(e) && Kn(e.const);
}
function Ue(e) {
  return y(e, "Literal") && w(e.$id) && Ad(e.const);
}
function Ad(e) {
  return Kn(e) || Ie(e) || j(e);
}
function xd(e) {
  return y(e, "MappedKey") && se(e.keys) && e.keys.every((n) => Ie(n) || j(n));
}
function Td(e) {
  return y(e, "MappedResult") && hi(e.properties);
}
function Me(e) {
  return y(e, "Never") && C(e.not) && Object.getOwnPropertyNames(e.not).length === 0;
}
function pn(e) {
  return y(e, "Not") && q(e.not);
}
function vt(e) {
  return y(e, "Null") && e.type === "null" && w(e.$id);
}
function oe(e) {
  return y(e, "Number") && e.type === "number" && w(e.$id) && R(e.exclusiveMaximum) && R(e.exclusiveMinimum) && R(e.maximum) && R(e.minimum) && R(e.multipleOf);
}
function A(e) {
  return y(e, "Object") && e.type === "object" && w(e.$id) && hi(e.properties) && mi(e.additionalProperties) && R(e.minProperties) && R(e.maxProperties);
}
function yt(e) {
  return y(e, "Promise") && e.type === "Promise" && w(e.$id) && q(e.item);
}
function G(e) {
  return y(e, "Record") && e.type === "object" && w(e.$id) && mi(e.additionalProperties) && C(e.patternProperties) && ((n) => {
    const r = Object.getOwnPropertyNames(n.patternProperties);
    return r.length === 1 && li(r[0]) && C(n.patternProperties) && q(n.patternProperties[r[0]]);
  })(e);
}
function Pd(e) {
  return y(e, "Ref") && w(e.$id) && j(e.$ref);
}
function Cn(e) {
  return y(e, "RegExp") && w(e.$id) && j(e.source) && j(e.flags) && R(e.maxLength) && R(e.minLength);
}
function ve(e) {
  return y(e, "String") && e.type === "string" && w(e.$id) && R(e.minLength) && R(e.maxLength) && Id(e.pattern) && Rd(e.format);
}
function Un(e) {
  return y(e, "Symbol") && e.type === "symbol" && w(e.$id);
}
function Mn(e) {
  return y(e, "TemplateLiteral") && e.type === "string" && j(e.pattern) && e.pattern[0] === "^" && e.pattern[e.pattern.length - 1] === "$";
}
function Zd(e) {
  return y(e, "This") && w(e.$id) && j(e.$ref);
}
function jd(e) {
  return C(e) && he in e;
}
function Ar(e) {
  return y(e, "Tuple") && e.type === "array" && w(e.$id) && Ie(e.minItems) && Ie(e.maxItems) && e.minItems === e.maxItems && // empty
  (E(e.items) && E(e.additionalItems) && e.minItems === 0 || se(e.items) && e.items.every((n) => q(n)));
}
function Ge(e) {
  return y(e, "Undefined") && e.type === "undefined" && w(e.$id);
}
function Se(e) {
  return y(e, "Union") && w(e.$id) && C(e) && se(e.anyOf) && e.anyOf.every((n) => q(n));
}
function Yn(e) {
  return y(e, "Uint8Array") && e.type === "Uint8Array" && w(e.$id) && R(e.minByteLength) && R(e.maxByteLength);
}
function ye(e) {
  return y(e, "Unknown") && w(e.$id);
}
function Ed(e) {
  return y(e, "Unsafe");
}
function xr(e) {
  return y(e, "Void") && e.type === "void" && w(e.$id);
}
function Nd(e) {
  return C(e) && O in e && j(e[O]) && !kd.includes(e[O]);
}
function q(e) {
  return C(e) && (Oe(e) || zd(e) || tn(e) || on(e) || Ir(e) || _t(e) || Sd(e) || Rr(e) || zr(e) || Sr(e) || xe(e) || un(e) || Ot(e) || Ue(e) || xd(e) || Td(e) || Me(e) || pn(e) || vt(e) || oe(e) || A(e) || yt(e) || G(e) || Pd(e) || Cn(e) || ve(e) || Un(e) || Mn(e) || Zd(e) || Ar(e) || Ge(e) || Se(e) || Yn(e) || ye(e) || Ed(e) || xr(e) || Nd(e));
}
const Cd = "(true|false)", cr = "(0|[1-9][0-9]*)", _i = "(.*)", Ud = "(?!.*)", hn = `^${cr}$`, gn = `^${_i}$`, Md = `^${Ud}$`;
function Ld(e, n) {
  return e.includes(n);
}
function Dd(e) {
  return [...new Set(e)];
}
function Wd(e, n) {
  return e.filter((r) => n.includes(r));
}
function Bd(e, n) {
  return e.reduce((r, t) => Wd(r, t), n);
}
function Kd(e) {
  return e.length === 1 ? e[0] : e.length > 1 ? Bd(e.slice(1), e[0]) : [];
}
function Vd(e) {
  const n = [];
  for (const r of e)
    n.push(...r);
  return n;
}
function Ln(e) {
  return g({ [O]: "Any" }, e);
}
function $t(e, n) {
  return g({ [O]: "Array", type: "array", items: e }, n);
}
function Jd(e) {
  return g({ [O]: "Argument", index: e });
}
function wt(e, n) {
  return g({ [O]: "AsyncIterator", type: "AsyncIterator", items: e }, n);
}
function W(e, n, r) {
  return g({ [O]: "Computed", target: e, parameters: n }, r);
}
function Hd(e, n) {
  const { [n]: r, ...t } = e;
  return t;
}
function de(e, n) {
  return n.reduce((r, t) => Hd(r, t), e);
}
function U(e) {
  return g({ [O]: "Never", not: {} }, e);
}
function Y(e) {
  return g({
    [O]: "MappedResult",
    properties: e
  });
}
function kt(e, n, r) {
  return g({ [O]: "Constructor", type: "Constructor", parameters: e, returns: n }, r);
}
function Xn(e, n, r) {
  return g({ [O]: "Function", type: "Function", parameters: e, returns: n }, r);
}
function Yr(e, n) {
  return g({ [O]: "Union", anyOf: e }, n);
}
function Gd(e) {
  return e.some((n) => Ce(n));
}
function _o(e) {
  return e.map((n) => Ce(n) ? qd(n) : n);
}
function qd(e) {
  return de(e, [Ae]);
}
function Yd(e, n) {
  return Gd(e) ? We(Yr(_o(e), n)) : Yr(_o(e), n);
}
function kn(e, n) {
  return e.length === 1 ? g(e[0], n) : e.length === 0 ? U(n) : Yd(e, n);
}
function X(e, n) {
  return e.length === 0 ? U(n) : e.length === 1 ? g(e[0], n) : Yr(e, n);
}
class Oo extends Xe {
}
function Xd(e) {
  return e.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function It(e, n, r) {
  return e[n] === r && e.charCodeAt(n - 1) !== 92;
}
function ze(e, n) {
  return It(e, n, "(");
}
function Dn(e, n) {
  return It(e, n, ")");
}
function Oi(e, n) {
  return It(e, n, "|");
}
function Qd(e) {
  if (!(ze(e, 0) && Dn(e, e.length - 1)))
    return !1;
  let n = 0;
  for (let r = 0; r < e.length; r++)
    if (ze(e, r) && (n += 1), Dn(e, r) && (n -= 1), n === 0 && r !== e.length - 1)
      return !1;
  return !0;
}
function el(e) {
  return e.slice(1, e.length - 1);
}
function nl(e) {
  let n = 0;
  for (let r = 0; r < e.length; r++)
    if (ze(e, r) && (n += 1), Dn(e, r) && (n -= 1), Oi(e, r) && n === 0)
      return !0;
  return !1;
}
function rl(e) {
  for (let n = 0; n < e.length; n++)
    if (ze(e, n))
      return !0;
  return !1;
}
function tl(e) {
  let [n, r] = [0, 0];
  const t = [];
  for (let u = 0; u < e.length; u++)
    if (ze(e, u) && (n += 1), Dn(e, u) && (n -= 1), Oi(e, u) && n === 0) {
      const c = e.slice(r, u);
      c.length > 0 && t.push(bn(c)), r = u + 1;
    }
  const o = e.slice(r);
  return o.length > 0 && t.push(bn(o)), t.length === 0 ? { type: "const", const: "" } : t.length === 1 ? t[0] : { type: "or", expr: t };
}
function ol(e) {
  function n(o, u) {
    if (!ze(o, u))
      throw new Oo("TemplateLiteralParser: Index must point to open parens");
    let c = 0;
    for (let s = u; s < o.length; s++)
      if (ze(o, s) && (c += 1), Dn(o, s) && (c -= 1), c === 0)
        return [u, s];
    throw new Oo("TemplateLiteralParser: Unclosed group parens in expression");
  }
  function r(o, u) {
    for (let c = u; c < o.length; c++)
      if (ze(o, c))
        return [u, c];
    return [u, o.length];
  }
  const t = [];
  for (let o = 0; o < e.length; o++)
    if (ze(e, o)) {
      const [u, c] = n(e, o), s = e.slice(u, c + 1);
      t.push(bn(s)), o = c;
    } else {
      const [u, c] = r(e, o), s = e.slice(u, c);
      s.length > 0 && t.push(bn(s)), o = c - 1;
    }
  return t.length === 0 ? { type: "const", const: "" } : t.length === 1 ? t[0] : { type: "and", expr: t };
}
function bn(e) {
  return Qd(e) ? bn(el(e)) : nl(e) ? tl(e) : rl(e) ? ol(e) : { type: "const", const: Xd(e) };
}
function Rt(e) {
  return bn(e.slice(1, e.length - 1));
}
class il extends Xe {
}
function ul(e) {
  return e.type === "or" && e.expr.length === 2 && e.expr[0].type === "const" && e.expr[0].const === "0" && e.expr[1].type === "const" && e.expr[1].const === "[1-9][0-9]*";
}
function cl(e) {
  return e.type === "or" && e.expr.length === 2 && e.expr[0].type === "const" && e.expr[0].const === "true" && e.expr[1].type === "const" && e.expr[1].const === "false";
}
function sl(e) {
  return e.type === "const" && e.const === ".*";
}
function Wn(e) {
  return ul(e) || sl(e) ? !1 : cl(e) ? !0 : e.type === "and" ? e.expr.every((n) => Wn(n)) : e.type === "or" ? e.expr.every((n) => Wn(n)) : e.type === "const" ? !0 : (() => {
    throw new il("Unknown expression type");
  })();
}
function al(e) {
  const n = Rt(e.pattern);
  return Wn(n);
}
class fl extends Xe {
}
function* vi(e) {
  if (e.length === 1)
    return yield* e[0];
  for (const n of e[0])
    for (const r of vi(e.slice(1)))
      yield `${n}${r}`;
}
function* dl(e) {
  return yield* vi(e.expr.map((n) => [...Tr(n)]));
}
function* ll(e) {
  for (const n of e.expr)
    yield* Tr(n);
}
function* ml(e) {
  return yield e.const;
}
function* Tr(e) {
  return e.type === "and" ? yield* dl(e) : e.type === "or" ? yield* ll(e) : e.type === "const" ? yield* ml(e) : (() => {
    throw new fl("Unknown expression");
  })();
}
function yi(e) {
  const n = Rt(e.pattern);
  return Wn(n) ? [...Tr(n)] : [];
}
function N(e, n) {
  return g({
    [O]: "Literal",
    const: e,
    type: typeof e
  }, n);
}
function $i(e) {
  return g({ [O]: "Boolean", type: "boolean" }, e);
}
function zt(e) {
  return g({ [O]: "BigInt", type: "bigint" }, e);
}
function cn(e) {
  return g({ [O]: "Number", type: "number" }, e);
}
function qe(e) {
  return g({ [O]: "String", type: "string" }, e);
}
function* pl(e) {
  const n = e.trim().replace(/"|'/g, "");
  return n === "boolean" ? yield $i() : n === "number" ? yield cn() : n === "bigint" ? yield zt() : n === "string" ? yield qe() : yield (() => {
    const r = n.split("|").map((t) => N(t.trim()));
    return r.length === 0 ? U() : r.length === 1 ? r[0] : kn(r);
  })();
}
function* hl(e) {
  if (e[1] !== "{") {
    const n = N("$"), r = Xr(e.slice(1));
    return yield* [n, ...r];
  }
  for (let n = 2; n < e.length; n++)
    if (e[n] === "}") {
      const r = pl(e.slice(2, n)), t = Xr(e.slice(n + 1));
      return yield* [...r, ...t];
    }
  yield N(e);
}
function* Xr(e) {
  for (let n = 0; n < e.length; n++)
    if (e[n] === "$") {
      const r = N(e.slice(0, n)), t = hl(e.slice(n));
      return yield* [r, ...t];
    }
  yield N(e);
}
function gl(e) {
  return [...Xr(e)];
}
class bl extends Xe {
}
function Fl(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function wi(e, n) {
  return nn(e) ? e.pattern.slice(1, e.pattern.length - 1) : K(e) ? `(${e.anyOf.map((r) => wi(r, n)).join("|")})` : wn(e) ? `${n}${cr}` : $n(e) ? `${n}${cr}` : vr(e) ? `${n}${cr}` : qn(e) ? `${n}${_i}` : Qe(e) ? `${n}${Fl(e.const.toString())}` : Hn(e) ? `${n}${Cd}` : (() => {
    throw new bl(`Unexpected Kind '${e[O]}'`);
  })();
}
function vo(e) {
  return `^${e.map((n) => wi(n, "")).join("")}$`;
}
function hr(e) {
  const r = yi(e).map((t) => N(t));
  return kn(r);
}
function ki(e, n) {
  const r = j(e) ? vo(gl(e)) : vo(e);
  return g({ [O]: "TemplateLiteral", type: "string", pattern: r }, n);
}
function _l(e) {
  return yi(e).map((r) => r.toString());
}
function Ol(e) {
  const n = [];
  for (const r of e)
    n.push(...Le(r));
  return n;
}
function vl(e) {
  return [e.toString()];
}
function Le(e) {
  return [...new Set(nn(e) ? _l(e) : K(e) ? Ol(e.anyOf) : Qe(e) ? vl(e.const) : wn(e) ? ["[number]"] : $n(e) ? ["[number]"] : [])];
}
function yl(e, n, r) {
  const t = {};
  for (const o of Object.getOwnPropertyNames(n))
    t[o] = Pr(e, Le(n[o]), r);
  return t;
}
function $l(e, n, r) {
  return yl(e, n.properties, r);
}
function wl(e, n, r) {
  const t = $l(e, n, r);
  return Y(t);
}
function Ii(e, n) {
  return e.map((r) => Ri(r, n));
}
function kl(e) {
  return e.filter((n) => !Gn(n));
}
function Il(e, n) {
  return xi(kl(Ii(e, n)));
}
function Rl(e) {
  return e.some((n) => Gn(n)) ? [] : e;
}
function zl(e, n) {
  return kn(Rl(Ii(e, n)));
}
function Sl(e, n) {
  return n in e ? e[n] : n === "[number]" ? kn(e) : U();
}
function Al(e, n) {
  return n === "[number]" ? e : U();
}
function xl(e, n) {
  return n in e ? e[n] : U();
}
function Ri(e, n) {
  return Fe(e) ? Il(e.allOf, n) : K(e) ? zl(e.anyOf, n) : rn(e) ? Sl(e.items ?? [], n) : _n(e) ? Al(e.items, n) : we(e) ? xl(e.properties, n) : U();
}
function zi(e, n) {
  return n.map((r) => Ri(e, r));
}
function yo(e, n) {
  return kn(zi(e, n));
}
function Pr(e, n, r) {
  if (ie(e) || ie(n)) {
    const t = "Index types using Ref parameters require both Type and Key to be of TSchema";
    if (!je(e) || !je(n))
      throw new Xe(t);
    return W("Index", [e, n]);
  }
  return me(n) ? wl(e, n, r) : en(n) ? jl(e, n, r) : g(je(n) ? yo(e, Le(n)) : yo(e, n), r);
}
function Tl(e, n, r) {
  return { [n]: Pr(e, [n], fe(r)) };
}
function Pl(e, n, r) {
  return n.reduce((t, o) => ({ ...t, ...Tl(e, o, r) }), {});
}
function Zl(e, n, r) {
  return Pl(e, n.keys, r);
}
function jl(e, n, r) {
  const t = Zl(e, n, r);
  return Y(t);
}
function St(e, n) {
  return g({ [O]: "Iterator", type: "Iterator", items: e }, n);
}
function El(e) {
  return globalThis.Object.keys(e).filter((n) => !Ce(e[n]));
}
function Nl(e, n) {
  const r = El(e), t = r.length > 0 ? { [O]: "Object", type: "object", required: r, properties: e } : { [O]: "Object", type: "object", properties: e };
  return g(t, n);
}
var B = Nl;
function Si(e, n) {
  return g({ [O]: "Promise", type: "Promise", item: e }, n);
}
function Cl(e) {
  return g(de(e, [Jn]));
}
function Ul(e) {
  return g({ ...e, [Jn]: "Readonly" });
}
function Ml(e, n) {
  return n === !1 ? Cl(e) : Ul(e);
}
function De(e, n) {
  const r = n ?? !0;
  return me(e) ? Wl(e, r) : Ml(e, r);
}
function Ll(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = De(e[t], n);
  return r;
}
function Dl(e, n) {
  return Ll(e.properties, n);
}
function Wl(e, n) {
  const r = Dl(e, n);
  return Y(r);
}
function In(e, n) {
  return g(e.length > 0 ? { [O]: "Tuple", type: "array", items: e, additionalItems: !1, minItems: e.length, maxItems: e.length } : { [O]: "Tuple", type: "array", minItems: e.length, maxItems: e.length }, n);
}
function Ai(e, n) {
  return e in n ? pe(e, n[e]) : Y(n);
}
function Bl(e) {
  return { [e]: N(e) };
}
function Kl(e) {
  const n = {};
  for (const r of e)
    n[r] = N(r);
  return n;
}
function Vl(e, n) {
  return Ld(n, e) ? Bl(e) : Kl(n);
}
function Jl(e, n) {
  const r = Vl(e, n);
  return Ai(e, r);
}
function Tn(e, n) {
  return n.map((r) => pe(e, r));
}
function Hl(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(n))
    r[t] = pe(e, n[t]);
  return r;
}
function pe(e, n) {
  const r = { ...n };
  return (
    // unevaluated modifier types
    Ce(n) ? We(pe(e, de(n, [Ae]))) : mt(n) ? De(pe(e, de(n, [Jn]))) : (
      // unevaluated mapped types
      me(n) ? Ai(e, n.properties) : en(n) ? Jl(e, n.keys) : (
        // unevaluated types
        vn(n) ? kt(Tn(e, n.parameters), pe(e, n.returns), r) : yn(n) ? Xn(Tn(e, n.parameters), pe(e, n.returns), r) : Or(n) ? wt(pe(e, n.items), r) : yr(n) ? St(pe(e, n.items), r) : Fe(n) ? Be(Tn(e, n.allOf), r) : K(n) ? X(Tn(e, n.anyOf), r) : rn(n) ? In(Tn(e, n.items ?? []), r) : we(n) ? B(Hl(e, n.properties), r) : _n(n) ? $t(pe(e, n.items), r) : $r(n) ? Si(pe(e, n.item), r) : n
      )
    )
  );
}
function Gl(e, n) {
  const r = {};
  for (const t of e)
    r[t] = pe(t, n);
  return r;
}
function ql(e, n, r) {
  const t = je(e) ? Le(e) : e, o = n({ [O]: "MappedKey", keys: t }), u = Gl(t, o);
  return B(u, r);
}
function Yl(e) {
  return g(de(e, [Ae]));
}
function Xl(e) {
  return g({ ...e, [Ae]: "Optional" });
}
function Ql(e, n) {
  return n === !1 ? Yl(e) : Xl(e);
}
function We(e, n) {
  const r = n ?? !0;
  return me(e) ? rm(e, r) : Ql(e, r);
}
function em(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = We(e[t], n);
  return r;
}
function nm(e, n) {
  return em(e.properties, n);
}
function rm(e, n) {
  const r = nm(e, n);
  return Y(r);
}
function Qr(e, n = {}) {
  const r = e.every((o) => we(o)), t = je(n.unevaluatedProperties) ? { unevaluatedProperties: n.unevaluatedProperties } : {};
  return g(n.unevaluatedProperties === !1 || je(n.unevaluatedProperties) || r ? { ...t, [O]: "Intersect", type: "object", allOf: e } : { ...t, [O]: "Intersect", allOf: e }, n);
}
function tm(e) {
  return e.every((n) => Ce(n));
}
function om(e) {
  return de(e, [Ae]);
}
function $o(e) {
  return e.map((n) => Ce(n) ? om(n) : n);
}
function im(e, n) {
  return tm(e) ? We(Qr($o(e), n)) : Qr($o(e), n);
}
function xi(e, n = {}) {
  if (e.length === 1)
    return g(e[0], n);
  if (e.length === 0)
    return U(n);
  if (e.some((r) => kr(r)))
    throw new Error("Cannot intersect transform types");
  return im(e, n);
}
function Be(e, n) {
  if (e.length === 1)
    return g(e[0], n);
  if (e.length === 0)
    return U(n);
  if (e.some((r) => kr(r)))
    throw new Error("Cannot intersect transform types");
  return Qr(e, n);
}
function Qn(...e) {
  const [n, r] = typeof e[0] == "string" ? [e[0], e[1]] : [e[0].$id, e[1]];
  if (typeof n != "string")
    throw new Xe("Ref: $ref must be a string");
  return g({ [O]: "Ref", $ref: n }, r);
}
function um(e, n) {
  return W("Awaited", [W(e, n)]);
}
function cm(e) {
  return W("Awaited", [Qn(e)]);
}
function sm(e) {
  return Be(Ti(e));
}
function am(e) {
  return X(Ti(e));
}
function fm(e) {
  return Zr(e);
}
function Ti(e) {
  return e.map((n) => Zr(n));
}
function Zr(e, n) {
  return g(On(e) ? um(e.target, e.parameters) : Fe(e) ? sm(e.allOf) : K(e) ? am(e.anyOf) : $r(e) ? fm(e.item) : ie(e) ? cm(e.$ref) : e, n);
}
function Pi(e) {
  const n = [];
  for (const r of e)
    n.push(At(r));
  return n;
}
function dm(e) {
  const n = Pi(e);
  return Vd(n);
}
function lm(e) {
  const n = Pi(e);
  return Kd(n);
}
function mm(e) {
  return e.map((n, r) => r.toString());
}
function pm(e) {
  return ["[number]"];
}
function hm(e) {
  return globalThis.Object.getOwnPropertyNames(e);
}
function gm(e) {
  return [];
}
function At(e) {
  return Fe(e) ? dm(e.allOf) : K(e) ? lm(e.anyOf) : rn(e) ? mm(e.items ?? []) : _n(e) ? pm(e.items) : we(e) ? hm(e.properties) : wr(e) ? gm(e.patternProperties) : [];
}
function bm(e, n) {
  return W("KeyOf", [W(e, n)]);
}
function Fm(e) {
  return W("KeyOf", [Qn(e)]);
}
function _m(e, n) {
  const r = At(e), t = Om(r), o = kn(t);
  return g(o, n);
}
function Om(e) {
  return e.map((n) => n === "[number]" ? cn() : N(n));
}
function xt(e, n) {
  return On(e) ? bm(e.target, e.parameters) : ie(e) ? Fm(e.$ref) : me(e) ? $m(e, n) : _m(e, n);
}
function vm(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = xt(e[t], fe(n));
  return r;
}
function ym(e, n) {
  return vm(e.properties, n);
}
function $m(e, n) {
  const r = ym(e, n);
  return Y(r);
}
function wm(e) {
  const n = [];
  for (const r of e)
    n.push(...At(r));
  return Dd(n);
}
function km(e) {
  return e.filter((n) => !Gn(n));
}
function Im(e, n) {
  const r = [];
  for (const t of e)
    r.push(...zi(t, [n]));
  return km(r);
}
function Rm(e, n) {
  const r = {};
  for (const t of n)
    r[t] = xi(Im(e, t));
  return r;
}
function zm(e, n) {
  const r = wm(e), t = Rm(e, r);
  return B(t, n);
}
function Zi(e) {
  return g({ [O]: "Date", type: "Date" }, e);
}
function ji(e) {
  return g({ [O]: "Null", type: "null" }, e);
}
function Ei(e) {
  return g({ [O]: "Symbol", type: "symbol" }, e);
}
function Ni(e) {
  return g({ [O]: "Undefined", type: "undefined" }, e);
}
function Ci(e) {
  return g({ [O]: "Uint8Array", type: "Uint8Array" }, e);
}
function jr(e) {
  return g({ [O]: "Unknown" }, e);
}
function Sm(e) {
  return e.map((n) => Tt(n, !1));
}
function Am(e) {
  const n = {};
  for (const r of globalThis.Object.getOwnPropertyNames(e))
    n[r] = De(Tt(e[r], !1));
  return n;
}
function ur(e, n) {
  return n === !0 ? e : De(e);
}
function Tt(e, n) {
  return nd(e) || td(e) ? ur(Ln(), n) : se(e) ? De(In(Sm(e))) : Vn(e) ? Ci() : dt(e) ? Zi() : C(e) ? ur(B(Am(e)), n) : rd(e) ? ur(Xn([], jr()), n) : E(e) ? Ni() : od(e) ? ji() : id(e) ? Ei() : ui(e) ? zt() : Ie(e) || Kn(e) || j(e) ? N(e) : B({});
}
function xm(e, n) {
  return g(Tt(e, !0), n);
}
function Tm(e, n) {
  return vn(e) ? In(e.parameters, n) : U(n);
}
function Pm(e, n) {
  if (E(e))
    throw new Error("Enum undefined or empty");
  const r = globalThis.Object.getOwnPropertyNames(e).filter((u) => isNaN(u)).map((u) => e[u]), o = [...new Set(r)].map((u) => N(u));
  return X(o, { ...n, [_r]: "Enum" });
}
class Zm extends Xe {
}
var f;
(function(e) {
  e[e.Union = 0] = "Union", e[e.True = 1] = "True", e[e.False = 2] = "False";
})(f || (f = {}));
function ge(e) {
  return e === f.False ? e : f.True;
}
function Rn(e) {
  throw new Zm(e);
}
function M(e) {
  return Me(e) || un(e) || Se(e) || ye(e) || Oe(e);
}
function L(e, n) {
  return Me(n) ? Li() : un(n) ? Er(e, n) : Se(n) ? Zt(e, n) : ye(n) ? Ki() : Oe(n) ? Pt() : Rn("StructuralRight");
}
function Pt(e, n) {
  return f.True;
}
function jm(e, n) {
  return un(n) ? Er(e, n) : Se(n) && n.anyOf.some((r) => Oe(r) || ye(r)) ? f.True : Se(n) ? f.Union : ye(n) || Oe(n) ? f.True : f.Union;
}
function Em(e, n) {
  return ye(e) ? f.False : Oe(e) ? f.Union : Me(e) ? f.True : f.False;
}
function Nm(e, n) {
  return A(n) && Nr(n) ? f.True : M(n) ? L(e, n) : tn(n) ? ge($(e.items, n.items)) : f.False;
}
function Cm(e, n) {
  return M(n) ? L(e, n) : _t(n) ? ge($(e.items, n.items)) : f.False;
}
function Um(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : Ir(n) ? f.True : f.False;
}
function Ui(e, n) {
  return Fi(e) || on(e) ? f.True : f.False;
}
function Mm(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : on(n) ? f.True : f.False;
}
function Lm(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : Rr(n) ? e.parameters.length > n.parameters.length ? f.False : e.parameters.every((r, t) => ge($(n.parameters[t], r)) === f.True) ? ge($(e.returns, n.returns)) : f.False : f.False;
}
function Dm(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : zr(n) ? f.True : f.False;
}
function Wm(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : Sr(n) ? e.parameters.length > n.parameters.length ? f.False : e.parameters.every((r, t) => ge($(n.parameters[t], r)) === f.True) ? ge($(e.returns, n.returns)) : f.False : f.False;
}
function Mi(e, n) {
  return Ue(e) && Ie(e.const) || oe(e) || xe(e) ? f.True : f.False;
}
function Bm(e, n) {
  return xe(n) || oe(n) ? f.True : M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : f.False;
}
function Er(e, n) {
  return n.allOf.every((r) => $(e, r) === f.True) ? f.True : f.False;
}
function Km(e, n) {
  return e.allOf.some((r) => $(r, n) === f.True) ? f.True : f.False;
}
function Vm(e, n) {
  return M(n) ? L(e, n) : Ot(n) ? ge($(e.items, n.items)) : f.False;
}
function Jm(e, n) {
  return Ue(n) && n.const === e.const ? f.True : M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : ve(n) ? Bi(e) : oe(n) ? Di(e) : xe(n) ? Mi(e) : on(n) ? Ui(e) : f.False;
}
function Li(e, n) {
  return f.False;
}
function Hm(e, n) {
  return f.True;
}
function wo(e) {
  let [n, r] = [e, 0];
  for (; pn(n); )
    n = n.not, r += 1;
  return r % 2 === 0 ? n : jr();
}
function Gm(e, n) {
  return pn(e) ? $(wo(e), n) : pn(n) ? $(e, wo(n)) : Rn("Invalid fallthrough for Not");
}
function qm(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : vt(n) ? f.True : f.False;
}
function Di(e, n) {
  return bi(e) || oe(e) || xe(e) ? f.True : f.False;
}
function Ym(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : xe(n) || oe(n) ? f.True : f.False;
}
function ue(e, n) {
  return Object.getOwnPropertyNames(e.properties).length === n;
}
function ko(e) {
  return Nr(e);
}
function Io(e) {
  return ue(e, 0) || ue(e, 1) && "description" in e.properties && Se(e.properties.description) && e.properties.description.anyOf.length === 2 && (ve(e.properties.description.anyOf[0]) && Ge(e.properties.description.anyOf[1]) || ve(e.properties.description.anyOf[1]) && Ge(e.properties.description.anyOf[0]));
}
function Br(e) {
  return ue(e, 0);
}
function Ro(e) {
  return ue(e, 0);
}
function Xm(e) {
  return ue(e, 0);
}
function Qm(e) {
  return ue(e, 0);
}
function ep(e) {
  return Nr(e);
}
function np(e) {
  const n = cn();
  return ue(e, 0) || ue(e, 1) && "length" in e.properties && ge($(e.properties.length, n)) === f.True;
}
function rp(e) {
  return ue(e, 0);
}
function Nr(e) {
  const n = cn();
  return ue(e, 0) || ue(e, 1) && "length" in e.properties && ge($(e.properties.length, n)) === f.True;
}
function tp(e) {
  const n = Xn([Ln()], Ln());
  return ue(e, 0) || ue(e, 1) && "then" in e.properties && ge($(e.properties.then, n)) === f.True;
}
function Wi(e, n) {
  return $(e, n) === f.False || pr(e) && !pr(n) ? f.False : f.True;
}
function Q(e, n) {
  return ye(e) ? f.False : Oe(e) ? f.Union : Me(e) || gi(e) && ko(n) || bi(e) && Br(n) || Fi(e) && Ro(n) || Un(e) && Io(n) || Ir(e) && Xm(n) || ve(e) && ko(n) || Un(e) && Io(n) || oe(e) && Br(n) || xe(e) && Br(n) || on(e) && Ro(n) || Yn(e) && ep(n) || zr(e) && Qm(n) || Rr(e) && rp(n) || Sr(e) && np(n) ? f.True : G(e) && ve(et(e)) ? n[_r] === "Record" ? f.True : f.False : G(e) && oe(et(e)) ? ue(n, 0) ? f.True : f.False : f.False;
}
function op(e, n) {
  return M(n) ? L(e, n) : G(n) ? _e(e, n) : A(n) ? (() => {
    for (const r of Object.getOwnPropertyNames(n.properties)) {
      if (!(r in e.properties) && !pr(n.properties[r]))
        return f.False;
      if (pr(n.properties[r]))
        return f.True;
      if (Wi(e.properties[r], n.properties[r]) === f.False)
        return f.False;
    }
    return f.True;
  })() : f.False;
}
function ip(e, n) {
  return M(n) ? L(e, n) : A(n) && tp(n) ? f.True : yt(n) ? ge($(e.item, n.item)) : f.False;
}
function et(e) {
  return hn in e.patternProperties ? cn() : gn in e.patternProperties ? qe() : Rn("Unknown record key pattern");
}
function nt(e) {
  return hn in e.patternProperties ? e.patternProperties[hn] : gn in e.patternProperties ? e.patternProperties[gn] : Rn("Unable to get record value schema");
}
function _e(e, n) {
  const [r, t] = [et(n), nt(n)];
  return gi(e) && oe(r) && ge($(e, t)) === f.True ? f.True : Yn(e) && oe(r) || ve(e) && oe(r) || tn(e) && oe(r) ? $(e, t) : A(e) ? (() => {
    for (const o of Object.getOwnPropertyNames(e.properties))
      if (Wi(t, e.properties[o]) === f.False)
        return f.False;
    return f.True;
  })() : f.False;
}
function up(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? $(nt(e), nt(n)) : f.False;
}
function cp(e, n) {
  const r = Cn(e) ? qe() : e, t = Cn(n) ? qe() : n;
  return $(r, t);
}
function Bi(e, n) {
  return Ue(e) && j(e.const) || ve(e) ? f.True : f.False;
}
function sp(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : ve(n) ? f.True : f.False;
}
function ap(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : Un(n) ? f.True : f.False;
}
function fp(e, n) {
  return Mn(e) ? $(hr(e), n) : Mn(n) ? $(e, hr(n)) : Rn("Invalid fallthrough for TemplateLiteral");
}
function dp(e, n) {
  return tn(n) && e.items !== void 0 && e.items.every((r) => $(r, n.items) === f.True);
}
function lp(e, n) {
  return Me(e) ? f.True : ye(e) ? f.False : Oe(e) ? f.Union : f.False;
}
function mp(e, n) {
  return M(n) ? L(e, n) : A(n) && Nr(n) || tn(n) && dp(e, n) ? f.True : Ar(n) ? E(e.items) && !E(n.items) || !E(e.items) && E(n.items) ? f.False : E(e.items) && !E(n.items) || e.items.every((r, t) => $(r, n.items[t]) === f.True) ? f.True : f.False : f.False;
}
function pp(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : Yn(n) ? f.True : f.False;
}
function hp(e, n) {
  return M(n) ? L(e, n) : A(n) ? Q(e, n) : G(n) ? _e(e, n) : xr(n) ? Fp(e) : Ge(n) ? f.True : f.False;
}
function Zt(e, n) {
  return n.anyOf.some((r) => $(e, r) === f.True) ? f.True : f.False;
}
function gp(e, n) {
  return e.anyOf.every((r) => $(r, n) === f.True) ? f.True : f.False;
}
function Ki(e, n) {
  return f.True;
}
function bp(e, n) {
  return Me(n) ? Li() : un(n) ? Er(e, n) : Se(n) ? Zt(e, n) : Oe(n) ? Pt() : ve(n) ? Bi(e) : oe(n) ? Di(e) : xe(n) ? Mi(e) : on(n) ? Ui(e) : tn(n) ? Em(e) : Ar(n) ? lp(e) : A(n) ? Q(e, n) : ye(n) ? f.True : f.False;
}
function Fp(e, n) {
  return Ge(e) || Ge(e) ? f.True : f.False;
}
function _p(e, n) {
  return un(n) ? Er(e, n) : Se(n) ? Zt(e, n) : ye(n) ? Ki() : Oe(n) ? Pt() : A(n) ? Q(e, n) : xr(n) ? f.True : f.False;
}
function $(e, n) {
  return (
    // resolvable
    Mn(e) || Mn(n) ? fp(e, n) : Cn(e) || Cn(n) ? cp(e, n) : pn(e) || pn(n) ? Gm(e, n) : (
      // standard
      Oe(e) ? jm(e, n) : tn(e) ? Nm(e, n) : Ir(e) ? Um(e, n) : on(e) ? Mm(e, n) : _t(e) ? Cm(e, n) : Rr(e) ? Lm(e, n) : zr(e) ? Dm(e, n) : Sr(e) ? Wm(e, n) : xe(e) ? Bm(e, n) : un(e) ? Km(e, n) : Ot(e) ? Vm(e, n) : Ue(e) ? Jm(e, n) : Me(e) ? Hm() : vt(e) ? qm(e, n) : oe(e) ? Ym(e, n) : A(e) ? op(e, n) : G(e) ? up(e, n) : ve(e) ? sp(e, n) : Un(e) ? ap(e, n) : Ar(e) ? mp(e, n) : yt(e) ? ip(e, n) : Yn(e) ? pp(e, n) : Ge(e) ? hp(e, n) : Se(e) ? gp(e, n) : ye(e) ? bp(e, n) : xr(e) ? _p(e, n) : Rn(`Unknown left type operand '${e[O]}'`)
    )
  );
}
function er(e, n) {
  return $(e, n);
}
function Op(e, n, r, t, o) {
  const u = {};
  for (const c of globalThis.Object.getOwnPropertyNames(e))
    u[c] = jt(e[c], n, r, t, fe(o));
  return u;
}
function vp(e, n, r, t, o) {
  return Op(e.properties, n, r, t, o);
}
function yp(e, n, r, t, o) {
  const u = vp(e, n, r, t, o);
  return Y(u);
}
function $p(e, n, r, t) {
  const o = er(e, n);
  return o === f.Union ? X([r, t]) : o === f.True ? r : t;
}
function jt(e, n, r, t, o) {
  return me(e) ? yp(e, n, r, t, o) : en(e) ? g(Rp(e, n, r, t, o)) : g($p(e, n, r, t), o);
}
function wp(e, n, r, t, o) {
  return {
    [e]: jt(N(e), n, r, t, fe(o))
  };
}
function kp(e, n, r, t, o) {
  return e.reduce((u, c) => ({ ...u, ...wp(c, n, r, t, o) }), {});
}
function Ip(e, n, r, t, o) {
  return kp(e.keys, n, r, t, o);
}
function Rp(e, n, r, t, o) {
  const u = Ip(e, n, r, t, o);
  return Y(u);
}
function zp(e, n) {
  return Et(hr(e), n);
}
function Sp(e, n) {
  const r = e.filter((t) => er(t, n) === f.False);
  return r.length === 1 ? r[0] : X(r);
}
function Et(e, n, r = {}) {
  return nn(e) ? g(zp(e, n), r) : me(e) ? g(Tp(e, n), r) : g(K(e) ? Sp(e.anyOf, n) : er(e, n) !== f.False ? U() : e, r);
}
function Ap(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = Et(e[t], n);
  return r;
}
function xp(e, n) {
  return Ap(e.properties, n);
}
function Tp(e, n) {
  const r = xp(e, n);
  return Y(r);
}
function Pp(e, n) {
  return Nt(hr(e), n);
}
function Zp(e, n) {
  const r = e.filter((t) => er(t, n) !== f.False);
  return r.length === 1 ? r[0] : X(r);
}
function Nt(e, n, r) {
  return nn(e) ? g(Pp(e, n), r) : me(e) ? g(Np(e, n), r) : g(K(e) ? Zp(e.anyOf, n) : er(e, n) !== f.False ? e : U(), r);
}
function jp(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = Nt(e[t], n);
  return r;
}
function Ep(e, n) {
  return jp(e.properties, n);
}
function Np(e, n) {
  const r = Ep(e, n);
  return Y(r);
}
function Cp(e, n) {
  return vn(e) ? g(e.returns, n) : U(n);
}
function Vi(e) {
  return De(We(e));
}
function sn(e, n, r) {
  return g({ [O]: "Record", type: "object", patternProperties: { [e]: n } }, r);
}
function Ct(e, n, r) {
  const t = {};
  for (const o of e)
    t[o] = n;
  return B(t, { ...r, [_r]: "Record" });
}
function Up(e, n, r) {
  return al(e) ? Ct(Le(e), n, r) : sn(e.pattern, n, r);
}
function Mp(e, n, r) {
  return Ct(Le(X(e)), n, r);
}
function Lp(e, n, r) {
  return Ct([e.toString()], n, r);
}
function Dp(e, n, r) {
  return sn(e.source, n, r);
}
function Wp(e, n, r) {
  const t = E(e.pattern) ? gn : e.pattern;
  return sn(t, n, r);
}
function Bp(e, n, r) {
  return sn(gn, n, r);
}
function Kp(e, n, r) {
  return sn(Md, n, r);
}
function Vp(e, n, r) {
  return B({ true: n, false: n }, r);
}
function Jp(e, n, r) {
  return sn(hn, n, r);
}
function Hp(e, n, r) {
  return sn(hn, n, r);
}
function Ji(e, n, r = {}) {
  return K(e) ? Mp(e.anyOf, n, r) : nn(e) ? Up(e, n, r) : Qe(e) ? Lp(e.const, n, r) : Hn(e) ? Vp(e, n, r) : $n(e) ? Jp(e, n, r) : wn(e) ? Hp(e, n, r) : di(e) ? Dp(e, n, r) : qn(e) ? Wp(e, n, r) : si(e) ? Bp(e, n, r) : Gn(e) ? Kp(e, n, r) : U(r);
}
function Ut(e) {
  return globalThis.Object.getOwnPropertyNames(e.patternProperties)[0];
}
function Gp(e) {
  const n = Ut(e);
  return n === gn ? qe() : n === hn ? cn() : qe({ pattern: n });
}
function Hi(e) {
  return e.patternProperties[Ut(e)];
}
function qp(e, n) {
  return n.parameters = nr(e, n.parameters), n.returns = $e(e, n.returns), n;
}
function Yp(e, n) {
  return n.parameters = nr(e, n.parameters), n.returns = $e(e, n.returns), n;
}
function Xp(e, n) {
  return n.allOf = nr(e, n.allOf), n;
}
function Qp(e, n) {
  return n.anyOf = nr(e, n.anyOf), n;
}
function eh(e, n) {
  return E(n.items) || (n.items = nr(e, n.items)), n;
}
function nh(e, n) {
  return n.items = $e(e, n.items), n;
}
function rh(e, n) {
  return n.items = $e(e, n.items), n;
}
function th(e, n) {
  return n.items = $e(e, n.items), n;
}
function oh(e, n) {
  return n.item = $e(e, n.item), n;
}
function ih(e, n) {
  const r = ah(e, n.properties);
  return { ...n, ...B(r) };
}
function uh(e, n) {
  const r = $e(e, Gp(n)), t = $e(e, Hi(n)), o = Ji(r, t);
  return { ...n, ...o };
}
function ch(e, n) {
  return n.index in e ? e[n.index] : jr();
}
function sh(e, n) {
  const r = mt(n), t = Ce(n), o = $e(e, n);
  return r && t ? Vi(o) : r && !t ? De(o) : !r && t ? We(o) : o;
}
function ah(e, n) {
  return globalThis.Object.getOwnPropertyNames(n).reduce((r, t) => ({ ...r, [t]: sh(e, n[t]) }), {});
}
function nr(e, n) {
  return n.map((r) => $e(e, r));
}
function $e(e, n) {
  return vn(n) ? qp(e, n) : yn(n) ? Yp(e, n) : Fe(n) ? Xp(e, n) : K(n) ? Qp(e, n) : rn(n) ? eh(e, n) : _n(n) ? nh(e, n) : Or(n) ? rh(e, n) : yr(n) ? th(e, n) : $r(n) ? oh(e, n) : we(n) ? ih(e, n) : wr(n) ? uh(e, n) : ai(n) ? ch(e, n) : n;
}
function fh(e, n) {
  return $e(n, lt(e));
}
function dh(e) {
  return g({ [O]: "Integer", type: "integer" }, e);
}
function lh(e, n, r) {
  return {
    [e]: zn(N(e), n, fe(r))
  };
}
function mh(e, n, r) {
  return e.reduce((o, u) => ({ ...o, ...lh(u, n, r) }), {});
}
function ph(e, n, r) {
  return mh(e.keys, n, r);
}
function hh(e, n, r) {
  const t = ph(e, n, r);
  return Y(t);
}
function gh(e) {
  const [n, r] = [e.slice(0, 1), e.slice(1)];
  return [n.toLowerCase(), r].join("");
}
function bh(e) {
  const [n, r] = [e.slice(0, 1), e.slice(1)];
  return [n.toUpperCase(), r].join("");
}
function Fh(e) {
  return e.toUpperCase();
}
function _h(e) {
  return e.toLowerCase();
}
function Oh(e, n, r) {
  const t = Rt(e.pattern);
  if (!Wn(t))
    return { ...e, pattern: Gi(e.pattern, n) };
  const c = [...Tr(t)].map((l) => N(l)), s = qi(c, n), a = X(s);
  return ki([a], r);
}
function Gi(e, n) {
  return typeof e == "string" ? n === "Uncapitalize" ? gh(e) : n === "Capitalize" ? bh(e) : n === "Uppercase" ? Fh(e) : n === "Lowercase" ? _h(e) : e : e.toString();
}
function qi(e, n) {
  return e.map((r) => zn(r, n));
}
function zn(e, n, r = {}) {
  return (
    // Intrinsic-Mapped-Inference
    en(e) ? hh(e, n, r) : (
      // Standard-Inference
      nn(e) ? Oh(e, n, r) : K(e) ? X(qi(e.anyOf, n), r) : Qe(e) ? N(Gi(e.const, n), r) : (
        // Default Type
        g(e, r)
      )
    )
  );
}
function vh(e, n = {}) {
  return zn(e, "Capitalize", n);
}
function yh(e, n = {}) {
  return zn(e, "Lowercase", n);
}
function $h(e, n = {}) {
  return zn(e, "Uncapitalize", n);
}
function wh(e, n = {}) {
  return zn(e, "Uppercase", n);
}
function kh(e, n, r) {
  const t = {};
  for (const o of globalThis.Object.getOwnPropertyNames(e))
    t[o] = Cr(e[o], n, fe(r));
  return t;
}
function Ih(e, n, r) {
  return kh(e.properties, n, r);
}
function Rh(e, n, r) {
  const t = Ih(e, n, r);
  return Y(t);
}
function zh(e, n) {
  return e.map((r) => Mt(r, n));
}
function Sh(e, n) {
  return e.map((r) => Mt(r, n));
}
function Ah(e, n) {
  const { [n]: r, ...t } = e;
  return t;
}
function xh(e, n) {
  return n.reduce((r, t) => Ah(r, t), e);
}
function Th(e, n, r) {
  const t = de(e, [he, "$id", "required", "properties"]), o = xh(r, n);
  return B(o, t);
}
function Ph(e) {
  const n = e.reduce((r, t) => fi(t) ? [...r, N(t)] : r, []);
  return X(n);
}
function Mt(e, n) {
  return Fe(e) ? Be(zh(e.allOf, n)) : K(e) ? X(Sh(e.anyOf, n)) : we(e) ? Th(e, n, e.properties) : B({});
}
function Cr(e, n, r) {
  const t = se(n) ? Ph(n) : n, o = je(n) ? Le(n) : n, u = ie(e), c = ie(n);
  return me(e) ? Rh(e, o, r) : en(n) ? Nh(e, n, r) : u && c ? W("Omit", [e, t], r) : !u && c ? W("Omit", [e, t], r) : u && !c ? W("Omit", [e, t], r) : g({ ...Mt(e, o), ...r });
}
function Zh(e, n, r) {
  return { [n]: Cr(e, [n], fe(r)) };
}
function jh(e, n, r) {
  return n.reduce((t, o) => ({ ...t, ...Zh(e, o, r) }), {});
}
function Eh(e, n, r) {
  return jh(e, n.keys, r);
}
function Nh(e, n, r) {
  const t = Eh(e, n, r);
  return Y(t);
}
function Ch(e, n, r) {
  const t = {};
  for (const o of globalThis.Object.getOwnPropertyNames(e))
    t[o] = Ur(e[o], n, fe(r));
  return t;
}
function Uh(e, n, r) {
  return Ch(e.properties, n, r);
}
function Mh(e, n, r) {
  const t = Uh(e, n, r);
  return Y(t);
}
function Lh(e, n) {
  return e.map((r) => Lt(r, n));
}
function Dh(e, n) {
  return e.map((r) => Lt(r, n));
}
function Wh(e, n) {
  const r = {};
  for (const t of n)
    t in e && (r[t] = e[t]);
  return r;
}
function Bh(e, n, r) {
  const t = de(e, [he, "$id", "required", "properties"]), o = Wh(r, n);
  return B(o, t);
}
function Kh(e) {
  const n = e.reduce((r, t) => fi(t) ? [...r, N(t)] : r, []);
  return X(n);
}
function Lt(e, n) {
  return Fe(e) ? Be(Lh(e.allOf, n)) : K(e) ? X(Dh(e.anyOf, n)) : we(e) ? Bh(e, n, e.properties) : B({});
}
function Ur(e, n, r) {
  const t = se(n) ? Kh(n) : n, o = je(n) ? Le(n) : n, u = ie(e), c = ie(n);
  return me(e) ? Mh(e, o, r) : en(n) ? Gh(e, n, r) : u && c ? W("Pick", [e, t], r) : !u && c ? W("Pick", [e, t], r) : u && !c ? W("Pick", [e, t], r) : g({ ...Lt(e, o), ...r });
}
function Vh(e, n, r) {
  return {
    [n]: Ur(e, [n], fe(r))
  };
}
function Jh(e, n, r) {
  return n.reduce((t, o) => ({ ...t, ...Vh(e, o, r) }), {});
}
function Hh(e, n, r) {
  return Jh(e, n.keys, r);
}
function Gh(e, n, r) {
  const t = Hh(e, n, r);
  return Y(t);
}
function qh(e, n) {
  return W("Partial", [W(e, n)]);
}
function Yh(e) {
  return W("Partial", [Qn(e)]);
}
function Xh(e) {
  const n = {};
  for (const r of globalThis.Object.getOwnPropertyNames(e))
    n[r] = We(e[r]);
  return n;
}
function Qh(e, n) {
  const r = de(e, [he, "$id", "required", "properties"]), t = Xh(n);
  return B(t, r);
}
function zo(e) {
  return e.map((n) => Yi(n));
}
function Yi(e) {
  return (
    // Mappable
    On(e) ? qh(e.target, e.parameters) : ie(e) ? Yh(e.$ref) : Fe(e) ? Be(zo(e.allOf)) : K(e) ? X(zo(e.anyOf)) : we(e) ? Qh(e, e.properties) : (
      // Intrinsic
      vr(e) || Hn(e) || $n(e) || Qe(e) || pt(e) || wn(e) || qn(e) || ht(e) || gt(e) ? e : (
        // Passthrough
        B({})
      )
    )
  );
}
function Dt(e, n) {
  return me(e) ? rg(e, n) : g({ ...Yi(e), ...n });
}
function eg(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = Dt(e[t], fe(n));
  return r;
}
function ng(e, n) {
  return eg(e.properties, n);
}
function rg(e, n) {
  const r = ng(e, n);
  return Y(r);
}
function tg(e, n) {
  return W("Required", [W(e, n)]);
}
function og(e) {
  return W("Required", [Qn(e)]);
}
function ig(e) {
  const n = {};
  for (const r of globalThis.Object.getOwnPropertyNames(e))
    n[r] = de(e[r], [Ae]);
  return n;
}
function ug(e, n) {
  const r = de(e, [he, "$id", "required", "properties"]), t = ig(n);
  return B(t, r);
}
function So(e) {
  return e.map((n) => Xi(n));
}
function Xi(e) {
  return (
    // Mappable
    On(e) ? tg(e.target, e.parameters) : ie(e) ? og(e.$ref) : Fe(e) ? Be(So(e.allOf)) : K(e) ? X(So(e.anyOf)) : we(e) ? ug(e, e.properties) : (
      // Intrinsic
      vr(e) || Hn(e) || $n(e) || Qe(e) || pt(e) || wn(e) || qn(e) || ht(e) || gt(e) ? e : (
        // Passthrough
        B({})
      )
    )
  );
}
function Wt(e, n) {
  return me(e) ? ag(e, n) : g({ ...Xi(e), ...n });
}
function cg(e, n) {
  const r = {};
  for (const t of globalThis.Object.getOwnPropertyNames(e))
    r[t] = Wt(e[t], n);
  return r;
}
function sg(e, n) {
  return cg(e.properties, n);
}
function ag(e, n) {
  const r = sg(e, n);
  return Y(r);
}
function fg(e, n) {
  return n.map((r) => ie(r) ? Bt(e, r.$ref) : le(e, r));
}
function Bt(e, n) {
  return n in e ? ie(e[n]) ? Bt(e, e[n].$ref) : le(e, e[n]) : U();
}
function dg(e) {
  return Zr(e[0]);
}
function lg(e) {
  return Pr(e[0], e[1]);
}
function mg(e) {
  return xt(e[0]);
}
function pg(e) {
  return Dt(e[0]);
}
function hg(e) {
  return Cr(e[0], e[1]);
}
function gg(e) {
  return Ur(e[0], e[1]);
}
function bg(e) {
  return Wt(e[0]);
}
function Fg(e, n, r) {
  const t = fg(e, r);
  return n === "Awaited" ? dg(t) : n === "Index" ? lg(t) : n === "KeyOf" ? mg(t) : n === "Partial" ? pg(t) : n === "Omit" ? hg(t) : n === "Pick" ? gg(t) : n === "Required" ? bg(t) : U();
}
function _g(e, n) {
  return $t(le(e, n));
}
function Og(e, n) {
  return wt(le(e, n));
}
function vg(e, n, r) {
  return kt(rr(e, n), le(e, r));
}
function yg(e, n, r) {
  return Xn(rr(e, n), le(e, r));
}
function $g(e, n) {
  return Be(rr(e, n));
}
function wg(e, n) {
  return St(le(e, n));
}
function kg(e, n) {
  return B(globalThis.Object.keys(n).reduce((r, t) => ({ ...r, [t]: le(e, n[t]) }), {}));
}
function Ig(e, n) {
  const [r, t] = [le(e, Hi(n)), Ut(n)], o = lt(n);
  return o.patternProperties[t] = r, o;
}
function Rg(e, n) {
  return ie(n) ? { ...Bt(e, n.$ref), [he]: n[he] } : n;
}
function zg(e, n) {
  return In(rr(e, n));
}
function Sg(e, n) {
  return X(rr(e, n));
}
function rr(e, n) {
  return n.map((r) => le(e, r));
}
function le(e, n) {
  return (
    // Modifiers
    Ce(n) ? g(le(e, de(n, [Ae])), n) : mt(n) ? g(le(e, de(n, [Jn])), n) : (
      // Transform
      kr(n) ? g(Rg(e, n), n) : (
        // Types
        _n(n) ? g(_g(e, n.items), n) : Or(n) ? g(Og(e, n.items), n) : On(n) ? g(Fg(e, n.target, n.parameters)) : vn(n) ? g(vg(e, n.parameters, n.returns), n) : yn(n) ? g(yg(e, n.parameters, n.returns), n) : Fe(n) ? g($g(e, n.allOf), n) : yr(n) ? g(wg(e, n.items), n) : we(n) ? g(kg(e, n.properties), n) : wr(n) ? g(Ig(e, n)) : rn(n) ? g(zg(e, n.items || []), n) : K(n) ? g(Sg(e, n.anyOf), n) : n
      )
    )
  );
}
function Ag(e, n) {
  return n in e ? le(e, e[n]) : U();
}
function xg(e) {
  return globalThis.Object.getOwnPropertyNames(e).reduce((n, r) => ({ ...n, [r]: Ag(e, r) }), {});
}
class Tg {
  constructor(n) {
    const r = xg(n), t = this.WithIdentifiers(r);
    this.$defs = t;
  }
  /** `[Json]` Imports a Type by Key. */
  Import(n, r) {
    const t = { ...this.$defs, [n]: g(this.$defs[n], r) };
    return g({ [O]: "Import", $defs: t, $ref: n });
  }
  // prettier-ignore
  WithIdentifiers(n) {
    return globalThis.Object.getOwnPropertyNames(n).reduce((r, t) => ({ ...r, [t]: { ...n[t], $id: t } }), {});
  }
}
function Pg(e) {
  return new Tg(e);
}
function Zg(e, n) {
  return g({ [O]: "Not", not: e }, n);
}
function jg(e, n) {
  return yn(e) ? In(e.parameters, n) : U();
}
let Eg = 0;
function Ng(e, n = {}) {
  E(n.$id) && (n.$id = `T${Eg++}`);
  const r = lt(e({ [O]: "This", $ref: `${n.$id}` }));
  return r.$id = n.$id, g({ [_r]: "Recursive", ...r }, n);
}
function Cg(e, n) {
  const r = j(e) ? new globalThis.RegExp(e) : e;
  return g({ [O]: "RegExp", type: "RegExp", source: r.source, flags: r.flags }, n);
}
function Ug(e) {
  return Fe(e) ? e.allOf : K(e) ? e.anyOf : rn(e) ? e.items ?? [] : [];
}
function Mg(e) {
  return Ug(e);
}
function Lg(e, n) {
  return yn(e) ? g(e.returns, n) : U(n);
}
class Dg {
  constructor(n) {
    this.schema = n;
  }
  Decode(n) {
    return new Wg(this.schema, n);
  }
}
class Wg {
  constructor(n, r) {
    this.schema = n, this.decode = r;
  }
  EncodeTransform(n, r) {
    const u = { Encode: (c) => r[he].Encode(n(c)), Decode: (c) => this.decode(r[he].Decode(c)) };
    return { ...r, [he]: u };
  }
  EncodeSchema(n, r) {
    const t = { Decode: this.decode, Encode: n };
    return { ...r, [he]: t };
  }
  Encode(n) {
    return kr(this.schema) ? this.EncodeTransform(n, this.schema) : this.EncodeSchema(n, this.schema);
  }
}
function Bg(e) {
  return new Dg(e);
}
function Kg(e = {}) {
  return g({ [O]: e[O] ?? "Unsafe" }, e);
}
function Vg(e) {
  return g({ [O]: "Void", type: "void" }, e);
}
const Jg = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Any: Ln,
  Argument: Jd,
  Array: $t,
  AsyncIterator: wt,
  Awaited: Zr,
  BigInt: zt,
  Boolean: $i,
  Capitalize: vh,
  Composite: zm,
  Const: xm,
  Constructor: kt,
  ConstructorParameters: Tm,
  Date: Zi,
  Enum: Pm,
  Exclude: Et,
  Extends: jt,
  Extract: Nt,
  Function: Xn,
  Index: Pr,
  InstanceType: Cp,
  Instantiate: fh,
  Integer: dh,
  Intersect: Be,
  Iterator: St,
  KeyOf: xt,
  Literal: N,
  Lowercase: yh,
  Mapped: ql,
  Module: Pg,
  Never: U,
  Not: Zg,
  Null: ji,
  Number: cn,
  Object: B,
  Omit: Cr,
  Optional: We,
  Parameters: jg,
  Partial: Dt,
  Pick: Ur,
  Promise: Si,
  Readonly: De,
  ReadonlyOptional: Vi,
  Record: Ji,
  Recursive: Ng,
  Ref: Qn,
  RegExp: Cg,
  Required: Wt,
  Rest: Mg,
  ReturnType: Lg,
  String: qe,
  Symbol: Ei,
  TemplateLiteral: ki,
  Transform: Bg,
  Tuple: In,
  Uint8Array: Ci,
  Uncapitalize: $h,
  Undefined: Ni,
  Union: X,
  Unknown: jr,
  Unsafe: Kg,
  Uppercase: wh,
  Void: Vg
}, Symbol.toStringTag, { value: "Module" })), i = Jg, p = i.String({ $id: "Color" }), te = i.String({ $id: "FamilyName" }), Re = i.String({ $id: "FontWeight" }), Pe = i.String({ $id: "Length" }), Ze = i.String({ $id: "Percentage" }), Zn = i.String({ $id: "BoxShadow" }), Hg = i.String({ $id: "Number" }), Gg = i.String({ $id: "Size" }), Te = i.Union([i.String(), i.Literal("thin"), i.Literal("medium"), i.Literal("thick")], {
  $id: "LineWidth"
}), Kr = i.Optional(i.Object({
  columnGap: i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)])),
  rowGap: i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)])),
  field: i.Optional(i.Object({
    label: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    input: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      backgroundSubdued: i.Optional(i.Ref(p)),
      foreground: i.Optional(i.Ref(p)),
      foregroundSubdued: i.Optional(i.Ref(p)),
      borderColor: i.Optional(i.Ref(p)),
      borderColorHover: i.Optional(i.Ref(p)),
      borderColorFocus: i.Optional(i.Ref(p)),
      boxShadow: i.Optional(i.Ref(Zn)),
      boxShadowHover: i.Optional(i.Ref(Zn)),
      boxShadowFocus: i.Optional(i.Ref(Zn)),
      height: i.Optional(i.Ref(Gg)),
      padding: i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)]))
    }))
  }))
})), qg = i.Object({
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base border styles
  borderRadius: i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)])),
  borderWidth: i.Optional(i.Ref(Te)),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base color palette
  foreground: i.Optional(i.Ref(p)),
  foregroundSubdued: i.Optional(i.Ref(p)),
  foregroundAccent: i.Optional(i.Ref(p)),
  background: i.Optional(i.Ref(p)),
  backgroundNormal: i.Optional(i.Ref(p)),
  backgroundAccent: i.Optional(i.Ref(p)),
  backgroundSubdued: i.Optional(i.Ref(p)),
  borderColor: i.Optional(i.Ref(p)),
  borderColorAccent: i.Optional(i.Ref(p)),
  borderColorSubdued: i.Optional(i.Ref(p)),
  primary: i.Optional(i.Ref(p)),
  primaryBackground: i.Optional(i.Ref(p)),
  primarySubdued: i.Optional(i.Ref(p)),
  primaryAccent: i.Optional(i.Ref(p)),
  secondary: i.Optional(i.Ref(p)),
  secondaryBackground: i.Optional(i.Ref(p)),
  secondarySubdued: i.Optional(i.Ref(p)),
  secondaryAccent: i.Optional(i.Ref(p)),
  success: i.Optional(i.Ref(p)),
  successBackground: i.Optional(i.Ref(p)),
  successSubdued: i.Optional(i.Ref(p)),
  successAccent: i.Optional(i.Ref(p)),
  warning: i.Optional(i.Ref(p)),
  warningBackground: i.Optional(i.Ref(p)),
  warningSubdued: i.Optional(i.Ref(p)),
  warningAccent: i.Optional(i.Ref(p)),
  danger: i.Optional(i.Ref(p)),
  dangerBackground: i.Optional(i.Ref(p)),
  dangerSubdued: i.Optional(i.Ref(p)),
  dangerAccent: i.Optional(i.Ref(p)),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Base fonts
  fonts: i.Optional(i.Object({
    display: i.Optional(i.Object({
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    sans: i.Optional(i.Object({
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    serif: i.Optional(i.Object({
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    monospace: i.Optional(i.Object({
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    }))
  })),
  //////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Scopes
  navigation: i.Optional(i.Object({
    background: i.Optional(i.Ref(p)),
    backgroundAccent: i.Optional(i.Ref(p)),
    borderWidth: i.Optional(i.Ref(Te)),
    borderColor: i.Optional(i.Ref(p)),
    project: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      borderWidth: i.Optional(i.Ref(Te)),
      borderColor: i.Optional(i.Ref(p))
    })),
    modules: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      borderWidth: i.Optional(i.Ref(Te)),
      borderColor: i.Optional(i.Ref(p)),
      button: i.Optional(i.Object({
        foreground: i.Optional(i.Ref(p)),
        foregroundHover: i.Optional(i.Ref(p)),
        foregroundActive: i.Optional(i.Ref(p)),
        background: i.Optional(i.Ref(p)),
        backgroundHover: i.Optional(i.Ref(p)),
        backgroundActive: i.Optional(i.Ref(p))
      }))
    })),
    list: i.Optional(i.Object({
      icon: i.Optional(i.Object({
        foreground: i.Optional(i.Ref(p)),
        foregroundHover: i.Optional(i.Ref(p)),
        foregroundActive: i.Optional(i.Ref(p))
      })),
      foreground: i.Optional(i.Ref(p)),
      foregroundHover: i.Optional(i.Ref(p)),
      foregroundActive: i.Optional(i.Ref(p)),
      background: i.Optional(i.Ref(p)),
      backgroundHover: i.Optional(i.Ref(p)),
      backgroundActive: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      divider: i.Object({
        borderColor: i.Optional(i.Ref(p)),
        borderWidth: i.Optional(i.Ref(Te))
      })
    }))
  })),
  header: i.Optional(i.Object({
    background: i.Optional(i.Ref(p)),
    borderWidth: i.Optional(i.Ref(Te)),
    borderColor: i.Optional(i.Ref(p)),
    boxShadow: i.Optional(i.Ref(Zn)),
    headline: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te))
    })),
    title: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    }))
  })),
  form: Kr,
  sidebar: i.Optional(i.Object({
    background: i.Optional(i.Ref(p)),
    foreground: i.Optional(i.Ref(p)),
    fontFamily: i.Optional(i.Ref(te)),
    borderWidth: i.Optional(i.Ref(Te)),
    borderColor: i.Optional(i.Ref(p)),
    section: i.Optional(i.Object({
      toggle: i.Optional(i.Object({
        icon: i.Optional(i.Object({
          foreground: i.Optional(i.Ref(p)),
          foregroundHover: i.Optional(i.Ref(p)),
          foregroundActive: i.Optional(i.Ref(p))
        })),
        foreground: i.Optional(i.Ref(p)),
        foregroundHover: i.Optional(i.Ref(p)),
        foregroundActive: i.Optional(i.Ref(p)),
        background: i.Optional(i.Ref(p)),
        backgroundHover: i.Optional(i.Ref(p)),
        backgroundActive: i.Optional(i.Ref(p)),
        fontFamily: i.Optional(i.Ref(te)),
        borderWidth: i.Optional(i.Ref(Te)),
        borderColor: i.Optional(i.Ref(p))
      })),
      form: Kr
    }))
  })),
  public: i.Optional(i.Object({
    background: i.Optional(i.Ref(p)),
    foreground: i.Optional(i.Ref(p)),
    foregroundAccent: i.Optional(i.Ref(p)),
    art: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      primary: i.Optional(i.Ref(p)),
      secondary: i.Optional(i.Ref(p)),
      speed: i.Optional(i.Ref(Hg))
    })),
    form: Kr
  })),
  popover: i.Optional(i.Object({
    menu: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      borderRadius: i.Optional(i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)]))),
      boxShadow: i.Optional(i.Ref(Zn))
    }))
  })),
  banner: i.Optional(i.Object({
    background: i.Optional(i.Ref(p)),
    padding: i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)])),
    borderRadius: i.Optional(i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)]))),
    avatar: i.Optional(i.Object({
      background: i.Optional(i.Ref(p)),
      foreground: i.Optional(i.Ref(p)),
      borderRadius: i.Optional(i.Optional(i.Union([i.Ref(Pe), i.Ref(Ze)])))
    })),
    headline: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    title: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    subtitle: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p)),
      fontFamily: i.Optional(i.Ref(te)),
      fontWeight: i.Optional(i.Ref(Re))
    })),
    art: i.Optional(i.Object({
      foreground: i.Optional(i.Ref(p))
    }))
  }))
}), Yg = i.Object({
  id: i.String(),
  name: i.String(),
  appearance: i.Union([i.Literal("light"), i.Literal("dark")]),
  rules: qg
});
var Ao;
(function(e) {
  e[e.None = 0] = "None", e[e.RemainingAdmins = 1] = "RemainingAdmins", e[e.UserLimits = 2] = "UserLimits", e[e.All = 3] = "All";
})(Ao || (Ao = {}));
const Xg = ft([Nn(), yf()]);
Ke({
  type: Nn(),
  uid: Xg.optional()
}).passthrough();
const Qg = (e) => {
  const n = Ve(() => {
    const o = /* @__PURE__ */ new Map(), u = (c, s = []) => {
      for (const [a, l] of Object.entries(c))
        typeof l == "object" && l !== null && ("type" in l && l.type === "object" && "properties" in l && u(l.properties, [...s, a]), "$ref" in l && l.$ref === "FamilyName" && (o.has(s) ? o.set(s, { family: a, weight: o.get(s).weight }) : o.set(s, { family: a, weight: null })), "$ref" in l && l.$ref === "FontWeight" && (o.has(s) ? o.set(s, { family: o.get(s).family, weight: a }) : o.set(s, { family: null, weight: a })));
    };
    return u(Yg.properties.rules.properties), o;
  }), r = Ve(() => {
    const o = /* @__PURE__ */ new Map();
    for (const [u, { family: c, weight: s }] of n.value.entries()) {
      let a = null, l = null;
      if (c && (a = Ht(ae(e).rules, [...u, c])), s && (l = Ht(ae(e).rules, [...u, s])), a) {
        const m = a.split(",");
        for (const h of m) {
          const b = h.trim();
          if (b.startsWith("var(--")) {
            m.push(pu(b.slice(6, -1)));
            continue;
          }
          if ((b.startsWith('"') && b.endsWith('"')) === !1)
            continue;
          const F = b.slice(1, -1);
          o.has(F) ? o.get(F).add(l ?? "400") : o.set(F, /* @__PURE__ */ new Set([l ?? "400"]));
        }
      }
    }
    return o;
  });
  return { googleFonts: Ve(() => {
    const o = [];
    for (const [u, c] of r.value.entries())
      if (["Inter", "Merriweather", "Fira Mono"].includes(u) === !1) {
        const a = Array.from(c).sort((l, m) => Number(l) - Number(m)).join(";");
        o.push(`${u.replaceAll(" ", "+")}:wght@${a}`);
      }
    return o;
  }) };
}, Mr = (e) => e, Kt = Mr({
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
}), eb = Mr({
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
}), Vt = Mr({
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
}), nb = Mr({
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
}), rb = [Kt], tb = [Vt, nb, eb], ob = fu("🎨 Themes", () => {
  const e = eu({ light: tb, dark: rb });
  return { themes: e, registerTheme: (r) => {
    r.appearance === "light" ? e.light.push(r) : e.dark.push(r);
  } };
}), ib = (e, n, r, t, o) => {
  const { themes: u } = du(ob());
  return { theme: Ve(() => {
    const s = ae(e) ? ae(r) : ae(n), a = ae(e) ? Kt : Vt, l = ae(e) ? ae(o) : ae(t), m = ae(u)[ae(e) ? "dark" : "light"].find((h) => h.id === s);
    return m ? l ? Lr({}, a, m, { rules: l }) : Lr(a, m) : (s && s !== a.id && console.warn(`Theme "${s}" doesn't exist.`), l ? Lr({}, a, { rules: l }) : a);
  }) };
}, ub = (e) => {
  const n = mu(e, { delimiter: "--" }), r = (t) => `--theme--${lu(t, { separator: "-" })}`;
  return au(n, (t, o) => r(o));
}, pb = /* @__PURE__ */ nu({
  __name: "theme-provider",
  props: {
    darkMode: { type: Boolean },
    themeLight: { default: Vt.name },
    themeLightOverrides: { default: () => ({}) },
    themeDark: { default: Kt.name },
    themeDarkOverrides: { default: () => ({}) }
  },
  setup(e) {
    const n = e, { darkMode: r, themeLight: t, themeDark: o, themeLightOverrides: u, themeDarkOverrides: c } = ru(n), { theme: s } = ib(r, t, o, u, c), a = Ve(() => ub(ae(s).rules)), { googleFonts: l } = Qg(s);
    su({
      link: Ve(() => {
        let h = "";
        if (l.value.length > 0) {
          const b = l.value.join("&family=");
          h += `https://fonts.googleapis.com/css2?family=${b}`, h += `
`;
        }
        return h ? [
          {
            rel: "stylesheet",
            href: h
          }
        ] : [];
      })
    });
    const m = Ve(() => `:root {${Object.entries(ae(a)).map(([b, F]) => `${b}: ${F};`).join(" ")}}`);
    return (h, b) => (tu(), ou(iu, { to: "#theme" }, [
      uu(cu(m.value), 1)
    ]));
  }
});
export {
  pb as ThemeProvider,
  Mr as defineTheme,
  ub as rulesToCssVars,
  Qg as useFonts,
  ib as useTheme,
  ob as useThemeStore
};
