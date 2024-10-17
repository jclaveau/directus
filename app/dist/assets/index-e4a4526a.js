import{g as j}from"./index.85962662.entry.js";import{i as f,b as O,a as z,c as C,d as R}from"./index-ead2b777.js";function T(o,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in o)){const i=Object.getOwnPropertyDescriptor(a,r);i&&Object.defineProperty(o,r,i.get?i:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(o,Symbol.toStringTag,{value:"Module"}))}var x={exports:{}},g={exports:{}};(function(o,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lessThanXSeconds:{one:"menos dun segundo",other:"menos de {{count}} segundos"},xSeconds:{one:"1 segundo",other:"{{count}} segundos"},halfAMinute:"medio minuto",lessThanXMinutes:{one:"menos dun minuto",other:"menos de {{count}} minutos"},xMinutes:{one:"1 minuto",other:"{{count}} minutos"},aboutXHours:{one:"arredor dunha hora",other:"arredor de {{count}} horas"},xHours:{one:"1 hora",other:"{{count}} horas"},xDays:{one:"1 día",other:"{{count}} días"},aboutXWeeks:{one:"arredor dunha semana",other:"arredor de {{count}} semanas"},xWeeks:{one:"1 semana",other:"{{count}} semanas"},aboutXMonths:{one:"arredor de 1 mes",other:"arredor de {{count}} meses"},xMonths:{one:"1 mes",other:"{{count}} meses"},aboutXYears:{one:"arredor dun ano",other:"arredor de {{count}} anos"},xYears:{one:"1 ano",other:"{{count}} anos"},overXYears:{one:"máis dun ano",other:"máis de {{count}} anos"},almostXYears:{one:"case un ano",other:"case {{count}} anos"}},a=function(u,d,n){var s,m=t[u];return typeof m=="string"?s=m:d===1?s=m.one:s=m.other.replace("{{count}}",String(d)),n!=null&&n.addSuffix?n.comparison&&n.comparison>0?"en "+s:"hai "+s:s},r=a;e.default=r,o.exports=e.default})(g,g.exports);var H=g.exports,P={exports:{}};(function(o,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(O),r={full:"EEEE, d 'de' MMMM y",long:"d 'de' MMMM y",medium:"d MMM y",short:"dd/MM/y"},i={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},u={full:"{{date}} 'ás' {{time}}",long:"{{date}} 'ás' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},d={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:i,defaultWidth:"full"}),dateTime:(0,a.default)({formats:u,defaultWidth:"full"})},n=d;e.default=n,o.exports=e.default})(P,P.exports);var F=P.exports,y={exports:{}};(function(o,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"'o' eeee 'pasado á' LT",yesterday:"'onte á' p",today:"'hoxe á' p",tomorrow:"'mañá á' p",nextWeek:"eeee 'á' p",other:"P"},a={lastWeek:"'o' eeee 'pasado ás' p",yesterday:"'onte ás' p",today:"'hoxe ás' p",tomorrow:"'mañá ás' p",nextWeek:"eeee 'ás' p",other:"P"},r=function(d,n,s,m){return n.getUTCHours()!==1?a[d]:t[d]},i=r;e.default=i,o.exports=e.default})(y,y.exports);var L=y.exports,_={exports:{}};(function(o,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(z),r={narrow:["AC","DC"],abbreviated:["AC","DC"],wide:["antes de cristo","despois de cristo"]},i={narrow:["1","2","3","4"],abbreviated:["T1","T2","T3","T4"],wide:["1º trimestre","2º trimestre","3º trimestre","4º trimestre"]},u={narrow:["e","f","m","a","m","j","j","a","s","o","n","d"],abbreviated:["xan","feb","mar","abr","mai","xun","xul","ago","set","out","nov","dec"],wide:["xaneiro","febreiro","marzo","abril","maio","xuño","xullo","agosto","setembro","outubro","novembro","decembro"]},d={narrow:["d","l","m","m","j","v","s"],short:["do","lu","ma","me","xo","ve","sa"],abbreviated:["dom","lun","mar","mer","xov","ven","sab"],wide:["domingo","luns","martes","mércores","xoves","venres","sábado"]},n={narrow:{am:"a",pm:"p",midnight:"mn",noon:"md",morning:"mañá",afternoon:"tarde",evening:"tarde",night:"noite"},abbreviated:{am:"AM",pm:"PM",midnight:"medianoite",noon:"mediodía",morning:"mañá",afternoon:"tarde",evening:"tardiña",night:"noite"},wide:{am:"a.m.",pm:"p.m.",midnight:"medianoite",noon:"mediodía",morning:"mañá",afternoon:"tarde",evening:"tardiña",night:"noite"}},s={narrow:{am:"a",pm:"p",midnight:"mn",noon:"md",morning:"da mañá",afternoon:"da tarde",evening:"da tardiña",night:"da noite"},abbreviated:{am:"AM",pm:"PM",midnight:"medianoite",noon:"mediodía",morning:"da mañá",afternoon:"da tarde",evening:"da tardiña",night:"da noite"},wide:{am:"a.m.",pm:"p.m.",midnight:"medianoite",noon:"mediodía",morning:"da mañá",afternoon:"da tarde",evening:"da tardiña",night:"da noite"}},m=function(l,M){var p=Number(l);return p+"º"},v={ordinalNumber:m,era:(0,a.default)({values:r,defaultWidth:"wide"}),quarter:(0,a.default)({values:i,defaultWidth:"wide",argumentCallback:function(l){return l-1}}),month:(0,a.default)({values:u,defaultWidth:"wide"}),day:(0,a.default)({values:d,defaultWidth:"wide"}),dayPeriod:(0,a.default)({values:n,defaultWidth:"wide",formattingValues:s,defaultFormattingWidth:"wide"})},c=v;e.default=c,o.exports=e.default})(_,_.exports);var q=_.exports,w={exports:{}};(function(o,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(C),r=t(R),i=/^(\d+)(º)?/i,u=/\d+/i,d={narrow:/^(ac|dc|a|d)/i,abbreviated:/^(a\.?\s?c\.?|a\.?\s?e\.?\s?c\.?|d\.?\s?c\.?|e\.?\s?c\.?)/i,wide:/^(antes de cristo|antes da era com[uú]n|despois de cristo|era com[uú]n)/i},n={any:[/^ac/i,/^dc/i],wide:[/^(antes de cristo|antes da era com[uú]n)/i,/^(despois de cristo|era com[uú]n)/i]},s={narrow:/^[1234]/i,abbreviated:/^T[1234]/i,wide:/^[1234](º)? trimestre/i},m={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[xfmasond]/i,abbreviated:/^(xan|feb|mar|abr|mai|xun|xul|ago|set|out|nov|dec)/i,wide:/^(xaneiro|febreiro|marzo|abril|maio|xuño|xullo|agosto|setembro|outubro|novembro|decembro)/i},c={narrow:[/^x/i,/^f/i,/^m/i,/^a/i,/^m/i,/^x/i,/^x/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^xan/i,/^feb/i,/^mar/i,/^abr/i,/^mai/i,/^xun/i,/^xul/i,/^ago/i,/^set/i,/^out/i,/^nov/i,/^dec/i]},h={narrow:/^[dlmxvs]/i,short:/^(do|lu|ma|me|xo|ve|sa)/i,abbreviated:/^(dom|lun|mar|mer|xov|ven|sab)/i,wide:/^(domingo|luns|martes|m[eé]rcores|xoves|venres|s[áa]bado)/i},l={narrow:[/^d/i,/^l/i,/^m/i,/^m/i,/^x/i,/^v/i,/^s/i],any:[/^do/i,/^lu/i,/^ma/i,/^me/i,/^xo/i,/^ve/i,/^sa/i]},M={narrow:/^(a|p|mn|md|(da|[aá]s) (mañ[aá]|tarde|noite))/i,any:/^([ap]\.?\s?m\.?|medianoite|mediod[ií]a|(da|[aá]s) (mañ[aá]|tarde|noite))/i},p={any:{am:/^a/i,pm:/^p/i,midnight:/^mn/i,noon:/^md/i,morning:/mañ[aá]/i,afternoon:/tarde/i,evening:/tardiña/i,night:/noite/i}},D={ordinalNumber:(0,r.default)({matchPattern:i,parsePattern:u,valueCallback:function(b){return parseInt(b,10)}}),era:(0,a.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:s,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"any",valueCallback:function(b){return b+1}}),month:(0,a.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:c,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:l,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:M,defaultMatchWidth:"any",parsePatterns:p,defaultParseWidth:"any"})},E=D;e.default=E,o.exports=e.default})(w,w.exports);var N=w.exports;(function(o,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(H),r=t(F),i=t(L),u=t(q),d=t(N),n={code:"gl",formatDistance:a.default,formatLong:r.default,formatRelative:i.default,localize:u.default,match:d.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},s=n;e.default=s,o.exports=e.default})(x,x.exports);var W=x.exports;const V=j(W),S=T({__proto__:null,default:V},[W]);export{S as i};
