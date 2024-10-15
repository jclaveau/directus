import{g as C}from"./index.85962662.entry.js";import{i as f,b as E,a as O,c as k,d as F}from"./index-ead2b777.js";function R(r,a){for(var t=0;t<a.length;t++){const e=a[t];if(typeof e!="string"&&!Array.isArray(e)){for(const i in e)if(i!=="default"&&!(i in r)){const o=Object.getOwnPropertyDescriptor(e,i);o&&Object.defineProperty(r,i,o.get?o:{enumerable:!0,get:()=>e[i]})}}}return Object.freeze(Object.defineProperty(r,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},g={exports:{}};(function(r,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lessThanXSeconds:{one:"mai puțin de o secundă",other:"mai puțin de {{count}} secunde"},xSeconds:{one:"1 secundă",other:"{{count}} secunde"},halfAMinute:"jumătate de minut",lessThanXMinutes:{one:"mai puțin de un minut",other:"mai puțin de {{count}} minute"},xMinutes:{one:"1 minut",other:"{{count}} minute"},aboutXHours:{one:"circa 1 oră",other:"circa {{count}} ore"},xHours:{one:"1 oră",other:"{{count}} ore"},xDays:{one:"1 zi",other:"{{count}} zile"},aboutXWeeks:{one:"circa o săptămână",other:"circa {{count}} săptămâni"},xWeeks:{one:"1 săptămână",other:"{{count}} săptămâni"},aboutXMonths:{one:"circa 1 lună",other:"circa {{count}} luni"},xMonths:{one:"1 lună",other:"{{count}} luni"},aboutXYears:{one:"circa 1 an",other:"circa {{count}} ani"},xYears:{one:"1 an",other:"{{count}} ani"},overXYears:{one:"peste 1 an",other:"peste {{count}} ani"},almostXYears:{one:"aproape 1 an",other:"aproape {{count}} ani"}},e=function(d,m,n){var u,l=t[d];return typeof l=="string"?u=l:m===1?u=l.one:u=l.other.replace("{{count}}",String(m)),n!=null&&n.addSuffix?n.comparison&&n.comparison>0?"în "+u:u+" în urmă":u},i=e;a.default=i,r.exports=a.default})(g,g.exports);var H=g.exports,y={exports:{}};(function(r,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(E),i={full:"EEEE, d MMMM yyyy",long:"d MMMM yyyy",medium:"d MMM yyyy",short:"dd.MM.yyyy"},o={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},d={full:"{{date}} 'la' {{time}}",long:"{{date}} 'la' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},m={date:(0,e.default)({formats:i,defaultWidth:"full"}),time:(0,e.default)({formats:o,defaultWidth:"full"}),dateTime:(0,e.default)({formats:d,defaultWidth:"full"})},n=m;a.default=n,r.exports=a.default})(y,y.exports);var T=y.exports,P={exports:{}};(function(r,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lastWeek:"eeee 'trecută la' p",yesterday:"'ieri la' p",today:"'astăzi la' p",tomorrow:"'mâine la' p",nextWeek:"eeee 'viitoare la' p",other:"P"},e=function(d,m,n,u){return t[d]},i=e;a.default=i,r.exports=a.default})(P,P.exports);var S=P.exports,M={exports:{}};(function(r,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(O),i={narrow:["Î","D"],abbreviated:["Î.d.C.","D.C."],wide:["Înainte de Cristos","După Cristos"]},o={narrow:["1","2","3","4"],abbreviated:["T1","T2","T3","T4"],wide:["primul trimestru","al doilea trimestru","al treilea trimestru","al patrulea trimestru"]},d={narrow:["I","F","M","A","M","I","I","A","S","O","N","D"],abbreviated:["ian","feb","mar","apr","mai","iun","iul","aug","sep","oct","noi","dec"],wide:["ianuarie","februarie","martie","aprilie","mai","iunie","iulie","august","septembrie","octombrie","noiembrie","decembrie"]},m={narrow:["d","l","m","m","j","v","s"],short:["du","lu","ma","mi","jo","vi","sâ"],abbreviated:["dum","lun","mar","mie","joi","vin","sâm"],wide:["duminică","luni","marți","miercuri","joi","vineri","sâmbătă"]},n={narrow:{am:"a",pm:"p",midnight:"mn",noon:"ami",morning:"dim",afternoon:"da",evening:"s",night:"n"},abbreviated:{am:"AM",pm:"PM",midnight:"miezul nopții",noon:"amiază",morning:"dimineață",afternoon:"după-amiază",evening:"seară",night:"noapte"},wide:{am:"a.m.",pm:"p.m.",midnight:"miezul nopții",noon:"amiază",morning:"dimineață",afternoon:"după-amiază",evening:"seară",night:"noapte"}},u={narrow:{am:"a",pm:"p",midnight:"mn",noon:"amiază",morning:"dimineață",afternoon:"după-amiază",evening:"seară",night:"noapte"},abbreviated:{am:"AM",pm:"PM",midnight:"miezul nopții",noon:"amiază",morning:"dimineață",afternoon:"după-amiază",evening:"seară",night:"noapte"},wide:{am:"a.m.",pm:"p.m.",midnight:"miezul nopții",noon:"amiază",morning:"dimineață",afternoon:"după-amiază",evening:"seară",night:"noapte"}},l=function(s,x){return String(s)},c={ordinalNumber:l,era:(0,e.default)({values:i,defaultWidth:"wide"}),quarter:(0,e.default)({values:o,defaultWidth:"wide",argumentCallback:function(s){return s-1}}),month:(0,e.default)({values:d,defaultWidth:"wide"}),day:(0,e.default)({values:m,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:n,defaultWidth:"wide",formattingValues:u,defaultFormattingWidth:"wide"})},p=c;a.default=p,r.exports=a.default})(M,M.exports);var q=M.exports,_={exports:{}};(function(r,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(k),i=t(F),o=/^(\d+)?/i,d=/\d+/i,m={narrow:/^(Î|D)/i,abbreviated:/^(Î\.?\s?d\.?\s?C\.?|Î\.?\s?e\.?\s?n\.?|D\.?\s?C\.?|e\.?\s?n\.?)/i,wide:/^(Înainte de Cristos|Înaintea erei noastre|După Cristos|Era noastră)/i},n={any:[/^ÎC/i,/^DC/i],wide:[/^(Înainte de Cristos|Înaintea erei noastre)/i,/^(După Cristos|Era noastră)/i]},u={narrow:/^[1234]/i,abbreviated:/^T[1234]/i,wide:/^trimestrul [1234]/i},l={any:[/1/i,/2/i,/3/i,/4/i]},c={narrow:/^[ifmaasond]/i,abbreviated:/^(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|noi|dec)/i,wide:/^(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/i},p={narrow:[/^i/i,/^f/i,/^m/i,/^a/i,/^m/i,/^i/i,/^i/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ia/i,/^f/i,/^mar/i,/^ap/i,/^mai/i,/^iun/i,/^iul/i,/^au/i,/^s/i,/^o/i,/^n/i,/^d/i]},v={narrow:/^[dlmjvs]/i,short:/^(d|l|ma|mi|j|v|s)/i,abbreviated:/^(dum|lun|mar|mie|jo|vi|sâ)/i,wide:/^(duminica|luni|marţi|miercuri|joi|vineri|sâmbătă)/i},s={narrow:[/^d/i,/^l/i,/^m/i,/^m/i,/^j/i,/^v/i,/^s/i],any:[/^d/i,/^l/i,/^ma/i,/^mi/i,/^j/i,/^v/i,/^s/i]},x={narrow:/^(a|p|mn|a|(dimineaţa|după-amiaza|seara|noaptea))/i,any:/^([ap]\.?\s?m\.?|miezul nopții|amiaza|(dimineaţa|după-amiaza|seara|noaptea))/i},z={any:{am:/^a/i,pm:/^p/i,midnight:/^mn/i,noon:/amiaza/i,morning:/dimineaţa/i,afternoon:/după-amiaza/i,evening:/seara/i,night:/noaptea/i}},D={ordinalNumber:(0,i.default)({matchPattern:o,parsePattern:d,valueCallback:function(h){return parseInt(h,10)}}),era:(0,e.default)({matchPatterns:m,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:u,defaultMatchWidth:"wide",parsePatterns:l,defaultParseWidth:"any",valueCallback:function(h){return h+1}}),month:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:p,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:x,defaultMatchWidth:"any",parsePatterns:z,defaultParseWidth:"any"})},W=D;a.default=W,r.exports=a.default})(_,_.exports);var L=_.exports;(function(r,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(H),i=t(T),o=t(S),d=t(q),m=t(L),n={code:"ro",formatDistance:e.default,formatLong:i.default,formatRelative:o.default,localize:d.default,match:m.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},u=n;a.default=u,r.exports=a.default})(b,b.exports);var w=b.exports;const N=C(w),A=R({__proto__:null,default:N},[w]);export{A as i};
