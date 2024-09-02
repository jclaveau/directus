import{g as O}from"./index.64088c7b.entry.js";import{i as m,b as k,a as j,d as z,c as R}from"./index-ead2b777.js";function F(n,e){for(var r=0;r<e.length;r++){const t=e[r];if(typeof t!="string"&&!Array.isArray(t)){for(const a in t)if(a!=="default"&&!(a in n)){const d=Object.getOwnPropertyDescriptor(t,a);d&&Object.defineProperty(n,a,d.get?d:{enumerable:!0,get:()=>t[a]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var g={exports:{}},b={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r={lessThanXSeconds:{one:"أقل من ثانية واحدة",two:"أقل من ثانتين",threeToTen:"أقل من {{count}} ثواني",other:"أقل من {{count}} ثانية"},xSeconds:{one:"ثانية واحدة",two:"ثانتين",threeToTen:"{{count}} ثواني",other:"{{count}} ثانية"},halfAMinute:"نصف دقيقة",lessThanXMinutes:{one:"أقل من دقيقة",two:"أقل من دقيقتين",threeToTen:"أقل من {{count}} دقائق",other:"أقل من {{count}} دقيقة"},xMinutes:{one:"دقيقة واحدة",two:"دقيقتين",threeToTen:"{{count}} دقائق",other:"{{count}} دقيقة"},aboutXHours:{one:"ساعة واحدة تقريباً",two:"ساعتين تقريباً",threeToTen:"{{count}} ساعات تقريباً",other:"{{count}} ساعة تقريباً"},xHours:{one:"ساعة واحدة",two:"ساعتين",threeToTen:"{{count}} ساعات",other:"{{count}} ساعة"},xDays:{one:"يوم واحد",two:"يومين",threeToTen:"{{count}} أيام",other:"{{count}} يوم"},aboutXWeeks:{one:"أسبوع واحد تقريباً",two:"أسبوعين تقريباً",threeToTen:"{{count}} أسابيع تقريباً",other:"{{count}} أسبوع تقريباً"},xWeeks:{one:"أسبوع واحد",two:"أسبوعين",threeToTen:"{{count}} أسابيع",other:"{{count}} أسبوع"},aboutXMonths:{one:"شهر واحد تقريباً",two:"شهرين تقريباً",threeToTen:"{{count}} أشهر تقريباً",other:"{{count}} شهر تقريباً"},xMonths:{one:"شهر واحد",two:"شهرين",threeToTen:"{{count}} أشهر",other:"{{count}} شهر"},aboutXYears:{one:"عام واحد تقريباً",two:"عامين تقريباً",threeToTen:"{{count}} أعوام تقريباً",other:"{{count}} عام تقريباً"},xYears:{one:"عام واحد",two:"عامين",threeToTen:"{{count}} أعوام",other:"{{count}} عام"},overXYears:{one:"أكثر من عام",two:"أكثر من عامين",threeToTen:"أكثر من {{count}} أعوام",other:"أكثر من {{count}} عام"},almostXYears:{one:"عام واحد تقريباً",two:"عامين تقريباً",threeToTen:"{{count}} أعوام تقريباً",other:"{{count}} عام تقريباً"}},t=function(s,o,i){i=i||{};var u=r[s],l;return typeof u=="string"?l=u:o===1?l=u.one:o===2?l=u.two:o<=10?l=u.threeToTen.replace("{{count}}",String(o)):l=u.other.replace("{{count}}",String(o)),i.addSuffix?i.comparison&&i.comparison>0?"في خلال "+l:"منذ "+l:l},a=t;e.default=a,n.exports=e.default})(b,b.exports);var N=b.exports,w={exports:{}};(function(n,e){var r=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=r(k),a={full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},d={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},s={full:"{{date}} 'عند' {{time}}",long:"{{date}} 'عند' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},o={date:(0,t.default)({formats:a,defaultWidth:"full"}),time:(0,t.default)({formats:d,defaultWidth:"full"}),dateTime:(0,t.default)({formats:s,defaultWidth:"full"})},i=o;e.default=i,n.exports=e.default})(w,w.exports);var S=w.exports,y={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r={lastWeek:"'أخر' eeee 'عند' p",yesterday:"'أمس عند' p",today:"'اليوم عند' p",tomorrow:"'غداً عند' p",nextWeek:"eeee 'عند' p",other:"P"},t=function(s,o,i,u){return r[s]},a=t;e.default=a,n.exports=e.default})(y,y.exports);var q=y.exports,P={exports:{}};(function(n,e){var r=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=r(j),a={narrow:["ق","ب"],abbreviated:["ق.م.","ب.م."],wide:["قبل الميلاد","بعد الميلاد"]},d={narrow:["1","2","3","4"],abbreviated:["ر1","ر2","ر3","ر4"],wide:["الربع الأول","الربع الثاني","الربع الثالث","الربع الرابع"]},s={narrow:["ج","ف","م","أ","م","ج","ج","أ","س","أ","ن","د"],abbreviated:["جانـ","فيفـ","مارس","أفريل","مايـ","جوانـ","جويـ","أوت","سبتـ","أكتـ","نوفـ","ديسـ"],wide:["جانفي","فيفري","مارس","أفريل","ماي","جوان","جويلية","أوت","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]},o={narrow:["ح","ن","ث","ر","خ","ج","س"],short:["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"],abbreviated:["أحد","اثنـ","ثلا","أربـ","خميـ","جمعة","سبت"],wide:["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]},i={narrow:{am:"ص",pm:"م",midnight:"ن",noon:"ظ",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"},abbreviated:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"},wide:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظهر",evening:"مساءاً",night:"ليلاً"}},u={narrow:{am:"ص",pm:"م",midnight:"ن",noon:"ظ",morning:"في الصباح",afternoon:"بعد الظـهر",evening:"في المساء",night:"في الليل"},abbreviated:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"في الصباح",afternoon:"بعد الظهر",evening:"في المساء",night:"في الليل"},wide:{am:"ص",pm:"م",midnight:"نصف الليل",noon:"ظهر",morning:"صباحاً",afternoon:"بعد الظـهر",evening:"في المساء",night:"في الليل"}},l=function(f){return String(f)},h={ordinalNumber:l,era:(0,t.default)({values:a,defaultWidth:"wide"}),quarter:(0,t.default)({values:d,defaultWidth:"wide",argumentCallback:function(f){return Number(f)-1}}),month:(0,t.default)({values:s,defaultWidth:"wide"}),day:(0,t.default)({values:o,defaultWidth:"wide"}),dayPeriod:(0,t.default)({values:i,defaultWidth:"wide",formattingValues:u,defaultFormattingWidth:"wide"})},v=h;e.default=v,n.exports=e.default})(P,P.exports);var C=P.exports,x={exports:{}};(function(n,e){var r=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=r(z),a=r(R),d=/^(\d+)(th|st|nd|rd)?/i,s=/\d+/i,o={narrow:/^(ق|ب)/i,abbreviated:/^(ق\.?\s?م\.?|ق\.?\s?م\.?\s?|a\.?\s?d\.?|c\.?\s?)/i,wide:/^(قبل الميلاد|قبل الميلاد|بعد الميلاد|بعد الميلاد)/i},i={any:[/^قبل/i,/^بعد/i]},u={narrow:/^[1234]/i,abbreviated:/^ر[1234]/i,wide:/^الربع [1234]/i},l={any:[/1/i,/2/i,/3/i,/4/i]},h={narrow:/^[جفمأسند]/i,abbreviated:/^(جان|فيف|مار|أفر|ماي|جوا|جوي|أوت|سبت|أكت|نوف|ديس)/i,wide:/^(جانفي|فيفري|مارس|أفريل|ماي|جوان|جويلية|أوت|سبتمبر|أكتوبر|نوفمبر|ديسمبر)/i},v={narrow:[/^ج/i,/^ف/i,/^م/i,/^أ/i,/^م/i,/^ج/i,/^ج/i,/^أ/i,/^س/i,/^أ/i,/^ن/i,/^د/i],any:[/^جان/i,/^فيف/i,/^مار/i,/^أفر/i,/^ماي/i,/^جوا/i,/^جوي/i,/^أوت/i,/^سبت/i,/^أكت/i,/^نوف/i,/^ديس/i]},c={narrow:/^[حنثرخجس]/i,short:/^(أحد|اثنين|ثلاثاء|أربعاء|خميس|جمعة|سبت)/i,abbreviated:/^(أحد|اثن|ثلا|أرب|خمي|جمعة|سبت)/i,wide:/^(الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)/i},f={narrow:[/^ح/i,/^ن/i,/^ث/i,/^ر/i,/^خ/i,/^ج/i,/^س/i],wide:[/^الأحد/i,/^الاثنين/i,/^الثلاثاء/i,/^الأربعاء/i,/^الخميس/i,/^الجمعة/i,/^السبت/i],any:[/^أح/i,/^اث/i,/^ث/i,/^أر/i,/^خ/i,/^ج/i,/^س/i]},T={narrow:/^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,any:/^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i},M={any:{am:/^a/i,pm:/^p/i,midnight:/^mi/i,noon:/^no/i,morning:/morning/i,afternoon:/afternoon/i,evening:/evening/i,night:/night/i}},D={ordinalNumber:(0,t.default)({matchPattern:d,parsePattern:s,valueCallback:function(p){return parseInt(p,10)}}),era:(0,a.default)({matchPatterns:o,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:u,defaultMatchWidth:"wide",parsePatterns:l,defaultParseWidth:"any",valueCallback:function(p){return Number(p)+1}}),month:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:v,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:T,defaultMatchWidth:"any",parsePatterns:M,defaultParseWidth:"any"})},W=D;e.default=W,n.exports=e.default})(x,x.exports);var L=x.exports;(function(n,e){var r=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=r(N),a=r(S),d=r(q),s=r(C),o=r(L),i={code:"ar-DZ",formatDistance:t.default,formatLong:a.default,formatRelative:d.default,localize:s.default,match:o.default,options:{weekStartsOn:0,firstWeekContainsDate:1}},u=i;e.default=u,n.exports=e.default})(g,g.exports);var _=g.exports;const X=O(_),A=F({__proto__:null,default:X},[_]);export{A as i};
