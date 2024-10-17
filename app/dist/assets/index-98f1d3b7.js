import{g as k}from"./index.64088c7b.entry.js";import{i as v,b as D,a as H,c as E,d as S}from"./index-ead2b777.js";function q(n,t){for(var a=0;a<t.length;a++){const e=t[a];if(typeof e!="string"&&!Array.isArray(e)){for(const r in e)if(r!=="default"&&!(r in n)){const o=Object.getOwnPropertyDescriptor(e,r);o&&Object.defineProperty(n,r,o.get?o:{enumerable:!0,get:()=>e[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var _={exports:{}},w={exports:{}};(function(n,t){Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var a={lessThanXSeconds:{one:"dưới 1 giây",other:"dưới {{count}} giây"},xSeconds:{one:"1 giây",other:"{{count}} giây"},halfAMinute:"nửa phút",lessThanXMinutes:{one:"dưới 1 phút",other:"dưới {{count}} phút"},xMinutes:{one:"1 phút",other:"{{count}} phút"},aboutXHours:{one:"khoảng 1 giờ",other:"khoảng {{count}} giờ"},xHours:{one:"1 giờ",other:"{{count}} giờ"},xDays:{one:"1 ngày",other:"{{count}} ngày"},aboutXWeeks:{one:"khoảng 1 tuần",other:"khoảng {{count}} tuần"},xWeeks:{one:"1 tuần",other:"{{count}} tuần"},aboutXMonths:{one:"khoảng 1 tháng",other:"khoảng {{count}} tháng"},xMonths:{one:"1 tháng",other:"{{count}} tháng"},aboutXYears:{one:"khoảng 1 năm",other:"khoảng {{count}} năm"},xYears:{one:"1 năm",other:"{{count}} năm"},overXYears:{one:"hơn 1 năm",other:"hơn {{count}} năm"},almostXYears:{one:"gần 1 năm",other:"gần {{count}} năm"}},e=function(h,d,i){var u,s=a[h];return typeof s=="string"?u=s:d===1?u=s.one:u=s.other.replace("{{count}}",String(d)),i!=null&&i.addSuffix?i.comparison&&i.comparison>0?u+" nữa":u+" trước":u},r=e;t.default=r,n.exports=t.default})(w,w.exports);var I=w.exports,P={exports:{}};(function(n,t){var a=v.default;Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var e=a(D),r={full:"EEEE, 'ngày' d MMMM 'năm' y",long:"'ngày' d MMMM 'năm' y",medium:"d MMM 'năm' y",short:"dd/MM/y"},o={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},h={full:"{{date}} {{time}}",long:"{{date}} {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},d={date:(0,e.default)({formats:r,defaultWidth:"full"}),time:(0,e.default)({formats:o,defaultWidth:"full"}),dateTime:(0,e.default)({formats:h,defaultWidth:"full"})},i=d;t.default=i,n.exports=t.default})(P,P.exports);var O=P.exports,x={exports:{}};(function(n,t){Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var a={lastWeek:"eeee 'tuần trước vào lúc' p",yesterday:"'hôm qua vào lúc' p",today:"'hôm nay vào lúc' p",tomorrow:"'ngày mai vào lúc' p",nextWeek:"eeee 'tới vào lúc' p",other:"P"},e=function(h,d,i,u){return a[h]},r=e;t.default=r,n.exports=t.default})(x,x.exports);var Q=x.exports,C={exports:{}};(function(n,t){var a=v.default;Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var e=a(H),r={narrow:["TCN","SCN"],abbreviated:["trước CN","sau CN"],wide:["trước Công Nguyên","sau Công Nguyên"]},o={narrow:["1","2","3","4"],abbreviated:["Q1","Q2","Q3","Q4"],wide:["Quý 1","Quý 2","Quý 3","Quý 4"]},h={narrow:["1","2","3","4"],abbreviated:["Q1","Q2","Q3","Q4"],wide:["quý I","quý II","quý III","quý IV"]},d={narrow:["1","2","3","4","5","6","7","8","9","10","11","12"],abbreviated:["Thg 1","Thg 2","Thg 3","Thg 4","Thg 5","Thg 6","Thg 7","Thg 8","Thg 9","Thg 10","Thg 11","Thg 12"],wide:["Tháng Một","Tháng Hai","Tháng Ba","Tháng Tư","Tháng Năm","Tháng Sáu","Tháng Bảy","Tháng Tám","Tháng Chín","Tháng Mười","Tháng Mười Một","Tháng Mười Hai"]},i={narrow:["01","02","03","04","05","06","07","08","09","10","11","12"],abbreviated:["thg 1","thg 2","thg 3","thg 4","thg 5","thg 6","thg 7","thg 8","thg 9","thg 10","thg 11","thg 12"],wide:["tháng 01","tháng 02","tháng 03","tháng 04","tháng 05","tháng 06","tháng 07","tháng 08","tháng 09","tháng 10","tháng 11","tháng 12"]},u={narrow:["CN","T2","T3","T4","T5","T6","T7"],short:["CN","Th 2","Th 3","Th 4","Th 5","Th 6","Th 7"],abbreviated:["CN","Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7"],wide:["Chủ Nhật","Thứ Hai","Thứ Ba","Thứ Tư","Thứ Năm","Thứ Sáu","Thứ Bảy"]},s={narrow:{am:"am",pm:"pm",midnight:"nửa đêm",noon:"tr",morning:"sg",afternoon:"ch",evening:"tối",night:"đêm"},abbreviated:{am:"AM",pm:"PM",midnight:"nửa đêm",noon:"trưa",morning:"sáng",afternoon:"chiều",evening:"tối",night:"đêm"},wide:{am:"SA",pm:"CH",midnight:"nửa đêm",noon:"trưa",morning:"sáng",afternoon:"chiều",evening:"tối",night:"đêm"}},c={narrow:{am:"am",pm:"pm",midnight:"nửa đêm",noon:"tr",morning:"sg",afternoon:"ch",evening:"tối",night:"đêm"},abbreviated:{am:"AM",pm:"PM",midnight:"nửa đêm",noon:"trưa",morning:"sáng",afternoon:"chiều",evening:"tối",night:"đêm"},wide:{am:"SA",pm:"CH",midnight:"nửa đêm",noon:"giữa trưa",morning:"vào buổi sáng",afternoon:"vào buổi chiều",evening:"vào buổi tối",night:"vào ban đêm"}},T=function(m,f){var l=Number(m),g=f==null?void 0:f.unit;if(g==="quarter")switch(l){case 1:return"I";case 2:return"II";case 3:return"III";case 4:return"IV"}else if(g==="day")switch(l){case 1:return"thứ 2";case 2:return"thứ 3";case 3:return"thứ 4";case 4:return"thứ 5";case 5:return"thứ 6";case 6:return"thứ 7";case 7:return"chủ nhật"}else{if(g==="week")return l===1?"thứ nhất":"thứ "+l;if(g==="dayOfYear")return l===1?"đầu tiên":"thứ "+l}return String(l)},p={ordinalNumber:T,era:(0,e.default)({values:r,defaultWidth:"wide"}),quarter:(0,e.default)({values:o,defaultWidth:"wide",formattingValues:h,defaultFormattingWidth:"wide",argumentCallback:function(m){return m-1}}),month:(0,e.default)({values:d,defaultWidth:"wide",formattingValues:i,defaultFormattingWidth:"wide"}),day:(0,e.default)({values:u,defaultWidth:"wide"}),dayPeriod:(0,e.default)({values:s,defaultWidth:"wide",formattingValues:c,defaultFormattingWidth:"wide"})},b=p;t.default=b,n.exports=t.default})(C,C.exports);var V=C.exports,N={exports:{}};(function(n,t){var a=v.default;Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var e=a(E),r=a(S),o=/^(\d+)/i,h=/\d+/i,d={narrow:/^(tcn|scn)/i,abbreviated:/^(trước CN|sau CN)/i,wide:/^(trước Công Nguyên|sau Công Nguyên)/i},i={any:[/^t/i,/^s/i]},u={narrow:/^([1234]|i{1,3}v?)/i,abbreviated:/^q([1234]|i{1,3}v?)/i,wide:/^quý ([1234]|i{1,3}v?)/i},s={any:[/(1|i)$/i,/(2|ii)$/i,/(3|iii)$/i,/(4|iv)$/i]},c={narrow:/^(0?[2-9]|10|11|12|0?1)/i,abbreviated:/^thg[ _]?(0?[1-9](?!\d)|10|11|12)/i,wide:/^tháng ?(Một|Hai|Ba|Tư|Năm|Sáu|Bảy|Tám|Chín|Mười|Mười ?Một|Mười ?Hai|0?[1-9](?!\d)|10|11|12)/i},T={narrow:[/0?1$/i,/0?2/i,/3/,/4/,/5/,/6/,/7/,/8/,/9/,/10/,/11/,/12/],abbreviated:[/^thg[ _]?0?1(?!\d)/i,/^thg[ _]?0?2/i,/^thg[ _]?0?3/i,/^thg[ _]?0?4/i,/^thg[ _]?0?5/i,/^thg[ _]?0?6/i,/^thg[ _]?0?7/i,/^thg[ _]?0?8/i,/^thg[ _]?0?9/i,/^thg[ _]?10/i,/^thg[ _]?11/i,/^thg[ _]?12/i],wide:[/^tháng ?(Một|0?1(?!\d))/i,/^tháng ?(Hai|0?2)/i,/^tháng ?(Ba|0?3)/i,/^tháng ?(Tư|0?4)/i,/^tháng ?(Năm|0?5)/i,/^tháng ?(Sáu|0?6)/i,/^tháng ?(Bảy|0?7)/i,/^tháng ?(Tám|0?8)/i,/^tháng ?(Chín|0?9)/i,/^tháng ?(Mười|10)/i,/^tháng ?(Mười ?Một|11)/i,/^tháng ?(Mười ?Hai|12)/i]},p={narrow:/^(CN|T2|T3|T4|T5|T6|T7)/i,short:/^(CN|Th ?2|Th ?3|Th ?4|Th ?5|Th ?6|Th ?7)/i,abbreviated:/^(CN|Th ?2|Th ?3|Th ?4|Th ?5|Th ?6|Th ?7)/i,wide:/^(Chủ ?Nhật|Chúa ?Nhật|thứ ?Hai|thứ ?Ba|thứ ?Tư|thứ ?Năm|thứ ?Sáu|thứ ?Bảy)/i},b={narrow:[/CN/i,/2/i,/3/i,/4/i,/5/i,/6/i,/7/i],short:[/CN/i,/2/i,/3/i,/4/i,/5/i,/6/i,/7/i],abbreviated:[/CN/i,/2/i,/3/i,/4/i,/5/i,/6/i,/7/i],wide:[/(Chủ|Chúa) ?Nhật/i,/Hai/i,/Ba/i,/Tư/i,/Năm/i,/Sáu/i,/Bảy/i]},y={narrow:/^(a|p|nửa đêm|trưa|(giờ) (sáng|chiều|tối|đêm))/i,abbreviated:/^(am|pm|nửa đêm|trưa|(giờ) (sáng|chiều|tối|đêm))/i,wide:/^(ch[^i]*|sa|nửa đêm|trưa|(giờ) (sáng|chiều|tối|đêm))/i},m={any:{am:/^(a|sa)/i,pm:/^(p|ch[^i]*)/i,midnight:/nửa đêm/i,noon:/trưa/i,morning:/sáng/i,afternoon:/chiều/i,evening:/tối/i,night:/^đêm/i}},f={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:h,valueCallback:function(M){return parseInt(M,10)}}),era:(0,e.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,e.default)({matchPatterns:u,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(M){return M+1}}),month:(0,e.default)({matchPatterns:c,defaultMatchWidth:"wide",parsePatterns:T,defaultParseWidth:"wide"}),day:(0,e.default)({matchPatterns:p,defaultMatchWidth:"wide",parsePatterns:b,defaultParseWidth:"wide"}),dayPeriod:(0,e.default)({matchPatterns:y,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"any"})},l=f;t.default=l,n.exports=t.default})(N,N.exports);var B=N.exports;(function(n,t){var a=v.default;Object.defineProperty(t,"__esModule",{value:!0}),t.default=void 0;var e=a(I),r=a(O),o=a(Q),h=a(V),d=a(B),i={code:"vi",formatDistance:e.default,formatLong:r.default,formatRelative:o.default,localize:h.default,match:d.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},u=i;t.default=u,n.exports=t.default})(_,_.exports);var W=_.exports;const F=k(W),R=q({__proto__:null,default:F},[W]);export{R as i};
