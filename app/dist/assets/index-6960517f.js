import{g as v}from"./index.c1b672a5.entry.js";import{i as s,b as y}from"./index-ead2b777.js";import{f as c}from"./index-06eb6e8d.js";import{f as x,l as _,m as g}from"./index-e192e9da.js";function M(o,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in o)){const f=Object.getOwnPropertyDescriptor(a,r);f&&Object.defineProperty(o,r,f.get?f:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(o,Symbol.toStringTag,{value:"Module"}))}var u={exports:{}},m={exports:{}};(function(o,e){var t=s.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(y),r={full:"EEEE, d MMMM yyyy",long:"d MMMM, yyyy",medium:"d MMM, yyyy",short:"dd/MM/yyyy"},f={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},l={full:"{{date}} 'at' {{time}}",long:"{{date}} 'at' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},d={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:f,defaultWidth:"full"}),dateTime:(0,a.default)({formats:l,defaultWidth:"full"})},i=d;e.default=i,o.exports=e.default})(m,m.exports);var h=m.exports;(function(o,e){var t=s.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(c),r=t(x),f=t(_),l=t(g),d=t(h),i={code:"en-IN",formatDistance:a.default,formatLong:d.default,formatRelative:r.default,localize:f.default,match:l.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},p=i;e.default=p,o.exports=e.default})(u,u.exports);var n=u.exports;const E=v(n),j=M({__proto__:null,default:E},[n]);export{j as i};
