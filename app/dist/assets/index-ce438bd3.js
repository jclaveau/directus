import{g as E}from"./index.64088c7b.entry.js";import{i as c,b as S,a as F,c as k,d as O}from"./index-ead2b777.js";function L(r,a){for(var t=0;t<a.length;t++){const e=a[t];if(typeof e!="string"&&!Array.isArray(e)){for(const i in e)if(i!=="default"&&!(i in r)){const o=Object.getOwnPropertyDescriptor(e,i);o&&Object.defineProperty(r,i,o.get?o:{enumerable:!0,get:()=>e[i]})}}}return Object.freeze(Object.defineProperty(r,Symbol.toStringTag,{value:"Module"}))}var y={exports:{}},w={exports:{}};(function(r,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lessThanXSeconds:{one:"nas lugha na diog",other:"nas lugha na {{count}} diogan"},xSeconds:{one:"1 diog",two:"2 dhiog",twenty:"20 diog",other:"{{count}} diogan"},halfAMinute:"leth mhionaid",lessThanXMinutes:{one:"nas lugha na mionaid",other:"nas lugha na {{count}} mionaidean"},xMinutes:{one:"1 mionaid",two:"2 mhionaid",twenty:"20 mionaid",other:"{{count}} mionaidean"},aboutXHours:{one:"mu uair de thìde",other:"mu {{count}} uairean de thìde"},xHours:{one:"1 uair de thìde",two:"2 uair de thìde",twenty:"20 uair de thìde",other:"{{count}} uairean de thìde"},xDays:{one:"1 là",other:"{{count}} là"},aboutXWeeks:{one:"mu 1 seachdain",other:"mu {{count}} seachdainean"},xWeeks:{one:"1 seachdain",other:"{{count}} seachdainean"},aboutXMonths:{one:"mu mhìos",other:"mu {{count}} mìosan"},xMonths:{one:"1 mìos",other:"{{count}} mìosan"},aboutXYears:{one:"mu bhliadhna",other:"mu {{count}} bliadhnaichean"},xYears:{one:"1 bhliadhna",other:"{{count}} bliadhna"},overXYears:{one:"còrr is bliadhna",other:"còrr is {{count}} bliadhnaichean"},almostXYears:{one:"cha mhòr bliadhna",other:"cha mhòr {{count}} bliadhnaichean"}},e=function(u,l,d){var n,h=t[u];return typeof h=="string"?n=h:l===1?n=h.one:l===2&&h.two?n=h.two:l===20&&h.twenty?n=h.twenty:n=h.other.replace("{{count}}",String(l)),d!=null&&d.addSuffix?d.comparison&&d.comparison>0?"ann an "+n:"o chionn "+n:n},i=e;a.default=i,r.exports=a.default})(w,w.exports);var R=w.exports,P={exports:{}};(function(r,a){var t=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(S),i={full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},o={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},u={full:"{{date}} 'aig' {{time}}",long:"{{date}} 'aig' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},l={date:(0,e.default)({formats:i,defaultWidth:"full"}),time:(0,e.default)({formats:o,defaultWidth:"full"}),dateTime:(0,e.default)({formats:u,defaultWidth:"full"})},d=l;a.default=d,r.exports=a.default})(P,P.exports);var j=P.exports,D={exports:{}};(function(r,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lastWeek:"'mu dheireadh' eeee 'aig' p",yesterday:"'an-dè aig' p",today:"'an-diugh aig' p",tomorrow:"'a-màireach aig' p",nextWeek:"eeee 'aig' p",other:"P"},e=function(u,l,d,n){return t[u]},i=e;a.default=i,r.exports=a.default})(D,D.exports);var z=D.exports,M={exports:{}};(function(r,a){var t=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(F),i={narrow:["R","A"],abbreviated:["RC","AD"],wide:["ro Chrìosta","anno domini"]},o={narrow:["1","2","3","4"],abbreviated:["C1","C2","C3","C4"],wide:["a' chiad chairteal","an dàrna cairteal","an treas cairteal","an ceathramh cairteal"]},u={narrow:["F","G","M","G","C","Ò","I","L","S","D","S","D"],abbreviated:["Faoi","Gear","Màrt","Gibl","Cèit","Ògmh","Iuch","Lùn","Sult","Dàmh","Samh","Dùbh"],wide:["Am Faoilleach","An Gearran","Am Màrt","An Giblean","An Cèitean","An t-Ògmhios","An t-Iuchar","An Lùnastal","An t-Sultain","An Dàmhair","An t-Samhain","An Dùbhlachd"]},l={narrow:["D","L","M","C","A","H","S"],short:["Dò","Lu","Mà","Ci","Ar","Ha","Sa"],abbreviated:["Did","Dil","Dim","Dic","Dia","Dih","Dis"],wide:["Didòmhnaich","Diluain","Dimàirt","Diciadain","Diardaoin","Dihaoine","Disathairne"]},d={narrow:{am:"m",pm:"f",midnight:"m.o.",noon:"m.l.",morning:"madainn",afternoon:"feasgar",evening:"feasgar",night:"oidhche"},abbreviated:{am:"M.",pm:"F.",midnight:"meadhan oidhche",noon:"meadhan là",morning:"madainn",afternoon:"feasgar",evening:"feasgar",night:"oidhche"},wide:{am:"m.",pm:"f.",midnight:"meadhan oidhche",noon:"meadhan là",morning:"madainn",afternoon:"feasgar",evening:"feasgar",night:"oidhche"}},n={narrow:{am:"m",pm:"f",midnight:"m.o.",noon:"m.l.",morning:"sa mhadainn",afternoon:"feasgar",evening:"feasgar",night:"air an oidhche"},abbreviated:{am:"M.",pm:"F.",midnight:"meadhan oidhche",noon:"meadhan là",morning:"sa mhadainn",afternoon:"feasgar",evening:"feasgar",night:"air an oidhche"},wide:{am:"m.",pm:"f.",midnight:"meadhan oidhche",noon:"meadhan là",morning:"sa mhadainn",afternoon:"feasgar",evening:"feasgar",night:"air an oidhche"}},h=function(f){var s=Number(f),m=s%100;if(m>20||m<10)switch(m%10){case 1:return s+"d";case 2:return s+"na"}return m===12?s+"na":s+"mh"},v={ordinalNumber:h,era:(0,e.default)({values:i,defaultWidth:"wide"}),quarter:(0,e.default)({values:o,defaultWidth:"wide",argumentCallback:function(f){return f-1}}),month:(0,e.default)({values:u,defaultWidth:"wide"}),day:(0,e.default)({values:l,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:d,defaultWidth:"wide",formattingValues:n,defaultFormattingWidth:"wide"})},g=v;a.default=g,r.exports=a.default})(M,M.exports);var q=M.exports,x={exports:{}};(function(r,a){var t=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(k),i=t(O),o=/^(\d+)(d|na|tr|mh)?/i,u=/\d+/i,l={narrow:/^(r|a)/i,abbreviated:/^(r\.?\s?c\.?|r\.?\s?a\.?\s?c\.?|a\.?\s?d\.?|a\.?\s?c\.?)/i,wide:/^(ro Chrìosta|ron aois choitchinn|anno domini|aois choitcheann)/i},d={any:[/^b/i,/^(a|c)/i]},n={narrow:/^[1234]/i,abbreviated:/^c[1234]/i,wide:/^[1234](cd|na|tr|mh)? cairteal/i},h={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[fgmcòilsd]/i,abbreviated:/^(faoi|gear|màrt|gibl|cèit|ògmh|iuch|lùn|sult|dàmh|samh|dùbh)/i,wide:/^(am faoilleach|an gearran|am màrt|an giblean|an cèitean|an t-Ògmhios|an t-Iuchar|an lùnastal|an t-Sultain|an dàmhair|an t-Samhain|an dùbhlachd)/i},g={narrow:[/^f/i,/^g/i,/^m/i,/^g/i,/^c/i,/^ò/i,/^i/i,/^l/i,/^s/i,/^d/i,/^s/i,/^d/i],any:[/^fa/i,/^ge/i,/^mà/i,/^gi/i,/^c/i,/^ò/i,/^i/i,/^l/i,/^su/i,/^d/i,/^sa/i,/^d/i]},b={narrow:/^[dlmcahs]/i,short:/^(dò|lu|mà|ci|ar|ha|sa)/i,abbreviated:/^(did|dil|dim|dic|dia|dih|dis)/i,wide:/^(didòmhnaich|diluain|dimàirt|diciadain|diardaoin|dihaoine|disathairne)/i},f={narrow:[/^d/i,/^l/i,/^m/i,/^c/i,/^a/i,/^h/i,/^s/i],any:[/^d/i,/^l/i,/^m/i,/^c/i,/^a/i,/^h/i,/^s/i]},s={narrow:/^(a|p|mi|n|(san|aig) (madainn|feasgar|feasgar|oidhche))/i,any:/^([ap]\.?\s?m\.?|meadhan oidhche|meadhan là|(san|aig) (madainn|feasgar|feasgar|oidhche))/i},m={any:{am:/^m/i,pm:/^f/i,midnight:/^meadhan oidhche/i,noon:/^meadhan là/i,morning:/sa mhadainn/i,afternoon:/feasgar/i,evening:/feasgar/i,night:/air an oidhche/i}},W={ordinalNumber:(0,i.default)({matchPattern:o,parsePattern:u,valueCallback:function(p){return parseInt(p,10)}}),era:(0,e.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:d,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:n,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,e.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:g,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:b,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:s,defaultMatchWidth:"any",parsePatterns:m,defaultParseWidth:"any"})},C=W;a.default=C,r.exports=a.default})(x,x.exports);var N=x.exports;(function(r,a){var t=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(R),i=t(j),o=t(z),u=t(q),l=t(N),d={code:"gd",formatDistance:e.default,formatLong:i.default,formatRelative:o.default,localize:u.default,match:l.default,options:{weekStartsOn:0,firstWeekContainsDate:1}},n=d;a.default=n,r.exports=a.default})(y,y.exports);var _=y.exports;const V=E(_),I=L({__proto__:null,default:V},[_]);export{I as i};
