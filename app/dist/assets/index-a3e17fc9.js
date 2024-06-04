import{g as E}from"./index.c1b672a5.entry.js";import{i as f,b as O,a as F,c as z,d as R}from"./index-ead2b777.js";function H(n,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in n)){const o=Object.getOwnPropertyDescriptor(a,r);o&&Object.defineProperty(n,r,o.get?o:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},k={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lessThanXSeconds:{one:"mindre end ét sekund",other:"mindre end {{count}} sekunder"},xSeconds:{one:"1 sekund",other:"{{count}} sekunder"},halfAMinute:"ét halvt minut",lessThanXMinutes:{one:"mindre end ét minut",other:"mindre end {{count}} minutter"},xMinutes:{one:"1 minut",other:"{{count}} minutter"},aboutXHours:{one:"cirka 1 time",other:"cirka {{count}} timer"},xHours:{one:"1 time",other:"{{count}} timer"},xDays:{one:"1 dag",other:"{{count}} dage"},aboutXWeeks:{one:"cirka 1 uge",other:"cirka {{count}} uger"},xWeeks:{one:"1 uge",other:"{{count}} uger"},aboutXMonths:{one:"cirka 1 måned",other:"cirka {{count}} måneder"},xMonths:{one:"1 måned",other:"{{count}} måneder"},aboutXYears:{one:"cirka 1 år",other:"cirka {{count}} år"},xYears:{one:"1 år",other:"{{count}} år"},overXYears:{one:"over 1 år",other:"over {{count}} år"},almostXYears:{one:"næsten 1 år",other:"næsten {{count}} år"}},a=function(u,m,i){var d,l=t[u];return typeof l=="string"?d=l:m===1?d=l.one:d=l.other.replace("{{count}}",String(m)),i!=null&&i.addSuffix?i.comparison&&i.comparison>0?"om "+d:d+" siden":d},r=a;e.default=r,n.exports=e.default})(k,k.exports);var L=k.exports,P={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(O),r={full:"EEEE 'den' d. MMMM y",long:"d. MMMM y",medium:"d. MMM y",short:"dd/MM/y"},o={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},u={full:"{{date}} 'kl'. {{time}}",long:"{{date}} 'kl'. {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},m={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:o,defaultWidth:"full"}),dateTime:(0,a.default)({formats:u,defaultWidth:"full"})},i=m;e.default=i,n.exports=e.default})(P,P.exports);var N=P.exports,y={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"'sidste' eeee 'kl.' p",yesterday:"'i går kl.' p",today:"'i dag kl.' p",tomorrow:"'i morgen kl.' p",nextWeek:"'på' eeee 'kl.' p",other:"P"},a=function(u,m,i,d){return t[u]},r=a;e.default=r,n.exports=e.default})(y,y.exports);var S=y.exports,M={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(F),r={narrow:["fvt","vt"],abbreviated:["f.v.t.","v.t."],wide:["før vesterlandsk tidsregning","vesterlandsk tidsregning"]},o={narrow:["1","2","3","4"],abbreviated:["1. kvt.","2. kvt.","3. kvt.","4. kvt."],wide:["1. kvartal","2. kvartal","3. kvartal","4. kvartal"]},u={narrow:["J","F","M","A","M","J","J","A","S","O","N","D"],abbreviated:["jan.","feb.","mar.","apr.","maj","jun.","jul.","aug.","sep.","okt.","nov.","dec."],wide:["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"]},m={narrow:["S","M","T","O","T","F","L"],short:["sø","ma","ti","on","to","fr","lø"],abbreviated:["søn.","man.","tir.","ons.","tor.","fre.","lør."],wide:["søndag","mandag","tirsdag","onsdag","torsdag","fredag","lørdag"]},i={narrow:{am:"a",pm:"p",midnight:"midnat",noon:"middag",morning:"morgen",afternoon:"eftermiddag",evening:"aften",night:"nat"},abbreviated:{am:"AM",pm:"PM",midnight:"midnat",noon:"middag",morning:"morgen",afternoon:"eftermiddag",evening:"aften",night:"nat"},wide:{am:"a.m.",pm:"p.m.",midnight:"midnat",noon:"middag",morning:"morgen",afternoon:"eftermiddag",evening:"aften",night:"nat"}},d={narrow:{am:"a",pm:"p",midnight:"midnat",noon:"middag",morning:"om morgenen",afternoon:"om eftermiddagen",evening:"om aftenen",night:"om natten"},abbreviated:{am:"AM",pm:"PM",midnight:"midnat",noon:"middag",morning:"om morgenen",afternoon:"om eftermiddagen",evening:"om aftenen",night:"om natten"},wide:{am:"a.m.",pm:"p.m.",midnight:"midnat",noon:"middag",morning:"om morgenen",afternoon:"om eftermiddagen",evening:"om aftenen",night:"om natten"}},l=function(s,x){var h=Number(s);return h+"."},v={ordinalNumber:l,era:(0,a.default)({values:r,defaultWidth:"wide"}),quarter:(0,a.default)({values:o,defaultWidth:"wide",argumentCallback:function(s){return s-1}}),month:(0,a.default)({values:u,defaultWidth:"wide"}),day:(0,a.default)({values:m,defaultWidth:"wide"}),dayPeriod:(0,a.default)({values:i,defaultWidth:"wide",formattingValues:d,defaultFormattingWidth:"wide"})},g=v;e.default=g,n.exports=e.default})(M,M.exports);var q=M.exports,_={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(z),r=t(R),o=/^(\d+)(\.)?/i,u=/\d+/i,m={narrow:/^(fKr|fvt|eKr|vt)/i,abbreviated:/^(f\.Kr\.?|f\.v\.t\.?|e\.Kr\.?|v\.t\.)/i,wide:/^(f.Kr.|før vesterlandsk tidsregning|e.Kr.|vesterlandsk tidsregning)/i},i={any:[/^f/i,/^(v|e)/i]},d={narrow:/^[1234]/i,abbreviated:/^[1234]. kvt\./i,wide:/^[1234]\.? kvartal/i},l={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[jfmasond]/i,abbreviated:/^(jan.|feb.|mar.|apr.|maj|jun.|jul.|aug.|sep.|okt.|nov.|dec.)/i,wide:/^(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/i},g={narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^j/i,/^j/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^maj/i,/^jun/i,/^jul/i,/^au/i,/^s/i,/^o/i,/^n/i,/^d/i]},c={narrow:/^[smtofl]/i,short:/^(søn.|man.|tir.|ons.|tor.|fre.|lør.)/i,abbreviated:/^(søn|man|tir|ons|tor|fre|lør)/i,wide:/^(søndag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag)/i},s={narrow:[/^s/i,/^m/i,/^t/i,/^o/i,/^t/i,/^f/i,/^l/i],any:[/^s/i,/^m/i,/^ti/i,/^o/i,/^to/i,/^f/i,/^l/i]},x={narrow:/^(a|p|midnat|middag|(om) (morgenen|eftermiddagen|aftenen|natten))/i,any:/^([ap]\.?\s?m\.?|midnat|middag|(om) (morgenen|eftermiddagen|aftenen|natten))/i},h={any:{am:/^a/i,pm:/^p/i,midnight:/midnat/i,noon:/middag/i,morning:/morgen/i,afternoon:/eftermiddag/i,evening:/aften/i,night:/nat/i}},j={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:u,valueCallback:function(p){return parseInt(p,10)}}),era:(0,a.default)({matchPatterns:m,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:l,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,a.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:g,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:x,defaultMatchWidth:"any",parsePatterns:h,defaultParseWidth:"any"})},W=j;e.default=W,n.exports=e.default})(_,_.exports);var C=_.exports;(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(L),r=t(N),o=t(S),u=t(q),m=t(C),i={code:"da",formatDistance:a.default,formatLong:r.default,formatRelative:o.default,localize:u.default,match:m.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},d=i;e.default=d,n.exports=e.default})(b,b.exports);var w=b.exports;const V=E(w),T=H({__proto__:null,default:V},[w]);export{T as i};
