import{g as E}from"./index.85962662.entry.js";import{i as m,b as q,a as O,c as S,d as z}from"./index-ead2b777.js";function F(i,a){for(var t=0;t<a.length;t++){const e=a[t];if(typeof e!="string"&&!Array.isArray(e)){for(const r in e)if(r!=="default"&&!(r in i)){const l=Object.getOwnPropertyDescriptor(e,r);l&&Object.defineProperty(i,r,l.get?l:{enumerable:!0,get:()=>e[r]})}}}return Object.freeze(Object.defineProperty(i,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},p={exports:{}};(function(i,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lessThanXSeconds:{one:"inqas minn sekonda",other:"inqas minn {{count}} sekondi"},xSeconds:{one:"sekonda",other:"{{count}} sekondi"},halfAMinute:"nofs minuta",lessThanXMinutes:{one:"inqas minn minuta",other:"inqas minn {{count}} minuti"},xMinutes:{one:"minuta",other:"{{count}} minuti"},aboutXHours:{one:"madwar siegħa",other:"madwar {{count}} siegħat"},xHours:{one:"siegħa",other:"{{count}} siegħat"},xDays:{one:"ġurnata",other:"{{count}} ġranet"},aboutXWeeks:{one:"madwar ġimgħa",other:"madwar {{count}} ġimgħat"},xWeeks:{one:"ġimgħa",other:"{{count}} ġimgħat"},aboutXMonths:{one:"madwar xahar",other:"madwar {{count}} xhur"},xMonths:{one:"xahar",other:"{{count}} xhur"},aboutXYears:{one:"madwar sena",two:"madwar sentejn",other:"madwar {{count}} snin"},xYears:{one:"sena",two:"sentejn",other:"{{count}} snin"},overXYears:{one:"aktar minn sena",two:"aktar minn sentejn",other:"aktar minn {{count}} snin"},almostXYears:{one:"kważi sena",two:"kważi sentejn",other:"kważi {{count}} snin"}},e=function(u,d,n){var o,s=t[u];return typeof s=="string"?o=s:d===1?o=s.one:d===2&&s.two?o=s.two:o=s.other.replace("{{count}}",String(d)),n!=null&&n.addSuffix?n.comparison&&n.comparison>0?"f'"+o:o+" ilu":o},r=e;a.default=r,i.exports=a.default})(p,p.exports);var T=p.exports,j={exports:{}};(function(i,a){var t=m.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(q),r={full:"EEEE, d MMMM yyyy",long:"d MMMM yyyy",medium:"d MMM yyyy",short:"dd/MM/yyyy"},l={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},u={full:"{{date}} {{time}}",long:"{{date}} {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},d={date:(0,e.default)({formats:r,defaultWidth:"full"}),time:(0,e.default)({formats:l,defaultWidth:"full"}),dateTime:(0,e.default)({formats:u,defaultWidth:"full"})},n=d;a.default=n,i.exports=a.default})(j,j.exports);var L=j.exports,y={exports:{}};(function(i,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lastWeek:"eeee 'li għadda' 'fil-'p",yesterday:"'Il-bieraħ fil-'p",today:"'Illum fil-'p",tomorrow:"'Għada fil-'p",nextWeek:"eeee 'fil-'p",other:"P"},e=function(u,d,n,o){return t[u]},r=e;a.default=r,i.exports=a.default})(y,y.exports);var A=y.exports,x={exports:{}};(function(i,a){var t=m.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(O),r={narrow:["Q","W"],abbreviated:["QK","WK"],wide:["qabel Kristu","wara Kristu"]},l={narrow:["1","2","3","4"],abbreviated:["K1","K2","K3","K4"],wide:["1. kwart","2. kwart","3. kwart","4. kwart"]},u={narrow:["J","F","M","A","M","Ġ","L","A","S","O","N","D"],abbreviated:["Jan","Fra","Mar","Apr","Mej","Ġun","Lul","Aww","Set","Ott","Nov","Diċ"],wide:["Jannar","Frar","Marzu","April","Mejju","Ġunju","Lulju","Awwissu","Settembru","Ottubru","Novembru","Diċembru"]},d={narrow:["Ħ","T","T","E","Ħ","Ġ","S"],short:["Ħa","Tn","Tl","Er","Ħa","Ġi","Si"],abbreviated:["Ħad","Tne","Tli","Erb","Ħam","Ġim","Sib"],wide:["Il-Ħadd","It-Tnejn","It-Tlieta","L-Erbgħa","Il-Ħamis","Il-Ġimgħa","Is-Sibt"]},n={narrow:{am:"a",pm:"p",midnight:"nofsillejl",noon:"nofsinhar",morning:"għodwa",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"lejl"},abbreviated:{am:"AM",pm:"PM",midnight:"nofsillejl",noon:"nofsinhar",morning:"għodwa",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"lejl"},wide:{am:"a.m.",pm:"p.m.",midnight:"nofsillejl",noon:"nofsinhar",morning:"għodwa",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"lejl"}},o={narrow:{am:"a",pm:"p",midnight:"f'nofsillejl",noon:"f'nofsinhar",morning:"filgħodu",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"billejl"},abbreviated:{am:"AM",pm:"PM",midnight:"f'nofsillejl",noon:"f'nofsinhar",morning:"filgħodu",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"billejl"},wide:{am:"a.m.",pm:"p.m.",midnight:"f'nofsillejl",noon:"f'nofsinhar",morning:"filgħodu",afternoon:"wara nofsinhar",evening:"filgħaxija",night:"billejl"}},s=function(f,M){var w=Number(f);return w+"º"},v={ordinalNumber:s,era:(0,e.default)({values:r,defaultWidth:"wide"}),quarter:(0,e.default)({values:l,defaultWidth:"wide",argumentCallback:function(f){return f-1}}),month:(0,e.default)({values:u,defaultWidth:"wide"}),day:(0,e.default)({values:d,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:n,defaultWidth:"wide",formattingValues:o,defaultFormattingWidth:"wide"})},h=v;a.default=h,i.exports=a.default})(x,x.exports);var N=x.exports,P={exports:{}};(function(i,a){var t=m.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(S),r=t(z),l=/^(\d+)(º)?/i,u=/\d+/i,d={narrow:/^(q|w)/i,abbreviated:/^(q\.?\s?k\.?|b\.?\s?c\.?\s?e\.?|w\.?\s?k\.?)/i,wide:/^(qabel kristu|before common era|wara kristu|common era)/i},n={any:[/^(q|b)/i,/^(w|c)/i]},o={narrow:/^[1234]/i,abbreviated:/^k[1234]/i,wide:/^[1234](\.)? kwart/i},s={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[jfmaglsond]/i,abbreviated:/^(jan|fra|mar|apr|mej|ġun|lul|aww|set|ott|nov|diċ)/i,wide:/^(jannar|frar|marzu|april|mejju|ġunju|lulju|awwissu|settembru|ottubru|novembru|diċembru)/i},h={narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^ġ/i,/^l/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^mej/i,/^ġ/i,/^l/i,/^aw/i,/^s/i,/^o/i,/^n/i,/^d/i]},c={narrow:/^[ħteġs]/i,short:/^(ħa|tn|tl|er|ħa|ġi|si)/i,abbreviated:/^(ħad|tne|tli|erb|ħam|ġim|sib)/i,wide:/^(il-ħadd|it-tnejn|it-tlieta|l-erbgħa|il-ħamis|il-ġimgħa|is-sibt)/i},f={narrow:[/^ħ/i,/^t/i,/^t/i,/^e/i,/^ħ/i,/^ġ/i,/^s/i],any:[/^(il-)?ħad/i,/^(it-)?tn/i,/^(it-)?tl/i,/^(l-)?er/i,/^(il-)?ham/i,/^(il-)?ġi/i,/^(is-)?si/i]},M={narrow:/^(a|p|f'nofsillejl|f'nofsinhar|(ta') (għodwa|wara nofsinhar|filgħaxija|lejl))/i,any:/^([ap]\.?\s?m\.?|f'nofsillejl|f'nofsinhar|(ta') (għodwa|wara nofsinhar|filgħaxija|lejl))/i},w={any:{am:/^a/i,pm:/^p/i,midnight:/^f'nofsillejl/i,noon:/^f'nofsinhar/i,morning:/għodwa/i,afternoon:/wara(\s.*)nofsinhar/i,evening:/filgħaxija/i,night:/lejl/i}},k={ordinalNumber:(0,r.default)({matchPattern:l,parsePattern:u,valueCallback:function(g){return parseInt(g,10)}}),era:(0,e.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:o,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(g){return g+1}}),month:(0,e.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:M,defaultMatchWidth:"any",parsePatterns:w,defaultParseWidth:"any"})},W=k;a.default=W,i.exports=a.default})(P,P.exports);var R=P.exports;(function(i,a){var t=m.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(T),r=t(L),l=t(A),u=t(N),d=t(R),n={code:"mt",formatDistance:e.default,formatLong:r.default,formatRelative:l.default,localize:u.default,match:d.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},o=n;a.default=o,i.exports=a.default})(b,b.exports);var _=b.exports;const H=E(_),K=F({__proto__:null,default:H},[_]);export{K as i};
