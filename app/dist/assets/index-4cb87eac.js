import{g as O}from"./index.c1b672a5.entry.js";import{i as m,b as j,a as z,c as R,d as F}from"./index-ead2b777.js";function q(n,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in n)){const o=Object.getOwnPropertyDescriptor(a,r);o&&Object.defineProperty(n,r,o.get?o:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var g={exports:{}},b={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lessThanXSeconds:{one:"بىر سىكۇنت ئىچىدە",other:"سىكۇنت ئىچىدە {{count}}"},xSeconds:{one:"بىر سىكۇنت",other:"سىكۇنت {{count}}"},halfAMinute:"يىرىم مىنۇت",lessThanXMinutes:{one:"بىر مىنۇت ئىچىدە",other:"مىنۇت ئىچىدە {{count}}"},xMinutes:{one:"بىر مىنۇت",other:"مىنۇت {{count}}"},aboutXHours:{one:"تەخمىنەن بىر سائەت",other:"سائەت {{count}} تەخمىنەن"},xHours:{one:"بىر سائەت",other:"سائەت {{count}}"},xDays:{one:"بىر كۈن",other:"كۈن {{count}}"},aboutXWeeks:{one:"تەخمىنەن بىرھەپتە",other:"ھەپتە {{count}} تەخمىنەن"},xWeeks:{one:"بىرھەپتە",other:"ھەپتە {{count}}"},aboutXMonths:{one:"تەخمىنەن بىر ئاي",other:"ئاي {{count}} تەخمىنەن"},xMonths:{one:"بىر ئاي",other:"ئاي {{count}}"},aboutXYears:{one:"تەخمىنەن بىر يىل",other:"يىل {{count}} تەخمىنەن"},xYears:{one:"بىر يىل",other:"يىل {{count}}"},overXYears:{one:"بىر يىلدىن ئارتۇق",other:"يىلدىن ئارتۇق {{count}}"},almostXYears:{one:"ئاساسەن بىر يىل",other:"يىل {{count}} ئاساسەن"}},a=function(u,l,i){var d,f=t[u];return typeof f=="string"?d=f:l===1?d=f.one:d=f.other.replace("{{count}}",String(l)),i!=null&&i.addSuffix?i.comparison&&i.comparison>0?d:d+" بولدى":d},r=a;e.default=r,n.exports=e.default})(b,b.exports);var C=b.exports,y={exports:{}};(function(n,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(j),r={full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},o={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},u={full:"{{date}} 'دە' {{time}}",long:"{{date}} 'دە' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},l={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:o,defaultWidth:"full"}),dateTime:(0,a.default)({formats:u,defaultWidth:"full"})},i=l;e.default=i,n.exports=e.default})(y,y.exports);var L=y.exports,P={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"'ئ‍ۆتكەن' eeee 'دە' p",yesterday:"'تۈنۈگۈن دە' p",today:"'بۈگۈن دە' p",tomorrow:"'ئەتە دە' p",nextWeek:"eeee 'دە' p",other:"P"},a=function(u,l,i,d){return t[u]},r=a;e.default=r,n.exports=e.default})(P,P.exports);var S=P.exports,_={exports:{}};(function(n,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(z),r={narrow:["ب","ك"],abbreviated:["ب","ك"],wide:["مىيلادىدىن بۇرۇن","مىيلادىدىن كىيىن"]},o={narrow:["1","2","3","4"],abbreviated:["1","2","3","4"],wide:["بىرىنجى چارەك","ئىككىنجى چارەك","ئۈچىنجى چارەك","تۆتىنجى چارەك"]},u={narrow:["ي","ف","م","ا","م","ى","ى","ا","س","ۆ","ن","د"],abbreviated:["يانۋار","فېۋىرال","مارت","ئاپرىل","ماي","ئىيۇن","ئىيول","ئاۋغۇست","سىنتەبىر","ئۆكتەبىر","نويابىر","دىكابىر"],wide:["يانۋار","فېۋىرال","مارت","ئاپرىل","ماي","ئىيۇن","ئىيول","ئاۋغۇست","سىنتەبىر","ئۆكتەبىر","نويابىر","دىكابىر"]},l={narrow:["ي","د","س","چ","پ","ج","ش"],short:["ي","د","س","چ","پ","ج","ش"],abbreviated:["يەكشەنبە","دۈشەنبە","سەيشەنبە","چارشەنبە","پەيشەنبە","جۈمە","شەنبە"],wide:["يەكشەنبە","دۈشەنبە","سەيشەنبە","چارشەنبە","پەيشەنبە","جۈمە","شەنبە"]},i={narrow:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەن",afternoon:"چۈشتىن كىيىن",evening:"ئاخشىم",night:"كىچە"},abbreviated:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەن",afternoon:"چۈشتىن كىيىن",evening:"ئاخشىم",night:"كىچە"},wide:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەن",afternoon:"چۈشتىن كىيىن",evening:"ئاخشىم",night:"كىچە"}},d={narrow:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەندە",afternoon:"چۈشتىن كىيىن",evening:"ئاخشامدا",night:"كىچىدە"},abbreviated:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەندە",afternoon:"چۈشتىن كىيىن",evening:"ئاخشامدا",night:"كىچىدە"},wide:{am:"ئە",pm:"چ",midnight:"ك",noon:"چ",morning:"ئەتىگەندە",afternoon:"چۈشتىن كىيىن",evening:"ئاخشامدا",night:"كىچىدە"}},f=function(s,w){return String(s)},v={ordinalNumber:f,era:(0,a.default)({values:r,defaultWidth:"wide"}),quarter:(0,a.default)({values:o,defaultWidth:"wide",argumentCallback:function(s){return s-1}}),month:(0,a.default)({values:u,defaultWidth:"wide"}),day:(0,a.default)({values:l,defaultWidth:"wide"}),dayPeriod:(0,a.default)({values:i,defaultWidth:"wide",formattingValues:d,defaultFormattingWidth:"wide"})},c=v;e.default=c,n.exports=e.default})(_,_.exports);var V=_.exports,x={exports:{}};(function(n,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(R),r=t(F),o=/^(\d+)(th|st|nd|rd)?/i,u=/\d+/i,l={narrow:/^(ب|ك)/i,wide:/^(مىيلادىدىن بۇرۇن|مىيلادىدىن كىيىن)/i},i={any:[/^بۇرۇن/i,/^كىيىن/i]},d={narrow:/^[1234]/i,abbreviated:/^چ[1234]/i,wide:/^چارەك [1234]/i},f={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[يفمئامئ‍ئاسۆند]/i,abbreviated:/^(يانۋار|فېۋىرال|مارت|ئاپرىل|ماي|ئىيۇن|ئىيول|ئاۋغۇست|سىنتەبىر|ئۆكتەبىر|نويابىر|دىكابىر)/i,wide:/^(يانۋار|فېۋىرال|مارت|ئاپرىل|ماي|ئىيۇن|ئىيول|ئاۋغۇست|سىنتەبىر|ئۆكتەبىر|نويابىر|دىكابىر)/i},c={narrow:[/^ي/i,/^ف/i,/^م/i,/^ا/i,/^م/i,/^ى‍/i,/^ى‍/i,/^ا‍/i,/^س/i,/^ۆ/i,/^ن/i,/^د/i],any:[/^يان/i,/^فېۋ/i,/^مار/i,/^ئاپ/i,/^ماي/i,/^ئىيۇن/i,/^ئىيول/i,/^ئاۋ/i,/^سىن/i,/^ئۆك/i,/^نوي/i,/^دىك/i]},h={narrow:/^[دسچپجشي]/i,short:/^(يە|دۈ|سە|چا|پە|جۈ|شە)/i,abbreviated:/^(يە|دۈ|سە|چا|پە|جۈ|شە)/i,wide:/^(يەكشەنبە|دۈشەنبە|سەيشەنبە|چارشەنبە|پەيشەنبە|جۈمە|شەنبە)/i},s={narrow:[/^ي/i,/^د/i,/^س/i,/^چ/i,/^پ/i,/^ج/i,/^ش/i],any:[/^ي/i,/^د/i,/^س/i,/^چ/i,/^پ/i,/^ج/i,/^ش/i]},w={narrow:/^(ئە|چ|ك|چ|(دە|ئەتىگەن) ( ئە‍|چۈشتىن كىيىن|ئاخشىم|كىچە))/i,any:/^(ئە|چ|ك|چ|(دە|ئەتىگەن) ( ئە‍|چۈشتىن كىيىن|ئاخشىم|كىچە))/i},W={any:{am:/^ئە/i,pm:/^چ/i,midnight:/^ك/i,noon:/^چ/i,morning:/ئەتىگەن/i,afternoon:/چۈشتىن كىيىن/i,evening:/ئاخشىم/i,night:/كىچە/i}},D={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:u,valueCallback:function(p){return parseInt(p,10)}}),era:(0,a.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,a.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:c,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:w,defaultMatchWidth:"any",parsePatterns:W,defaultParseWidth:"any"})},E=D;e.default=E,n.exports=e.default})(x,x.exports);var X=x.exports;(function(n,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(C),r=t(L),o=t(S),u=t(V),l=t(X),i={code:"ug",formatDistance:a.default,formatLong:r.default,formatRelative:o.default,localize:u.default,match:l.default,options:{weekStartsOn:0,firstWeekContainsDate:1}},d=i;e.default=d,n.exports=e.default})(g,g.exports);var M=g.exports;const N=O(M),A=q({__proto__:null,default:N},[M]);export{A as i};
