import{g as F}from"./index.85962662.entry.js";import{i as g,b as E,a as O,c as R,d as z}from"./index-ead2b777.js";import{i as C}from"./index-60ea3339.js";function K(l,a){for(var o=0;o<a.length;o++){const r=a[o];if(typeof r!="string"&&!Array.isArray(r)){for(const i in r)if(i!=="default"&&!(i in l)){const u=Object.getOwnPropertyDescriptor(r,i);u&&Object.defineProperty(l,i,u.get?u:{enumerable:!0,get:()=>r[i]})}}}return Object.freeze(Object.defineProperty(l,Symbol.toStringTag,{value:"Module"}))}var y={exports:{}},w={exports:{}};(function(l,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;function o(t,e){return e===1&&t.one?t.one:e>=2&&e<=4&&t.twoFour?t.twoFour:t.other}function r(t,e,d){var s=o(t,e),n=s[d];return n.replace("{{count}}",String(e))}function i(t){var e=["lessThan","about","over","almost"].filter(function(d){return!!t.match(new RegExp("^"+d))});return e[0]}function u(t){var e="";return t==="almost"&&(e="takmer"),t==="about"&&(e="približne"),e.length>0?e+" ":""}function p(t){var e="";return t==="lessThan"&&(e="menej než"),t==="over"&&(e="viac než"),e.length>0?e+" ":""}function f(t){return t.charAt(0).toLowerCase()+t.slice(1)}var m={xSeconds:{one:{present:"sekunda",past:"sekundou",future:"sekundu"},twoFour:{present:"{{count}} sekundy",past:"{{count}} sekundami",future:"{{count}} sekundy"},other:{present:"{{count}} sekúnd",past:"{{count}} sekundami",future:"{{count}} sekúnd"}},halfAMinute:{other:{present:"pol minúty",past:"pol minútou",future:"pol minúty"}},xMinutes:{one:{present:"minúta",past:"minútou",future:"minútu"},twoFour:{present:"{{count}} minúty",past:"{{count}} minútami",future:"{{count}} minúty"},other:{present:"{{count}} minút",past:"{{count}} minútami",future:"{{count}} minút"}},xHours:{one:{present:"hodina",past:"hodinou",future:"hodinu"},twoFour:{present:"{{count}} hodiny",past:"{{count}} hodinami",future:"{{count}} hodiny"},other:{present:"{{count}} hodín",past:"{{count}} hodinami",future:"{{count}} hodín"}},xDays:{one:{present:"deň",past:"dňom",future:"deň"},twoFour:{present:"{{count}} dni",past:"{{count}} dňami",future:"{{count}} dni"},other:{present:"{{count}} dní",past:"{{count}} dňami",future:"{{count}} dní"}},xWeeks:{one:{present:"týždeň",past:"týždňom",future:"týždeň"},twoFour:{present:"{{count}} týždne",past:"{{count}} týždňami",future:"{{count}} týždne"},other:{present:"{{count}} týždňov",past:"{{count}} týždňami",future:"{{count}} týždňov"}},xMonths:{one:{present:"mesiac",past:"mesiacom",future:"mesiac"},twoFour:{present:"{{count}} mesiace",past:"{{count}} mesiacmi",future:"{{count}} mesiace"},other:{present:"{{count}} mesiacov",past:"{{count}} mesiacmi",future:"{{count}} mesiacov"}},xYears:{one:{present:"rok",past:"rokom",future:"rok"},twoFour:{present:"{{count}} roky",past:"{{count}} rokmi",future:"{{count}} roky"},other:{present:"{{count}} rokov",past:"{{count}} rokmi",future:"{{count}} rokov"}}},c=function(e,d,s){var n=i(e)||"",v=f(e.substring(n.length)),b=m[v];return s!=null&&s.addSuffix?s.comparison&&s.comparison>0?u(n)+"o "+p(n)+r(b,d,"future"):u(n)+"pred "+p(n)+r(b,d,"past"):u(n)+p(n)+r(b,d,"present")},h=c;a.default=h,l.exports=a.default})(w,w.exports);var q=w.exports,P={exports:{}};(function(l,a){var o=g.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var r=o(E),i={full:"EEEE d. MMMM y",long:"d. MMMM y",medium:"d. M. y",short:"d. M. y"},u={full:"H:mm:ss zzzz",long:"H:mm:ss z",medium:"H:mm:ss",short:"H:mm"},p={full:"{{date}}, {{time}}",long:"{{date}}, {{time}}",medium:"{{date}}, {{time}}",short:"{{date}} {{time}}"},f={date:(0,r.default)({formats:i,defaultWidth:"full"}),time:(0,r.default)({formats:u,defaultWidth:"full"}),dateTime:(0,r.default)({formats:p,defaultWidth:"full"})},m=f;a.default=m,l.exports=a.default})(P,P.exports);var A=P.exports,j={exports:{}};(function(l,a){var o=g.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var r=o(C),i=["nedeľu","pondelok","utorok","stredu","štvrtok","piatok","sobotu"];function u(t){var e=i[t];switch(t){case 0:case 3:case 6:return"'minulú "+e+" o' p";default:return"'minulý' eeee 'o' p"}}function p(t){var e=i[t];return t===4?"'vo' eeee 'o' p":"'v "+e+" o' p"}function f(t){var e=i[t];switch(t){case 0:case 4:case 6:return"'budúcu "+e+" o' p";default:return"'budúci' eeee 'o' p"}}var m={lastWeek:function(e,d,s){var n=e.getUTCDay();return(0,r.default)(e,d,s)?p(n):u(n)},yesterday:"'včera o' p",today:"'dnes o' p",tomorrow:"'zajtra o' p",nextWeek:function(e,d,s){var n=e.getUTCDay();return(0,r.default)(e,d,s)?p(n):f(n)},other:"P"},c=function(e,d,s,n){var v=m[e];return typeof v=="function"?v(d,s,n):v},h=c;a.default=h,l.exports=a.default})(j,j.exports);var L=j.exports,x={exports:{}};(function(l,a){var o=g.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var r=o(O),i={narrow:["pred Kr.","po Kr."],abbreviated:["pred Kr.","po Kr."],wide:["pred Kristom","po Kristovi"]},u={narrow:["1","2","3","4"],abbreviated:["Q1","Q2","Q3","Q4"],wide:["1. štvrťrok","2. štvrťrok","3. štvrťrok","4. štvrťrok"]},p={narrow:["j","f","m","a","m","j","j","a","s","o","n","d"],abbreviated:["jan","feb","mar","apr","máj","jún","júl","aug","sep","okt","nov","dec"],wide:["január","február","marec","apríl","máj","jún","júl","august","september","október","november","december"]},f={narrow:["j","f","m","a","m","j","j","a","s","o","n","d"],abbreviated:["jan","feb","mar","apr","máj","jún","júl","aug","sep","okt","nov","dec"],wide:["januára","februára","marca","apríla","mája","júna","júla","augusta","septembra","októbra","novembra","decembra"]},m={narrow:["n","p","u","s","š","p","s"],short:["ne","po","ut","st","št","pi","so"],abbreviated:["ne","po","ut","st","št","pi","so"],wide:["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"]},c={narrow:{am:"AM",pm:"PM",midnight:"poln.",noon:"pol.",morning:"ráno",afternoon:"pop.",evening:"več.",night:"noc"},abbreviated:{am:"AM",pm:"PM",midnight:"poln.",noon:"pol.",morning:"ráno",afternoon:"popol.",evening:"večer",night:"noc"},wide:{am:"AM",pm:"PM",midnight:"polnoc",noon:"poludnie",morning:"ráno",afternoon:"popoludnie",evening:"večer",night:"noc"}},h={narrow:{am:"AM",pm:"PM",midnight:"o poln.",noon:"nap.",morning:"ráno",afternoon:"pop.",evening:"več.",night:"v n."},abbreviated:{am:"AM",pm:"PM",midnight:"o poln.",noon:"napol.",morning:"ráno",afternoon:"popol.",evening:"večer",night:"v noci"},wide:{am:"AM",pm:"PM",midnight:"o polnoci",noon:"napoludnie",morning:"ráno",afternoon:"popoludní",evening:"večer",night:"v noci"}},t=function(n,v){var b=Number(n);return b+"."},e={ordinalNumber:t,era:(0,r.default)({values:i,defaultWidth:"wide"}),quarter:(0,r.default)({values:u,defaultWidth:"wide",argumentCallback:function(n){return n-1}}),month:(0,r.default)({values:p,defaultWidth:"wide",formattingValues:f,defaultFormattingWidth:"wide"}),day:(0,r.default)({values:m,defaultWidth:"wide"}),dayPeriod:(0,r.default)({values:c,defaultWidth:"wide",formattingValues:h,defaultFormattingWidth:"wide"})},d=e;a.default=d,l.exports=a.default})(x,x.exports);var T=x.exports,M={exports:{}};(function(l,a){var o=g.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var r=o(R),i=o(z),u=/^(\d+)\.?/i,p=/\d+/i,f={narrow:/^(pred Kr\.|pred n\. l\.|po Kr\.|n\. l\.)/i,abbreviated:/^(pred Kr\.|pred n\. l\.|po Kr\.|n\. l\.)/i,wide:/^(pred Kristom|pred na[šs][íi]m letopo[čc]tom|po Kristovi|n[áa][šs]ho letopo[čc]tu)/i},m={any:[/^pr/i,/^(po|n)/i]},c={narrow:/^[1234]/i,abbreviated:/^q[1234]/i,wide:/^[1234]\. [šs]tvr[ťt]rok/i},h={any:[/1/i,/2/i,/3/i,/4/i]},t={narrow:/^[jfmasond]/i,abbreviated:/^(jan|feb|mar|apr|m[áa]j|j[úu]n|j[úu]l|aug|sep|okt|nov|dec)/i,wide:/^(janu[áa]ra?|febru[áa]ra?|(marec|marca)|apr[íi]la?|m[áa]ja?|j[úu]na?|j[úu]la?|augusta?|(september|septembra)|(okt[óo]ber|okt[óo]bra)|(november|novembra)|(december|decembra))/i},e={narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^j/i,/^j/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^m[áa]j/i,/^j[úu]n/i,/^j[úu]l/i,/^au/i,/^s/i,/^o/i,/^n/i,/^d/i]},d={narrow:/^[npusšp]/i,short:/^(ne|po|ut|st|št|pi|so)/i,abbreviated:/^(ne|po|ut|st|št|pi|so)/i,wide:/^(nede[ľl]a|pondelok|utorok|streda|[šs]tvrtok|piatok|sobota])/i},s={narrow:[/^n/i,/^p/i,/^u/i,/^s/i,/^š/i,/^p/i,/^s/i],any:[/^n/i,/^po/i,/^u/i,/^st/i,/^(št|stv)/i,/^pi/i,/^so/i]},n={narrow:/^(am|pm|(o )?poln\.?|(nap\.?|pol\.?)|r[áa]no|pop\.?|ve[čc]\.?|(v n\.?|noc))/i,abbreviated:/^(am|pm|(o )?poln\.?|(napol\.?|pol\.?)|r[áa]no|pop\.?|ve[čc]er|(v )?noci?)/i,any:/^(am|pm|(o )?polnoci?|(na)?poludnie|r[áa]no|popoludn(ie|í|i)|ve[čc]er|(v )?noci?)/i},v={any:{am:/^am/i,pm:/^pm/i,midnight:/poln/i,noon:/^(nap|(na)?pol(\.|u))/i,morning:/^r[áa]no/i,afternoon:/^pop/i,evening:/^ve[čc]/i,night:/^(noc|v n\.)/i}},b={ordinalNumber:(0,i.default)({matchPattern:u,parsePattern:p,valueCallback:function(k){return parseInt(k,10)}}),era:(0,r.default)({matchPatterns:f,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"any"}),quarter:(0,r.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any",valueCallback:function(k){return k+1}}),month:(0,r.default)({matchPatterns:t,defaultMatchWidth:"wide",parsePatterns:e,defaultParseWidth:"any"}),day:(0,r.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any"}),dayPeriod:(0,r.default)({matchPatterns:n,defaultMatchWidth:"any",parsePatterns:v,defaultParseWidth:"any"})},W=b;a.default=W,l.exports=a.default})(M,M.exports);var V=M.exports;(function(l,a){var o=g.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var r=o(q),i=o(A),u=o(L),p=o(T),f=o(V),m={code:"sk",formatDistance:r.default,formatLong:i.default,formatRelative:u.default,localize:p.default,match:f.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},c=m;a.default=c,l.exports=a.default})(y,y.exports);var _=y.exports;const N=F(_),U=K({__proto__:null,default:N},[_]);export{U as i};
