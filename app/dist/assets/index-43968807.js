import{g as D}from"./index.64088c7b.entry.js";import{i as y,b as E,a as H,c as O,d as z}from"./index-ead2b777.js";function F(n,a){for(var t=0;t<a.length;t++){const e=a[t];if(typeof e!="string"&&!Array.isArray(e)){for(const u in e)if(u!=="default"&&!(u in n)){const o=Object.getOwnPropertyDescriptor(e,u);o&&Object.defineProperty(n,u,o.get?o:{enumerable:!0,get:()=>e[u]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var P={exports:{}},g={exports:{}};(function(n,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;function t(i){return i.replace(/sekuntia?/,"sekunnin")}function e(i){return i.replace(/minuuttia?/,"minuutin")}function u(i){return i.replace(/tuntia?/,"tunnin")}function o(i){return i.replace(/päivää?/,"päivän")}function l(i){return i.replace(/(viikko|viikkoa)/,"viikon")}function s(i){return i.replace(/(kuukausi|kuukautta)/,"kuukauden")}function r(i){return i.replace(/(vuosi|vuotta)/,"vuoden")}var f={lessThanXSeconds:{one:"alle sekunti",other:"alle {{count}} sekuntia",futureTense:t},xSeconds:{one:"sekunti",other:"{{count}} sekuntia",futureTense:t},halfAMinute:{one:"puoli minuuttia",other:"puoli minuuttia",futureTense:function(m){return"puolen minuutin"}},lessThanXMinutes:{one:"alle minuutti",other:"alle {{count}} minuuttia",futureTense:e},xMinutes:{one:"minuutti",other:"{{count}} minuuttia",futureTense:e},aboutXHours:{one:"noin tunti",other:"noin {{count}} tuntia",futureTense:u},xHours:{one:"tunti",other:"{{count}} tuntia",futureTense:u},xDays:{one:"päivä",other:"{{count}} päivää",futureTense:o},aboutXWeeks:{one:"noin viikko",other:"noin {{count}} viikkoa",futureTense:l},xWeeks:{one:"viikko",other:"{{count}} viikkoa",futureTense:l},aboutXMonths:{one:"noin kuukausi",other:"noin {{count}} kuukautta",futureTense:s},xMonths:{one:"kuukausi",other:"{{count}} kuukautta",futureTense:s},aboutXYears:{one:"noin vuosi",other:"noin {{count}} vuotta",futureTense:r},xYears:{one:"vuosi",other:"{{count}} vuotta",futureTense:r},overXYears:{one:"yli vuosi",other:"yli {{count}} vuotta",futureTense:r},almostXYears:{one:"lähes vuosi",other:"lähes {{count}} vuotta",futureTense:r}},p=function(m,v,d){var h=f[m],k=v===1?h.one:h.other.replace("{{count}}",String(v));return d!=null&&d.addSuffix?d.comparison&&d.comparison>0?h.futureTense(k)+" kuluttua":k+" sitten":k},c=p;a.default=c,n.exports=a.default})(g,g.exports);var R=g.exports,w={exports:{}};(function(n,a){var t=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(E),u={full:"eeee d. MMMM y",long:"d. MMMM y",medium:"d. MMM y",short:"d.M.y"},o={full:"HH.mm.ss zzzz",long:"HH.mm.ss z",medium:"HH.mm.ss",short:"HH.mm"},l={full:"{{date}} 'klo' {{time}}",long:"{{date}} 'klo' {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},s={date:(0,e.default)({formats:u,defaultWidth:"full"}),time:(0,e.default)({formats:o,defaultWidth:"full"}),dateTime:(0,e.default)({formats:l,defaultWidth:"full"})},r=s;a.default=r,n.exports=a.default})(w,w.exports);var L=w.exports,_={exports:{}};(function(n,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lastWeek:"'viime' eeee 'klo' p",yesterday:"'eilen klo' p",today:"'tänään klo' p",tomorrow:"'huomenna klo' p",nextWeek:"'ensi' eeee 'klo' p",other:"P"},e=function(l,s,r,f){return t[l]},u=e;a.default=u,n.exports=a.default})(_,_.exports);var S=_.exports,x={exports:{}};(function(n,a){var t=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(H),u={narrow:["eaa.","jaa."],abbreviated:["eaa.","jaa."],wide:["ennen ajanlaskun alkua","jälkeen ajanlaskun alun"]},o={narrow:["1","2","3","4"],abbreviated:["Q1","Q2","Q3","Q4"],wide:["1. kvartaali","2. kvartaali","3. kvartaali","4. kvartaali"]},l={narrow:["T","H","M","H","T","K","H","E","S","L","M","J"],abbreviated:["tammi","helmi","maalis","huhti","touko","kesä","heinä","elo","syys","loka","marras","joulu"],wide:["tammikuu","helmikuu","maaliskuu","huhtikuu","toukokuu","kesäkuu","heinäkuu","elokuu","syyskuu","lokakuu","marraskuu","joulukuu"]},s={narrow:l.narrow,abbreviated:l.abbreviated,wide:["tammikuuta","helmikuuta","maaliskuuta","huhtikuuta","toukokuuta","kesäkuuta","heinäkuuta","elokuuta","syyskuuta","lokakuuta","marraskuuta","joulukuuta"]},r={narrow:["S","M","T","K","T","P","L"],short:["su","ma","ti","ke","to","pe","la"],abbreviated:["sunn.","maan.","tiis.","kesk.","torst.","perj.","la"],wide:["sunnuntai","maanantai","tiistai","keskiviikko","torstai","perjantai","lauantai"]},f={narrow:r.narrow,short:r.short,abbreviated:r.abbreviated,wide:["sunnuntaina","maanantaina","tiistaina","keskiviikkona","torstaina","perjantaina","lauantaina"]},p={narrow:{am:"ap",pm:"ip",midnight:"keskiyö",noon:"keskipäivä",morning:"ap",afternoon:"ip",evening:"illalla",night:"yöllä"},abbreviated:{am:"ap",pm:"ip",midnight:"keskiyö",noon:"keskipäivä",morning:"ap",afternoon:"ip",evening:"illalla",night:"yöllä"},wide:{am:"ap",pm:"ip",midnight:"keskiyöllä",noon:"keskipäivällä",morning:"aamupäivällä",afternoon:"iltapäivällä",evening:"illalla",night:"yöllä"}},c=function(d,h){var k=Number(d);return k+"."},i={ordinalNumber:c,era:(0,e.default)({values:u,defaultWidth:"wide"}),quarter:(0,e.default)({values:o,defaultWidth:"wide",argumentCallback:function(d){return d-1}}),month:(0,e.default)({values:l,defaultWidth:"wide",formattingValues:s,defaultFormattingWidth:"wide"}),day:(0,e.default)({values:r,defaultWidth:"wide",formattingValues:f,defaultFormattingWidth:"wide"}),dayPeriod:(0,e.default)({values:p,defaultWidth:"wide"})},m=i;a.default=m,n.exports=a.default})(x,x.exports);var V=x.exports,M={exports:{}};(function(n,a){var t=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(O),u=t(z),o=/^(\d+)(\.)/i,l=/\d+/i,s={narrow:/^(e|j)/i,abbreviated:/^(eaa.|jaa.)/i,wide:/^(ennen ajanlaskun alkua|jälkeen ajanlaskun alun)/i},r={any:[/^e/i,/^j/i]},f={narrow:/^[1234]/i,abbreviated:/^q[1234]/i,wide:/^[1234]\.? kvartaali/i},p={any:[/1/i,/2/i,/3/i,/4/i]},c={narrow:/^[thmkeslj]/i,abbreviated:/^(tammi|helmi|maalis|huhti|touko|kesä|heinä|elo|syys|loka|marras|joulu)/i,wide:/^(tammikuu|helmikuu|maaliskuu|huhtikuu|toukokuu|kesäkuu|heinäkuu|elokuu|syyskuu|lokakuu|marraskuu|joulukuu)(ta)?/i},i={narrow:[/^t/i,/^h/i,/^m/i,/^h/i,/^t/i,/^k/i,/^h/i,/^e/i,/^s/i,/^l/i,/^m/i,/^j/i],any:[/^ta/i,/^hel/i,/^maa/i,/^hu/i,/^to/i,/^k/i,/^hei/i,/^e/i,/^s/i,/^l/i,/^mar/i,/^j/i]},m={narrow:/^[smtkpl]/i,short:/^(su|ma|ti|ke|to|pe|la)/i,abbreviated:/^(sunn.|maan.|tiis.|kesk.|torst.|perj.|la)/i,wide:/^(sunnuntai|maanantai|tiistai|keskiviikko|torstai|perjantai|lauantai)(na)?/i},v={narrow:[/^s/i,/^m/i,/^t/i,/^k/i,/^t/i,/^p/i,/^l/i],any:[/^s/i,/^m/i,/^ti/i,/^k/i,/^to/i,/^p/i,/^l/i]},d={narrow:/^(ap|ip|keskiyö|keskipäivä|aamupäivällä|iltapäivällä|illalla|yöllä)/i,any:/^(ap|ip|keskiyöllä|keskipäivällä|aamupäivällä|iltapäivällä|illalla|yöllä)/i},h={any:{am:/^ap/i,pm:/^ip/i,midnight:/^keskiyö/i,noon:/^keskipäivä/i,morning:/aamupäivällä/i,afternoon:/iltapäivällä/i,evening:/illalla/i,night:/yöllä/i}},k={ordinalNumber:(0,u.default)({matchPattern:o,parsePattern:l,valueCallback:function(b){return parseInt(b,10)}}),era:(0,e.default)({matchPatterns:s,defaultMatchWidth:"wide",parsePatterns:r,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:f,defaultMatchWidth:"wide",parsePatterns:p,defaultParseWidth:"any",valueCallback:function(b){return b+1}}),month:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:m,defaultMatchWidth:"wide",parsePatterns:v,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:d,defaultMatchWidth:"any",parsePatterns:h,defaultParseWidth:"any"})},T=k;a.default=T,n.exports=a.default})(M,M.exports);var q=M.exports;(function(n,a){var t=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(R),u=t(L),o=t(S),l=t(V),s=t(q),r={code:"fi",formatDistance:e.default,formatLong:u.default,formatRelative:o.default,localize:l.default,match:s.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},f=r;a.default=f,n.exports=a.default})(P,P.exports);var j=P.exports;const C=D(j),Q=F({__proto__:null,default:C},[j]);export{Q as i};
