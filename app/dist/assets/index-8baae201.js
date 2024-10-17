import{g as D}from"./index.85962662.entry.js";import{i as y,b as E,a as F,c as O,d as z}from"./index-ead2b777.js";import{d as R}from"./index-1f0f3814.js";import{i as S}from"./index-60ea3339.js";function j(d,a){for(var r=0;r<a.length;r++){const e=a[r];if(typeof e!="string"&&!Array.isArray(e)){for(const o in e)if(o!=="default"&&!(o in d)){const l=Object.getOwnPropertyDescriptor(e,o);l&&Object.defineProperty(d,o,l.get?l:{enumerable:!0,get:()=>e[o]})}}}return Object.freeze(Object.defineProperty(d,Symbol.toStringTag,{value:"Module"}))}var P={exports:{}},w={exports:{}};(function(d,a){Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;function r(t,i){if(t.one!==void 0&&i===1)return t.one;var n=i%10,c=i%100;return n===1&&c!==11?t.singularNominative.replace("{{count}}",String(i)):n>=2&&n<=4&&(c<10||c>20)?t.singularGenitive.replace("{{count}}",String(i)):t.pluralGenitive.replace("{{count}}",String(i))}function e(t){return function(i,n){return n&&n.addSuffix?n.comparison&&n.comparison>0?t.future?r(t.future,i):"праз "+r(t.regular,i):t.past?r(t.past,i):r(t.regular,i)+" таму":r(t.regular,i)}}var o=function(i,n){return n&&n.addSuffix?n.comparison&&n.comparison>0?"праз паўхвіліны":"паўхвіліны таму":"паўхвіліны"},l={lessThanXSeconds:e({regular:{one:"менш за секунду",singularNominative:"менш за {{count}} секунду",singularGenitive:"менш за {{count}} секунды",pluralGenitive:"менш за {{count}} секунд"},future:{one:"менш, чым праз секунду",singularNominative:"менш, чым праз {{count}} секунду",singularGenitive:"менш, чым праз {{count}} секунды",pluralGenitive:"менш, чым праз {{count}} секунд"}}),xSeconds:e({regular:{singularNominative:"{{count}} секунда",singularGenitive:"{{count}} секунды",pluralGenitive:"{{count}} секунд"},past:{singularNominative:"{{count}} секунду таму",singularGenitive:"{{count}} секунды таму",pluralGenitive:"{{count}} секунд таму"},future:{singularNominative:"праз {{count}} секунду",singularGenitive:"праз {{count}} секунды",pluralGenitive:"праз {{count}} секунд"}}),halfAMinute:o,lessThanXMinutes:e({regular:{one:"менш за хвіліну",singularNominative:"менш за {{count}} хвіліну",singularGenitive:"менш за {{count}} хвіліны",pluralGenitive:"менш за {{count}} хвілін"},future:{one:"менш, чым праз хвіліну",singularNominative:"менш, чым праз {{count}} хвіліну",singularGenitive:"менш, чым праз {{count}} хвіліны",pluralGenitive:"менш, чым праз {{count}} хвілін"}}),xMinutes:e({regular:{singularNominative:"{{count}} хвіліна",singularGenitive:"{{count}} хвіліны",pluralGenitive:"{{count}} хвілін"},past:{singularNominative:"{{count}} хвіліну таму",singularGenitive:"{{count}} хвіліны таму",pluralGenitive:"{{count}} хвілін таму"},future:{singularNominative:"праз {{count}} хвіліну",singularGenitive:"праз {{count}} хвіліны",pluralGenitive:"праз {{count}} хвілін"}}),aboutXHours:e({regular:{singularNominative:"каля {{count}} гадзіны",singularGenitive:"каля {{count}} гадзін",pluralGenitive:"каля {{count}} гадзін"},future:{singularNominative:"прыблізна праз {{count}} гадзіну",singularGenitive:"прыблізна праз {{count}} гадзіны",pluralGenitive:"прыблізна праз {{count}} гадзін"}}),xHours:e({regular:{singularNominative:"{{count}} гадзіна",singularGenitive:"{{count}} гадзіны",pluralGenitive:"{{count}} гадзін"},past:{singularNominative:"{{count}} гадзіну таму",singularGenitive:"{{count}} гадзіны таму",pluralGenitive:"{{count}} гадзін таму"},future:{singularNominative:"праз {{count}} гадзіну",singularGenitive:"праз {{count}} гадзіны",pluralGenitive:"праз {{count}} гадзін"}}),xDays:e({regular:{singularNominative:"{{count}} дзень",singularGenitive:"{{count}} дні",pluralGenitive:"{{count}} дзён"}}),aboutXWeeks:e({regular:{singularNominative:"каля {{count}} месяца",singularGenitive:"каля {{count}} месяцаў",pluralGenitive:"каля {{count}} месяцаў"},future:{singularNominative:"прыблізна праз {{count}} месяц",singularGenitive:"прыблізна праз {{count}} месяцы",pluralGenitive:"прыблізна праз {{count}} месяцаў"}}),xWeeks:e({regular:{singularNominative:"{{count}} месяц",singularGenitive:"{{count}} месяцы",pluralGenitive:"{{count}} месяцаў"}}),aboutXMonths:e({regular:{singularNominative:"каля {{count}} месяца",singularGenitive:"каля {{count}} месяцаў",pluralGenitive:"каля {{count}} месяцаў"},future:{singularNominative:"прыблізна праз {{count}} месяц",singularGenitive:"прыблізна праз {{count}} месяцы",pluralGenitive:"прыблізна праз {{count}} месяцаў"}}),xMonths:e({regular:{singularNominative:"{{count}} месяц",singularGenitive:"{{count}} месяцы",pluralGenitive:"{{count}} месяцаў"}}),aboutXYears:e({regular:{singularNominative:"каля {{count}} года",singularGenitive:"каля {{count}} гадоў",pluralGenitive:"каля {{count}} гадоў"},future:{singularNominative:"прыблізна праз {{count}} год",singularGenitive:"прыблізна праз {{count}} гады",pluralGenitive:"прыблізна праз {{count}} гадоў"}}),xYears:e({regular:{singularNominative:"{{count}} год",singularGenitive:"{{count}} гады",pluralGenitive:"{{count}} гадоў"}}),overXYears:e({regular:{singularNominative:"больш за {{count}} год",singularGenitive:"больш за {{count}} гады",pluralGenitive:"больш за {{count}} гадоў"},future:{singularNominative:"больш, чым праз {{count}} год",singularGenitive:"больш, чым праз {{count}} гады",pluralGenitive:"больш, чым праз {{count}} гадоў"}}),almostXYears:e({regular:{singularNominative:"амаль {{count}} год",singularGenitive:"амаль {{count}} гады",pluralGenitive:"амаль {{count}} гадоў"},future:{singularNominative:"амаль праз {{count}} год",singularGenitive:"амаль праз {{count}} гады",pluralGenitive:"амаль праз {{count}} гадоў"}})},p=function(i,n,c){return c=c||{},l[i](n,c)},m=p;a.default=m,d.exports=a.default})(w,w.exports);var C=w.exports,_={exports:{}};(function(d,a){var r=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=r(E),o={full:"EEEE, d MMMM y 'г.'",long:"d MMMM y 'г.'",medium:"d MMM y 'г.'",short:"dd.MM.y"},l={full:"H:mm:ss zzzz",long:"H:mm:ss z",medium:"H:mm:ss",short:"H:mm"},p={any:"{{date}}, {{time}}"},m={date:(0,e.default)({formats:o,defaultWidth:"full"}),time:(0,e.default)({formats:l,defaultWidth:"full"}),dateTime:(0,e.default)({formats:p,defaultWidth:"any"})},t=m;a.default=t,d.exports=a.default})(_,_.exports);var q=_.exports,N={exports:{}};(function(d,a){var r=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=R,o=r(S),l=["нядзелю","панядзелак","аўторак","сераду","чацвер","пятніцу","суботу"];function p(f){var u=l[f];switch(f){case 0:case 3:case 5:case 6:return"'у мінулую "+u+" а' p";case 1:case 2:case 4:return"'у мінулы "+u+" а' p"}}function m(f){var u=l[f];return"'у "+u+" а' p"}function t(f){var u=l[f];switch(f){case 0:case 3:case 5:case 6:return"'у наступную "+u+" а' p";case 1:case 2:case 4:return"'у наступны "+u+" а' p"}}var i=function(u,h,g){var v=(0,e.toDate)(u),s=v.getUTCDay();return(0,o.default)(v,h,g)?m(s):p(s)},n=function(u,h,g){var v=(0,e.toDate)(u),s=v.getUTCDay();return(0,o.default)(v,h,g)?m(s):t(s)},c={lastWeek:i,yesterday:"'учора а' p",today:"'сёння а' p",tomorrow:"'заўтра а' p",nextWeek:n,other:"P"},b=function(u,h,g,v){var s=c[u];return typeof s=="function"?s(h,g,v):s},G=b;a.default=G,d.exports=a.default})(N,N.exports);var L=N.exports,M={exports:{}};(function(d,a){var r=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=r(F),o={narrow:["да н.э.","н.э."],abbreviated:["да н. э.","н. э."],wide:["да нашай эры","нашай эры"]},l={narrow:["1","2","3","4"],abbreviated:["1-ы кв.","2-і кв.","3-і кв.","4-ы кв."],wide:["1-ы квартал","2-і квартал","3-і квартал","4-ы квартал"]},p={narrow:["С","Л","С","К","М","Ч","Л","Ж","В","К","Л","С"],abbreviated:["студз.","лют.","сак.","крас.","май","чэрв.","ліп.","жн.","вер.","кастр.","ліст.","снеж."],wide:["студзень","люты","сакавік","красавік","май","чэрвень","ліпень","жнівень","верасень","кастрычнік","лістапад","снежань"]},m={narrow:["С","Л","С","К","М","Ч","Л","Ж","В","К","Л","С"],abbreviated:["студз.","лют.","сак.","крас.","мая","чэрв.","ліп.","жн.","вер.","кастр.","ліст.","снеж."],wide:["студзеня","лютага","сакавіка","красавіка","мая","чэрвеня","ліпеня","жніўня","верасня","кастрычніка","лістапада","снежня"]},t={narrow:["Н","П","А","С","Ч","П","С"],short:["нд","пн","аў","ср","чц","пт","сб"],abbreviated:["нядз","пан","аўт","сер","чац","пят","суб"],wide:["нядзеля","панядзелак","аўторак","серада","чацвер","пятніца","субота"]},i={narrow:{am:"ДП",pm:"ПП",midnight:"поўн.",noon:"поўд.",morning:"ран.",afternoon:"дзень",evening:"веч.",night:"ноч"},abbreviated:{am:"ДП",pm:"ПП",midnight:"поўн.",noon:"поўд.",morning:"ран.",afternoon:"дзень",evening:"веч.",night:"ноч"},wide:{am:"ДП",pm:"ПП",midnight:"поўнач",noon:"поўдзень",morning:"раніца",afternoon:"дзень",evening:"вечар",night:"ноч"}},n={narrow:{am:"ДП",pm:"ПП",midnight:"поўн.",noon:"поўд.",morning:"ран.",afternoon:"дня",evening:"веч.",night:"ночы"},abbreviated:{am:"ДП",pm:"ПП",midnight:"поўн.",noon:"поўд.",morning:"ран.",afternoon:"дня",evening:"веч.",night:"ночы"},wide:{am:"ДП",pm:"ПП",midnight:"поўнач",noon:"поўдзень",morning:"раніцы",afternoon:"дня",evening:"вечара",night:"ночы"}},c=function(u,h){var g=String(h==null?void 0:h.unit),v=Number(u),s;return g==="date"?s="-га":g==="hour"||g==="minute"||g==="second"?s="-я":s=(v%10===2||v%10===3)&&v%100!==12&&v%100!==13?"-і":"-ы",v+s},b={ordinalNumber:c,era:(0,e.default)({values:o,defaultWidth:"wide"}),quarter:(0,e.default)({values:l,defaultWidth:"wide",argumentCallback:function(u){return u-1}}),month:(0,e.default)({values:p,defaultWidth:"wide",formattingValues:m,defaultFormattingWidth:"wide"}),day:(0,e.default)({values:t,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:i,defaultWidth:"any",formattingValues:n,defaultFormattingWidth:"wide"})},G=b;a.default=G,d.exports=a.default})(M,M.exports);var T=M.exports,W={exports:{}};(function(d,a){var r=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=r(O),o=r(z),l=/^(\d+)(-?(е|я|га|і|ы|ае|ая|яя|шы|гі|ці|ты|мы))?/i,p=/\d+/i,m={narrow:/^((да )?н\.?\s?э\.?)/i,abbreviated:/^((да )?н\.?\s?э\.?)/i,wide:/^(да нашай эры|нашай эры|наша эра)/i},t={any:[/^д/i,/^н/i]},i={narrow:/^[1234]/i,abbreviated:/^[1234](-?[ыі]?)? кв.?/i,wide:/^[1234](-?[ыі]?)? квартал/i},n={any:[/1/i,/2/i,/3/i,/4/i]},c={narrow:/^[слкмчжв]/i,abbreviated:/^(студз|лют|сак|крас|ма[йя]|чэрв|ліп|жн|вер|кастр|ліст|снеж)\.?/i,wide:/^(студзен[ья]|лют(ы|ага)|сакавіка?|красавіка?|ма[йя]|чэрвен[ья]|ліпен[ья]|жні(вень|ўня)|верас(ень|ня)|кастрычніка?|лістапада?|снеж(ань|ня))/i},b={narrow:[/^с/i,/^л/i,/^с/i,/^к/i,/^м/i,/^ч/i,/^л/i,/^ж/i,/^в/i,/^к/i,/^л/i,/^с/i],any:[/^ст/i,/^лю/i,/^са/i,/^кр/i,/^ма/i,/^ч/i,/^ліп/i,/^ж/i,/^в/i,/^ка/i,/^ліс/i,/^сн/i]},G={narrow:/^[нпасч]/i,short:/^(нд|ня|пн|па|аў|ат|ср|се|чц|ча|пт|пя|сб|су)\.?/i,abbreviated:/^(нядз?|ндз|пнд|пан|аўт|срд|сер|чцв|чац|птн|пят|суб).?/i,wide:/^(нядзел[яі]|панядзел(ак|ка)|аўтор(ак|ка)|серад[аы]|чацв(ер|ярга)|пятніц[аы]|субот[аы])/i},f={narrow:[/^н/i,/^п/i,/^а/i,/^с/i,/^ч/i,/^п/i,/^с/i],any:[/^н/i,/^п[ан]/i,/^а/i,/^с[ер]/i,/^ч/i,/^п[ят]/i,/^с[уб]/i]},u={narrow:/^([дп]п|поўн\.?|поўд\.?|ран\.?|дзень|дня|веч\.?|ночы?)/i,abbreviated:/^([дп]п|поўн\.?|поўд\.?|ран\.?|дзень|дня|веч\.?|ночы?)/i,wide:/^([дп]п|поўнач|поўдзень|раніц[аы]|дзень|дня|вечара?|ночы?)/i},h={any:{am:/^дп/i,pm:/^пп/i,midnight:/^поўн/i,noon:/^поўд/i,morning:/^р/i,afternoon:/^д[зн]/i,evening:/^в/i,night:/^н/i}},g={ordinalNumber:(0,o.default)({matchPattern:l,parsePattern:p,valueCallback:function(x){return parseInt(x,10)}}),era:(0,e.default)({matchPatterns:m,defaultMatchWidth:"wide",parsePatterns:t,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:i,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any",valueCallback:function(x){return x+1}}),month:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:b,defaultParseWidth:"any"}),day:(0,e.default)({matchPatterns:G,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,e.default)({matchPatterns:u,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any"})},v=g;a.default=v,d.exports=a.default})(W,W.exports);var V=W.exports;(function(d,a){var r=y.default;Object.defineProperty(a,"__esModule",{value:!0}),a.default=void 0;var e=r(C),o=r(q),l=r(L),p=r(T),m=r(V),t={code:"be",formatDistance:e.default,formatLong:o.default,formatRelative:l.default,localize:p.default,match:m.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},i=t;a.default=i,d.exports=a.default})(P,P.exports);var k=P.exports;const X=D(k),Q=j({__proto__:null,default:X},[k]);export{Q as i};
