---
name: reference_directus_apexcharts_tooltip_quirks
description: ApexCharts 4.7.0's updateOptions() rebuilds the tooltip on every call, killing a hover mid live-refresh; the tooltip's marker dot is a text glyph that rides above its label unless replaced with a real shape
metadata:
  author: Jean Claveau
  type: reference
---

Found while polishing the Processes page's live charts
([[project_directus_pr467_autoscale_config_surface]]).

**Tooltip disappears on every refresh tick.** `chart.updateOptions()` rebuilds
ApexCharts' tooltip DOM on each call, so a chart polled on a refresh interval
loses whatever tooltip the user is currently reading the instant new data
arrives. Fix: hold the redraw of only the chart under the pointer
(`@pointerenter`/`@pointerleave` on the chart's own element setting a
`reading: ChartName | null` ref), let the other charts keep updating normally,
and catch the held one up the moment the pointer leaves
(`heldRedraw` flag → re-render on `pointerleave`). Samples keep accumulating
underneath; only the redraw is deferred.

**Tooltip marker dot rides above its label.** The series-colour marker is
drawn as a `●` glyph (`content: "\25CF"`) at `font-size: 26px` inside a `16px`
box with `line-height: 14px` — its optical centre sits well above the text
baseline it's next to. Colour arrives as an inline `style.color` (only
`tooltip.fillSeriesColor` would set `backgroundColor`, not used here). Fixed
by replacing the glyph with a real shape that inherits the colour instead of
drawing it as oversized text:

```css
.chart :deep(.apexcharts-tooltip-marker) {
    inline-size: 10px;
    block-size: 10px;
    border-radius: 50%;
    background: currentcolor;
}
.chart :deep(.apexcharts-tooltip-marker::before) {
    content: none;
}
```
