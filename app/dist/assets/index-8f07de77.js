import{g as D}from"./index.85962662.entry.js";import{i as f,b as S,a as O,c as C,d as H}from"./index-ead2b777.js";function N(n,a){for(var t=0;t<a.length;t++){const e=a[t];if(typeof e!="string"&&!Array.isArray(e)){for(const r in e)if(r!=="default"&&!(r in n)){const o=Object.getOwnPropertyDescriptor(e,r);o&&Object.defineProperty(n,r,o.get?o:{enumerable:!0,get:()=>e[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var k={exports:{}},b={exports:{}};(function(n,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lessThanXSeconds:{one:"bir saniyeden az",other:"{{count}} saniyeden az"},xSeconds:{one:"1 saniye",other:"{{count}} saniye"},halfAMinute:"yarım dakika",lessThanXMinutes:{one:"bir dakikadan az",other:"{{count}} dakikadan az"},xMinutes:{one:"1 dakika",other:"{{count}} dakika"},aboutXHours:{one:"yaklaşık 1 saat",other:"yaklaşık {{count}} saat"},xHours:{one:"1 saat",other:"{{count}} saat"},xDays:{one:"1 gün",other:"{{count}} gün"},aboutXWeeks:{one:"yaklaşık 1 hafta",other:"yaklaşık {{count}} hafta"},xWeeks:{one:"1 hafta",other:"{{count}} hafta"},aboutXMonths:{one:"yaklaşık 1 ay",other:"yaklaşık {{count}} ay"},xMonths:{one:"1 ay",other:"{{count}} ay"},aboutXYears:{one:"yaklaşık 1 yıl",other:"yaklaşık {{count}} yıl"},xYears:{one:"1 yıl",other:"{{count}} yıl"},overXYears:{one:"1 yıldan fazla",other:"{{count}} yıldan fazla"},almostXYears:{one:"neredeyse 1 yıl",other:"neredeyse {{count}} yıl"}},e=function(s,d,i){var l,u=t[s];return typeof u=="string"?l=u:d===1?l=u.one:l=u.other.replace("{{count}}",d.toString()),i!=null&&i.addSuffix?i.comparison&&i.comparison>0?l+" sonra":l+" önce":l},r=e;a.default=r,n.exports=a.default})(b,b.exports);var j=b.exports,g={exports:{}};(function(n,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(S),r={full:"d MMMM y EEEE",long:"d MMMM y",medium:"d MMM y",short:"dd.MM.yyyy"},o={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},s={full:"{{date}} 'saat' {{time}}",long:"{{date}} 'saat' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},d={date:(0,e.default)({formats:r,defaultWidth:"full"}),time:(0,e.default)({formats:o,defaultWidth:"full"}),dateTime:(0,e.default)({formats:s,defaultWidth:"full"})},i=d;a.default=i,n.exports=a.default})(g,g.exports);var R=g.exports,P={exports:{}};(function(n,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t={lastWeek:"'geçen hafta' eeee 'saat' p",yesterday:"'dün saat' p",today:"'bugün saat' p",tomorrow:"'yarın saat' p",nextWeek:"eeee 'saat' p",other:"P"},e=function(s,d,i,l){return t[s]},r=e;a.default=r,n.exports=a.default})(P,P.exports);var F=P.exports,M={exports:{}};(function(n,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(O),r={narrow:["MÖ","MS"],abbreviated:["MÖ","MS"],wide:["Milattan Önce","Milattan Sonra"]},o={narrow:["1","2","3","4"],abbreviated:["1Ç","2Ç","3Ç","4Ç"],wide:["İlk çeyrek","İkinci Çeyrek","Üçüncü çeyrek","Son çeyrek"]},s={narrow:["O","Ş","M","N","M","H","T","A","E","E","K","A"],abbreviated:["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],wide:["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"]},d={narrow:["P","P","S","Ç","P","C","C"],short:["Pz","Pt","Sa","Ça","Pe","Cu","Ct"],abbreviated:["Paz","Pzt","Sal","Çar","Per","Cum","Cts"],wide:["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"]},i={narrow:{am:"öö",pm:"ös",midnight:"gy",noon:"ö",morning:"sa",afternoon:"ös",evening:"ak",night:"ge"},abbreviated:{am:"ÖÖ",pm:"ÖS",midnight:"gece yarısı",noon:"öğle",morning:"sabah",afternoon:"öğleden sonra",evening:"akşam",night:"gece"},wide:{am:"Ö.Ö.",pm:"Ö.S.",midnight:"gece yarısı",noon:"öğle",morning:"sabah",afternoon:"öğleden sonra",evening:"akşam",night:"gece"}},l={narrow:{am:"öö",pm:"ös",midnight:"gy",noon:"ö",morning:"sa",afternoon:"ös",evening:"ak",night:"ge"},abbreviated:{am:"ÖÖ",pm:"ÖS",midnight:"gece yarısı",noon:"öğlen",morning:"sabahleyin",afternoon:"öğleden sonra",evening:"akşamleyin",night:"geceleyin"},wide:{am:"ö.ö.",pm:"ö.s.",midnight:"gece yarısı",noon:"öğlen",morning:"sabahleyin",afternoon:"öğleden sonra",evening:"akşamleyin",night:"geceleyin"}},u=function(m,x){var h=Number(m);return h+"."},c={ordinalNumber:u,era:(0,e.default)({values:r,defaultWidth:"wide"}),quarter:(0,e.default)({values:o,defaultWidth:"wide",argumentCallback:function(m){return Number(m)-1}}),month:(0,e.default)({values:s,defaultWidth:"wide"}),day:(0,e.default)({values:d,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:i,defaultWidth:"wide",formattingValues:l,defaultFormattingWidth:"wide"})},v=c;a.default=v,n.exports=a.default})(M,M.exports);var A=M.exports,_={exports:{}};(function(n,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(C),r=t(H),o=/^(\d+)(\.)?/i,s=/\d+/i,d={narrow:/^(mö|ms)/i,abbreviated:/^(mö|ms)/i,wide:/^(milattan önce|milattan sonra)/i},i={any:[/(^mö|^milattan önce)/i,/(^ms|^milattan sonra)/i]},l={narrow:/^[1234]/i,abbreviated:/^[1234]ç/i,wide:/^((i|İ)lk|(i|İ)kinci|üçüncü|son) çeyrek/i},u={any:[/1/i,/2/i,/3/i,/4/i],abbreviated:[/1ç/i,/2ç/i,/3ç/i,/4ç/i],wide:[/^(i|İ)lk çeyrek/i,/(i|İ)kinci çeyrek/i,/üçüncü çeyrek/i,/son çeyrek/i]},c={narrow:/^[oşmnhtaek]/i,abbreviated:/^(oca|şub|mar|nis|may|haz|tem|ağu|eyl|eki|kas|ara)/i,wide:/^(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/i},v={narrow:[/^o/i,/^ş/i,/^m/i,/^n/i,/^m/i,/^h/i,/^t/i,/^a/i,/^e/i,/^e/i,/^k/i,/^a/i],any:[/^o/i,/^ş/i,/^mar/i,/^n/i,/^may/i,/^h/i,/^t/i,/^ağ/i,/^ey/i,/^ek/i,/^k/i,/^ar/i]},y={narrow:/^[psçc]/i,short:/^(pz|pt|sa|ça|pe|cu|ct)/i,abbreviated:/^(paz|pzt|sal|çar|per|cum|cts)/i,wide:/^(pazar(?!tesi)|pazartesi|salı|çarşamba|perşembe|cuma(?!rtesi)|cumartesi)/i},m={narrow:[/^p/i,/^p/i,/^s/i,/^ç/i,/^p/i,/^c/i,/^c/i],any:[/^pz/i,/^pt/i,/^sa/i,/^ça/i,/^pe/i,/^cu/i,/^ct/i],wide:[/^pazar(?!tesi)/i,/^pazartesi/i,/^salı/i,/^çarşamba/i,/^perşembe/i,/^cuma(?!rtesi)/i,/^cumartesi/i]},x={narrow:/^(öö|ös|gy|ö|sa|ös|ak|ge)/i,any:/^(ö\.?\s?[ös]\.?|öğleden sonra|gece yarısı|öğle|(sabah|öğ|akşam|gece)(leyin))/i},h={any:{am:/^ö\.?ö\.?/i,pm:/^ö\.?s\.?/i,midnight:/^(gy|gece yarısı)/i,noon:/^öğ/i,morning:/^sa/i,afternoon:/^öğleden sonra/i,evening:/^ak/i,night:/^ge/i}},z={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:s,valueCallback:function(p){return parseInt(p,10)}}),era:(0,e.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:u,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:v,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:y,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:x,defaultMatchWidth:"any",parsePatterns:h,defaultParseWidth:"any"})},E=z;a.default=E,n.exports=a.default})(_,_.exports);var q=_.exports;(function(n,a){var t=f.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=t(j),r=t(R),o=t(F),s=t(A),d=t(q),i={code:"tr",formatDistance:e.default,formatLong:r.default,formatRelative:o.default,localize:s.default,match:d.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},l=i;a.default=l,n.exports=a.default})(k,k.exports);var w=k.exports;const L=D(w),X=N({__proto__:null,default:L},[w]);export{X as i};
