import{g as k}from"./index.85962662.entry.js";import{i as m,b as O,a as S,c as j,d as z}from"./index-ead2b777.js";function R(n,e){for(var a=0;a<e.length;a++){const t=e[a];if(typeof t!="string"&&!Array.isArray(t)){for(const r in t)if(r!=="default"&&!(r in n)){const u=Object.getOwnPropertyDescriptor(t,r);u&&Object.defineProperty(n,r,u.get?u:{enumerable:!0,get:()=>t[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var g={exports:{}},b={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a={lessThanXSeconds:{one:"أقل من ثانية واحدة",two:"أقل من ثانتين",threeToTen:"أقل من {{count}} ثواني",other:"أقل من {{count}} ثانية"},xSeconds:{one:"ثانية واحدة",two:"ثانتين",threeToTen:"{{count}} ثواني",other:"{{count}} ثانية"},halfAMinute:"نصف دقيقة",lessThanXMinutes:{one:"أقل من دقيقة",two:"أقل من دقيقتين",threeToTen:"أقل من {{count}} دقائق",other:"أقل من {{count}} دقيقة"},xMinutes:{one:"دقيقة واحدة",two:"دقيقتين",threeToTen:"{{count}} دقائق",other:"{{count}} دقيقة"},aboutXHours:{one:"ساعة واحدة تقريباً",two:"ساعتين تقريباً",threeToTen:"{{count}} ساعات تقريباً",other:"{{count}} ساعة تقريباً"},xHours:{one:"ساعة واحدة",two:"ساعتين",threeToTen:"{{count}} ساعات",other:"{{count}} ساعة"},xDays:{one:"يوم واحد",two:"يومين",threeToTen:"{{count}} أيام",other:"{{count}} يوم"},aboutXWeeks:{one:"أسبوع واحد تقريباً",two:"أسبوعين تقريباً",threeToTen:"{{count}} أسابيع تقريباً",other:"{{count}} أسبوع تقريباً"},xWeeks:{one:"أسبوع واحد",two:"أسبوعين",threeToTen:"{{count}} أسابيع",other:"{{count}} أسبوع"},aboutXMonths:{one:"شهر واحد تقريباً",two:"شهرين تقريباً",threeToTen:"{{count}} أشهر تقريباً",other:"{{count}} شهر تقريباً"},xMonths:{one:"شهر واحد",two:"شهرين",threeToTen:"{{count}} أشهر",other:"{{count}} شهر"},aboutXYears:{one:"عام واحد تقريباً",two:"عامين تقريباً",threeToTen:"{{count}} أعوام تقريباً",other:"{{count}} عام تقريباً"},xYears:{one:"عام واحد",two:"عامين",threeToTen:"{{count}} أعوام",other:"{{count}} عام"},overXYears:{one:"أكثر من عام",two:"أكثر من عامين",threeToTen:"أكثر من {{count}} أعوام",other:"أكثر من {{count}} عام"},almostXYears:{one:"عام واحد تقريباً",two:"عامين تقريباً",threeToTen:"{{count}} أعوام تقريباً",other:"{{count}} عام تقريباً"}},t=function(l,i,d){var o,s=a[l];return typeof s=="string"?o=s:i===1?o=s.one:i===2?o=s.two:i<=10?o=s.threeToTen.replace("{{count}}",String(i)):o=s.other.replace("{{count}}",String(i)),d!=null&&d.addSuffix?d.comparison&&d.comparison>0?"في خلال "+o:"منذ "+o:o},r=t;e.default=r,n.exports=e.default})(b,b.exports);var F=b.exports,w={exports:{}};(function(n,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(O),r={full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},u={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},l={full:"{{date}} 'عند' {{time}}",long:"{{date}} 'عند' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},i={date:(0,t.default)({formats:r,defaultWidth:"full"}),time:(0,t.default)({formats:u,defaultWidth:"full"}),dateTime:(0,t.default)({formats:l,defaultWidth:"full"})},d=i;e.default=d,n.exports=e.default})(w,w.exports);var q=w.exports,y={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a={lastWeek:"'أخر' eeee 'عند' p",yesterday:"'أمس عند' p",today:"'اليوم عند' p",tomorrow:"'غداً عند' p",nextWeek:"eeee 'عند' p",other:"P"},t=function(l,i,d,o){return a[l]},r=t;e.default=r,n.exports=e.default})(y,y.exports);var C=y.exports,P={exports:{}};(function(n,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(S),r={narrow:["ق","ب"],abbreviated:["ق.م.","ب.م."],wide:["قبل الميلاد","بعد الميلاد"]},u={narrow:["1","2","3","4"],abbreviated:["ر1","ر2","ر3","ر4"],wide:["الربع الأول","الربع الثاني","الربع الثالث","الربع الرابع"]},l={narrow:["ي","ف","م","أ","م","ي","ي","أ","س","أ","ن","د"],abbreviated:["ينا","فبر","مارس","أبريل","مايو","يونـ","يولـ","أغسـ","سبتـ","أكتـ","نوفـ","ديسـ"],wide:["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]},i={narrow:["ح","ن","ث","ر","خ","ج","س"],short:["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"],abbreviated:["أحد","اثنـ","ثلا","أربـ","خميـ","جمعة","سبت"],wide:["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]},d={narrow:{am:"ص",pm:"م",midnight:"ن",noon:"ظ",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"},abbreviated:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"},wide:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"}},o={narrow:{am:"ص",pm:"م",midnight:"ن",noon:"ظ",morning:"في الصباح",afternoon:"بعد الظـهر",evening:"في المساء",night:"في الليل"},abbreviated:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"في الصباح",afternoon:"بعد الظهر",evening:"في المساء",night:"في الليل"},wide:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظـهر",evening:"في المساء",night:"في الليل"}},s=function(f){return String(f)},h={ordinalNumber:s,era:(0,t.default)({values:r,defaultWidth:"wide"}),quarter:(0,t.default)({values:u,defaultWidth:"wide",argumentCallback:function(f){return f-1}}),month:(0,t.default)({values:l,defaultWidth:"wide"}),day:(0,t.default)({values:i,defaultWidth:"wide"}),dayPeriod:(0,t.default)({values:d,defaultWidth:"wide",formattingValues:o,defaultFormattingWidth:"wide"})},v=h;e.default=v,n.exports=e.default})(P,P.exports);var L=P.exports,x={exports:{}};(function(n,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(j),r=a(z),u=/^(\d+)(th|st|nd|rd)?/i,l=/\d+/i,i={narrow:/^(ق|ب)/i,abbreviated:/^(ق\.?\s?م\.?|ق\.?\s?م\.?\s?|a\.?\s?d\.?|c\.?\s?)/i,wide:/^(قبل الميلاد|قبل الميلاد|بعد الميلاد|بعد الميلاد)/i},d={any:[/^قبل/i,/^بعد/i]},o={narrow:/^[1234]/i,abbreviated:/^ر[1234]/i,wide:/^الربع [1234]/i},s={any:[/1/i,/2/i,/3/i,/4/i]},h={narrow:/^[يفمأمسند]/i,abbreviated:/^(ين|ف|مار|أب|ماي|يون|يول|أغ|س|أك|ن|د)/i,wide:/^(ين|ف|مار|أب|ماي|يون|يول|أغ|س|أك|ن|د)/i},v={narrow:[/^ي/i,/^ف/i,/^م/i,/^أ/i,/^م/i,/^ي/i,/^ي/i,/^أ/i,/^س/i,/^أ/i,/^ن/i,/^د/i],any:[/^ين/i,/^ف/i,/^مار/i,/^أب/i,/^ماي/i,/^يون/i,/^يول/i,/^أغ/i,/^س/i,/^أك/i,/^ن/i,/^د/i]},c={narrow:/^[حنثرخجس]/i,short:/^(أحد|اثنين|ثلاثاء|أربعاء|خميس|جمعة|سبت)/i,abbreviated:/^(أحد|اثن|ثلا|أرب|خمي|جمعة|سبت)/i,wide:/^(الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)/i},f={narrow:[/^ح/i,/^ن/i,/^ث/i,/^ر/i,/^خ/i,/^ج/i,/^س/i],wide:[/^الأحد/i,/^الاثنين/i,/^الثلاثاء/i,/^الأربعاء/i,/^الخميس/i,/^الجمعة/i,/^السبت/i],any:[/^أح/i,/^اث/i,/^ث/i,/^أر/i,/^خ/i,/^ج/i,/^س/i]},T={narrow:/^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,any:/^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i},M={any:{am:/^a/i,pm:/^p/i,midnight:/^mi/i,noon:/^no/i,morning:/morning/i,afternoon:/afternoon/i,evening:/evening/i,night:/night/i}},W={ordinalNumber:(0,r.default)({matchPattern:u,parsePattern:l,valueCallback:function(p){return parseInt(p,10)}}),era:(0,t.default)({matchPatterns:i,defaultMatchWidth:"wide",parsePatterns:d,defaultParseWidth:"any"}),quarter:(0,t.default)({matchPatterns:o,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,t.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:v,defaultParseWidth:"any"}),day:(0,t.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,t.default)({matchPatterns:T,defaultMatchWidth:"any",parsePatterns:M,defaultParseWidth:"any"})},D=W;e.default=D,n.exports=e.default})(x,x.exports);var V=x.exports;(function(n,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(F),r=a(q),u=a(C),l=a(L),i=a(V),d={code:"ar-SA",formatDistance:t.default,formatLong:r.default,formatRelative:u.default,localize:l.default,match:i.default,options:{weekStartsOn:0,firstWeekContainsDate:1}},o=d;e.default=o,n.exports=e.default})(g,g.exports);var _=g.exports;const X=k(_),Y=R({__proto__:null,default:X},[_]);export{Y as i};
