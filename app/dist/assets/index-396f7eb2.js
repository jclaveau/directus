import{g as O}from"./index.85962662.entry.js";import{i as m,b as R,a as j,c as z,d as F}from"./index-ead2b777.js";function q(i,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in i)){const o=Object.getOwnPropertyDescriptor(a,r);o&&Object.defineProperty(i,r,o.get?o:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(i,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},g={exports:{}};(function(i,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lessThanXSeconds:{one:"کمتر از یک ثانیه",other:"کمتر از {{count}} ثانیه"},xSeconds:{one:"1 ثانیه",other:"{{count}} ثانیه"},halfAMinute:"نیم دقیقه",lessThanXMinutes:{one:"کمتر از یک دقیقه",other:"کمتر از {{count}} دقیقه"},xMinutes:{one:"1 دقیقه",other:"{{count}} دقیقه"},aboutXHours:{one:"حدود 1 ساعت",other:"حدود {{count}} ساعت"},xHours:{one:"1 ساعت",other:"{{count}} ساعت"},xDays:{one:"1 روز",other:"{{count}} روز"},aboutXWeeks:{one:"حدود 1 هفته",other:"حدود {{count}} هفته"},xWeeks:{one:"1 هفته",other:"{{count}} هفته"},aboutXMonths:{one:"حدود 1 ماه",other:"حدود {{count}} ماه"},xMonths:{one:"1 ماه",other:"{{count}} ماه"},aboutXYears:{one:"حدود 1 سال",other:"حدود {{count}} سال"},xYears:{one:"1 سال",other:"{{count}} سال"},overXYears:{one:"بیشتر از 1 سال",other:"بیشتر از {{count}} سال"},almostXYears:{one:"نزدیک 1 سال",other:"نزدیک {{count}} سال"}},a=function(u,l,n){var d,s=t[u];return typeof s=="string"?d=s:l===1?d=s.one:d=s.other.replace("{{count}}",String(l)),n!=null&&n.addSuffix?n.comparison&&n.comparison>0?"در "+d:d+" قبل":d},r=a;e.default=r,i.exports=e.default})(g,g.exports);var C=g.exports,y={exports:{}};(function(i,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(R),r={full:"EEEE do MMMM y",long:"do MMMM y",medium:"d MMM y",short:"yyyy/MM/dd"},o={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},u={full:"{{date}} 'در' {{time}}",long:"{{date}} 'در' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},l={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:o,defaultWidth:"full"}),dateTime:(0,a.default)({formats:u,defaultWidth:"full"})},n=l;e.default=n,i.exports=e.default})(y,y.exports);var L=y.exports,P={exports:{}};(function(i,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"eeee 'گذشته در' p",yesterday:"'دیروز در' p",today:"'امروز در' p",tomorrow:"'فردا در' p",nextWeek:"eeee 'در' p",other:"P"},a=function(u,l,n,d){return t[u]},r=a;e.default=r,i.exports=e.default})(P,P.exports);var S=P.exports,_={exports:{}};(function(i,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(j),r={narrow:["ق","ب"],abbreviated:["ق.م.","ب.م."],wide:["قبل از میلاد","بعد از میلاد"]},o={narrow:["1","2","3","4"],abbreviated:["س‌م1","س‌م2","س‌م3","س‌م4"],wide:["سه‌ماهه 1","سه‌ماهه 2","سه‌ماهه 3","سه‌ماهه 4"]},u={narrow:["ژ","ف","م","آ","م","ج","ج","آ","س","ا","ن","د"],abbreviated:["ژانـ","فور","مارس","آپر","می","جون","جولـ","آگو","سپتـ","اکتـ","نوامـ","دسامـ"],wide:["ژانویه","فوریه","مارس","آپریل","می","جون","جولای","آگوست","سپتامبر","اکتبر","نوامبر","دسامبر"]},l={narrow:["ی","د","س","چ","پ","ج","ش"],short:["1ش","2ش","3ش","4ش","5ش","ج","ش"],abbreviated:["یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه","شنبه"],wide:["یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه","شنبه"]},n={narrow:{am:"ق",pm:"ب",midnight:"ن",noon:"ظ",morning:"ص",afternoon:"ب.ظ.",evening:"ع",night:"ش"},abbreviated:{am:"ق.ظ.",pm:"ب.ظ.",midnight:"نیمه‌شب",noon:"ظهر",morning:"صبح",afternoon:"بعدازظهر",evening:"عصر",night:"شب"},wide:{am:"قبل‌ازظهر",pm:"بعدازظهر",midnight:"نیمه‌شب",noon:"ظهر",morning:"صبح",afternoon:"بعدازظهر",evening:"عصر",night:"شب"}},d={narrow:{am:"ق",pm:"ب",midnight:"ن",noon:"ظ",morning:"ص",afternoon:"ب.ظ.",evening:"ع",night:"ش"},abbreviated:{am:"ق.ظ.",pm:"ب.ظ.",midnight:"نیمه‌شب",noon:"ظهر",morning:"صبح",afternoon:"بعدازظهر",evening:"عصر",night:"شب"},wide:{am:"قبل‌ازظهر",pm:"بعدازظهر",midnight:"نیمه‌شب",noon:"ظهر",morning:"صبح",afternoon:"بعدازظهر",evening:"عصر",night:"شب"}},s=function(f,w){return String(f)},v={ordinalNumber:s,era:(0,a.default)({values:r,defaultWidth:"wide"}),quarter:(0,a.default)({values:o,defaultWidth:"wide",argumentCallback:function(f){return f-1}}),month:(0,a.default)({values:u,defaultWidth:"wide"}),day:(0,a.default)({values:l,defaultWidth:"wide"}),dayPeriod:(0,a.default)({values:n,defaultWidth:"wide",formattingValues:d,defaultFormattingWidth:"wide"})},c=v;e.default=c,i.exports=e.default})(_,_.exports);var V=_.exports,x={exports:{}};(function(i,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(z),r=t(F),o=/^(\d+)(th|st|nd|rd)?/i,u=/\d+/i,l={narrow:/^(ق|ب)/i,abbreviated:/^(ق\.?\s?م\.?|ق\.?\s?د\.?\s?م\.?|م\.?\s?|د\.?\s?م\.?)/i,wide:/^(قبل از میلاد|قبل از دوران مشترک|میلادی|دوران مشترک|بعد از میلاد)/i},n={any:[/^قبل/i,/^بعد/i]},d={narrow:/^[1234]/i,abbreviated:/^س‌م[1234]/i,wide:/^سه‌ماهه [1234]/i},s={any:[/1/i,/2/i,/3/i,/4/i]},v={narrow:/^[جژفمآاماسند]/i,abbreviated:/^(جنو|ژانـ|ژانویه|فوریه|فور|مارس|آوریل|آپر|مه|می|ژوئن|جون|جول|جولـ|ژوئیه|اوت|آگو|سپتمبر|سپتامبر|اکتبر|اکتوبر|نوامبر|نوامـ|دسامبر|دسامـ|دسم)/i,wide:/^(ژانویه|جنوری|فبروری|فوریه|مارچ|مارس|آپریل|اپریل|ایپریل|آوریل|مه|می|ژوئن|جون|جولای|ژوئیه|آگست|اگست|آگوست|اوت|سپتمبر|سپتامبر|اکتبر|اکتوبر|نوامبر|نومبر|دسامبر|دسمبر)/i},c={narrow:[/^(ژ|ج)/i,/^ف/i,/^م/i,/^(آ|ا)/i,/^م/i,/^(ژ|ج)/i,/^(ج|ژ)/i,/^(آ|ا)/i,/^س/i,/^ا/i,/^ن/i,/^د/i],any:[/^ژا/i,/^ف/i,/^ما/i,/^آپ/i,/^(می|مه)/i,/^(ژوئن|جون)/i,/^(ژوئی|جول)/i,/^(اوت|آگ)/i,/^س/i,/^(اوک|اک)/i,/^ن/i,/^د/i]},h={narrow:/^[شیدسچپج]/i,short:/^(ش|ج|1ش|2ش|3ش|4ش|5ش)/i,abbreviated:/^(یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنج‌شنبه|جمعه|شنبه)/i,wide:/^(یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنج‌شنبه|جمعه|شنبه)/i},f={narrow:[/^ی/i,/^دو/i,/^س/i,/^چ/i,/^پ/i,/^ج/i,/^ش/i],any:[/^(ی|1ش|یکشنبه)/i,/^(د|2ش|دوشنبه)/i,/^(س|3ش|سه‌شنبه)/i,/^(چ|4ش|چهارشنبه)/i,/^(پ|5ش|پنجشنبه)/i,/^(ج|جمعه)/i,/^(ش|شنبه)/i]},w={narrow:/^(ب|ق|ن|ظ|ص|ب.ظ.|ع|ش)/i,abbreviated:/^(ق.ظ.|ب.ظ.|نیمه‌شب|ظهر|صبح|بعدازظهر|عصر|شب)/i,wide:/^(قبل‌ازظهر|نیمه‌شب|ظهر|صبح|بعدازظهر|عصر|شب)/i},W={any:{am:/^(ق|ق.ظ.|قبل‌ازظهر)/i,pm:/^(ب|ب.ظ.|بعدازظهر)/i,midnight:/^(‌نیمه‌شب|ن)/i,noon:/^(ظ|ظهر)/i,morning:/(ص|صبح)/i,afternoon:/(ب|ب.ظ.|بعدازظهر)/i,evening:/(ع|عصر)/i,night:/(ش|شب)/i}},D={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:u,valueCallback:function(p){return parseInt(p,10)}}),era:(0,a.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,a.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:c,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:w,defaultMatchWidth:"wide",parsePatterns:W,defaultParseWidth:"any"})},E=D;e.default=E,i.exports=e.default})(x,x.exports);var X=x.exports;(function(i,e){var t=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(C),r=t(L),o=t(S),u=t(V),l=t(X),n={code:"fa-IR",formatDistance:a.default,formatLong:r.default,formatRelative:o.default,localize:u.default,match:l.default,options:{weekStartsOn:6,firstWeekContainsDate:1}},d=n;e.default=d,i.exports=e.default})(b,b.exports);var M=b.exports;const N=O(M),Y=q({__proto__:null,default:N},[M]);export{Y as i};
