import{g as S}from"./index.85962662.entry.js";import{i as c,b as O,a as E,c as z,d as F}from"./index-ead2b777.js";import{i as C}from"./index-60ea3339.js";function V(u,a){for(var e=0;e<a.length;e++){const t=a[e];if(typeof t!="string"&&!Array.isArray(t)){for(const d in t)if(d!=="default"&&!(d in u)){const o=Object.getOwnPropertyDescriptor(t,d);o&&Object.defineProperty(u,d,o.get?o:{enumerable:!0,get:()=>t[d]})}}}return Object.freeze(Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}))}var P={exports:{}},w={exports:{}};(function(u,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;function e(n){return function(s,r){if(s===1)return r!=null&&r.addSuffix?n.one[0].replace("{{time}}",n.one[2]):n.one[0].replace("{{time}}",n.one[1]);var i=s%10===1&&s%100!==11;return r!=null&&r.addSuffix?n.other[0].replace("{{time}}",i?n.other[3]:n.other[4]).replace("{{count}}",String(s)):n.other[0].replace("{{time}}",i?n.other[1]:n.other[2]).replace("{{count}}",String(s))}}var t={lessThanXSeconds:e({one:["mazāk par {{time}}","sekundi","sekundi"],other:["mazāk nekā {{count}} {{time}}","sekunde","sekundes","sekundes","sekundēm"]}),xSeconds:e({one:["1 {{time}}","sekunde","sekundes"],other:["{{count}} {{time}}","sekunde","sekundes","sekundes","sekundēm"]}),halfAMinute:function(s,r){return r!=null&&r.addSuffix?"pusminūtes":"pusminūte"},lessThanXMinutes:e({one:["mazāk par {{time}}","minūti","minūti"],other:["mazāk nekā {{count}} {{time}}","minūte","minūtes","minūtes","minūtēm"]}),xMinutes:e({one:["1 {{time}}","minūte","minūtes"],other:["{{count}} {{time}}","minūte","minūtes","minūtes","minūtēm"]}),aboutXHours:e({one:["apmēram 1 {{time}}","stunda","stundas"],other:["apmēram {{count}} {{time}}","stunda","stundas","stundas","stundām"]}),xHours:e({one:["1 {{time}}","stunda","stundas"],other:["{{count}} {{time}}","stunda","stundas","stundas","stundām"]}),xDays:e({one:["1 {{time}}","diena","dienas"],other:["{{count}} {{time}}","diena","dienas","dienas","dienām"]}),aboutXWeeks:e({one:["apmēram 1 {{time}}","nedēļa","nedēļas"],other:["apmēram {{count}} {{time}}","nedēļa","nedēļu","nedēļas","nedēļām"]}),xWeeks:e({one:["1 {{time}}","nedēļa","nedēļas"],other:["{{count}} {{time}}","nedēļa","nedēļu","nedēļas","nedēļām"]}),aboutXMonths:e({one:["apmēram 1 {{time}}","mēnesis","mēneša"],other:["apmēram {{count}} {{time}}","mēnesis","mēneši","mēneša","mēnešiem"]}),xMonths:e({one:["1 {{time}}","mēnesis","mēneša"],other:["{{count}} {{time}}","mēnesis","mēneši","mēneša","mēnešiem"]}),aboutXYears:e({one:["apmēram 1 {{time}}","gads","gada"],other:["apmēram {{count}} {{time}}","gads","gadi","gada","gadiem"]}),xYears:e({one:["1 {{time}}","gads","gada"],other:["{{count}} {{time}}","gads","gadi","gada","gadiem"]}),overXYears:e({one:["ilgāk par 1 {{time}}","gadu","gadu"],other:["vairāk nekā {{count}} {{time}}","gads","gadi","gada","gadiem"]}),almostXYears:e({one:["gandrīz 1 {{time}}","gads","gada"],other:["vairāk nekā {{count}} {{time}}","gads","gadi","gada","gadiem"]})},d=function(s,r,i){var m=t[s](r,i);return i!=null&&i.addSuffix?i.comparison&&i.comparison>0?"pēc "+m:"pirms "+m:m},o=d;a.default=o,u.exports=a.default})(w,w.exports);var R=w.exports,y={exports:{}};(function(u,a){var e=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t=e(O),d={full:"EEEE, y. 'gada' d. MMMM",long:"y. 'gada' d. MMMM",medium:"dd.MM.y.",short:"dd.MM.y."},o={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},n={full:"{{date}} 'plkst.' {{time}}",long:"{{date}} 'plkst.' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},s={date:(0,t.default)({formats:d,defaultWidth:"full"}),time:(0,t.default)({formats:o,defaultWidth:"full"}),dateTime:(0,t.default)({formats:n,defaultWidth:"full"})},r=s;a.default=r,u.exports=a.default})(y,y.exports);var T=y.exports,x={exports:{}};(function(u,a){var e=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t=e(C),d=["svētdienā","pirmdienā","otrdienā","trešdienā","ceturtdienā","piektdienā","sestdienā"],o={lastWeek:function(i,m,l){if((0,t.default)(i,m,l))return"eeee 'plkst.' p";var f=d[i.getUTCDay()];return"'Pagājušā "+f+" plkst.' p"},yesterday:"'Vakar plkst.' p",today:"'Šodien plkst.' p",tomorrow:"'Rīt plkst.' p",nextWeek:function(i,m,l){if((0,t.default)(i,m,l))return"eeee 'plkst.' p";var f=d[i.getUTCDay()];return"'Nākamajā "+f+" plkst.' p"},other:"P"},n=function(i,m,l,f){var p=o[i];return typeof p=="function"?p(m,l,f):p},s=n;a.default=s,u.exports=a.default})(x,x.exports);var N=x.exports,_={exports:{}};(function(u,a){var e=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t=e(E),d={narrow:["p.m.ē","m.ē"],abbreviated:["p. m. ē.","m. ē."],wide:["pirms mūsu ēras","mūsu ērā"]},o={narrow:["1","2","3","4"],abbreviated:["1. cet.","2. cet.","3. cet.","4. cet."],wide:["pirmais ceturksnis","otrais ceturksnis","trešais ceturksnis","ceturtais ceturksnis"]},n={narrow:["1","2","3","4"],abbreviated:["1. cet.","2. cet.","3. cet.","4. cet."],wide:["pirmajā ceturksnī","otrajā ceturksnī","trešajā ceturksnī","ceturtajā ceturksnī"]},s={narrow:["J","F","M","A","M","J","J","A","S","O","N","D"],abbreviated:["janv.","febr.","marts","apr.","maijs","jūn.","jūl.","aug.","sept.","okt.","nov.","dec."],wide:["janvāris","februāris","marts","aprīlis","maijs","jūnijs","jūlijs","augusts","septembris","oktobris","novembris","decembris"]},r={narrow:["J","F","M","A","M","J","J","A","S","O","N","D"],abbreviated:["janv.","febr.","martā","apr.","maijs","jūn.","jūl.","aug.","sept.","okt.","nov.","dec."],wide:["janvārī","februārī","martā","aprīlī","maijā","jūnijā","jūlijā","augustā","septembrī","oktobrī","novembrī","decembrī"]},i={narrow:["S","P","O","T","C","P","S"],short:["Sv","P","O","T","C","Pk","S"],abbreviated:["svētd.","pirmd.","otrd.","trešd.","ceturtd.","piektd.","sestd."],wide:["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"]},m={narrow:["S","P","O","T","C","P","S"],short:["Sv","P","O","T","C","Pk","S"],abbreviated:["svētd.","pirmd.","otrd.","trešd.","ceturtd.","piektd.","sestd."],wide:["svētdienā","pirmdienā","otrdienā","trešdienā","ceturtdienā","piektdienā","sestdienā"]},l={narrow:{am:"am",pm:"pm",midnight:"pusn.",noon:"pusd.",morning:"rīts",afternoon:"diena",evening:"vakars",night:"nakts"},abbreviated:{am:"am",pm:"pm",midnight:"pusn.",noon:"pusd.",morning:"rīts",afternoon:"pēcpusd.",evening:"vakars",night:"nakts"},wide:{am:"am",pm:"pm",midnight:"pusnakts",noon:"pusdienlaiks",morning:"rīts",afternoon:"pēcpusdiena",evening:"vakars",night:"nakts"}},f={narrow:{am:"am",pm:"pm",midnight:"pusn.",noon:"pusd.",morning:"rītā",afternoon:"dienā",evening:"vakarā",night:"naktī"},abbreviated:{am:"am",pm:"pm",midnight:"pusn.",noon:"pusd.",morning:"rītā",afternoon:"pēcpusd.",evening:"vakarā",night:"naktī"},wide:{am:"am",pm:"pm",midnight:"pusnaktī",noon:"pusdienlaikā",morning:"rītā",afternoon:"pēcpusdienā",evening:"vakarā",night:"naktī"}},p=function(v,W){var b=Number(v);return b+"."},k={ordinalNumber:p,era:(0,t.default)({values:d,defaultWidth:"wide"}),quarter:(0,t.default)({values:o,defaultWidth:"wide",formattingValues:n,defaultFormattingWidth:"wide",argumentCallback:function(v){return v-1}}),month:(0,t.default)({values:s,defaultWidth:"wide",formattingValues:r,defaultFormattingWidth:"wide"}),day:(0,t.default)({values:i,defaultWidth:"wide",formattingValues:m,defaultFormattingWidth:"wide"}),dayPeriod:(0,t.default)({values:l,defaultWidth:"wide",formattingValues:f,defaultFormattingWidth:"wide"})},g=k;a.default=g,u.exports=a.default})(_,_.exports);var H=_.exports,M={exports:{}};(function(u,a){var e=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t=e(z),d=e(F),o=/^(\d+)\./i,n=/\d+/i,s={narrow:/^(p\.m\.ē|m\.ē)/i,abbreviated:/^(p\. m\. ē\.|m\. ē\.)/i,wide:/^(pirms mūsu ēras|mūsu ērā)/i},r={any:[/^p/i,/^m/i]},i={narrow:/^[1234]/i,abbreviated:/^[1234](\. cet\.)/i,wide:/^(pirma(is|jā)|otra(is|jā)|treša(is|jā)|ceturta(is|jā)) ceturksn(is|ī)/i},m={narrow:[/^1/i,/^2/i,/^3/i,/^4/i],abbreviated:[/^1/i,/^2/i,/^3/i,/^4/i],wide:[/^p/i,/^o/i,/^t/i,/^c/i]},l={narrow:/^[jfmasond]/i,abbreviated:/^(janv\.|febr\.|marts|apr\.|maijs|jūn\.|jūl\.|aug\.|sept\.|okt\.|nov\.|dec\.)/i,wide:/^(janvār(is|ī)|februār(is|ī)|mart[sā]|aprīl(is|ī)|maij[sā]|jūnij[sā]|jūlij[sā]|august[sā]|septembr(is|ī)|oktobr(is|ī)|novembr(is|ī)|decembr(is|ī))/i},f={narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^j/i,/^j/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^mai/i,/^jūn/i,/^jūl/i,/^au/i,/^s/i,/^o/i,/^n/i,/^d/i]},p={narrow:/^[spotc]/i,short:/^(sv|pi|o|t|c|pk|s)/i,abbreviated:/^(svētd\.|pirmd\.|otrd.\|trešd\.|ceturtd\.|piektd\.|sestd\.)/i,wide:/^(svētdien(a|ā)|pirmdien(a|ā)|otrdien(a|ā)|trešdien(a|ā)|ceturtdien(a|ā)|piektdien(a|ā)|sestdien(a|ā))/i},k={narrow:[/^s/i,/^p/i,/^o/i,/^t/i,/^c/i,/^p/i,/^s/i],any:[/^sv/i,/^pi/i,/^o/i,/^t/i,/^c/i,/^p/i,/^se/i]},g={narrow:/^(am|pm|pusn\.|pusd\.|rīt(s|ā)|dien(a|ā)|vakar(s|ā)|nakt(s|ī))/,abbreviated:/^(am|pm|pusn\.|pusd\.|rīt(s|ā)|pēcpusd\.|vakar(s|ā)|nakt(s|ī))/,wide:/^(am|pm|pusnakt(s|ī)|pusdienlaik(s|ā)|rīt(s|ā)|pēcpusdien(a|ā)|vakar(s|ā)|nakt(s|ī))/i},h={any:{am:/^am/i,pm:/^pm/i,midnight:/^pusn/i,noon:/^pusd/i,morning:/^r/i,afternoon:/^(d|pēc)/i,evening:/^v/i,night:/^n/i}},v={ordinalNumber:(0,d.default)({matchPattern:o,parsePattern:n,valueCallback:function(j){return parseInt(j,10)}}),era:(0,t.default)({matchPatterns:s,defaultMatchWidth:"wide",parsePatterns:r,defaultParseWidth:"any"}),quarter:(0,t.default)({matchPatterns:i,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"wide",valueCallback:function(j){return j+1}}),month:(0,t.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),day:(0,t.default)({matchPatterns:p,defaultMatchWidth:"wide",parsePatterns:k,defaultParseWidth:"any"}),dayPeriod:(0,t.default)({matchPatterns:g,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any"})},W=v;a.default=W,u.exports=a.default})(M,M.exports);var q=M.exports;(function(u,a){var e=c.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var t=e(R),d=e(T),o=e(N),n=e(H),s=e(q),r={code:"lv",formatDistance:t.default,formatLong:d.default,formatRelative:o.default,localize:n.default,match:s.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},i=r;a.default=i,u.exports=a.default})(P,P.exports);var D=P.exports;const L=S(D),Y=V({__proto__:null,default:L},[D]);export{Y as i};
