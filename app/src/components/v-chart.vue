<script setup lang="ts">
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{
	/** Nothing is drawn while null, so a chart with no data yet builds no axis. */
	options: ApexOptions | null;
}>();

const emit = defineEmits<{
	/** After every render and update, as ApexCharts resets what was toggled. */
	drawn: [chart: ApexCharts];
}>();

const canvasEl = ref<HTMLElement | null>(null);
let chartInstance: ApexCharts | null = null;
let chartRendered: Promise<void> = Promise.resolve();
let pointerInside = false;
let redrawOwed = false;

async function drawChart(): Promise<void> {
	if (canvasEl.value === null || props.options === null) {
		return;
	}

	if (chartInstance === null) {
		const createdChart = new ApexCharts(canvasEl.value, props.options);
		chartInstance = createdChart;
		chartRendered = createdChart.render();
		await chartRendered;
		emit('drawn', createdChart);
		return;
	}

	// Options changing while the first render runs would update a chart that
	// has no SVG yet, and one unmounted meanwhile has nothing left to update.
	const drawnChart = chartInstance;
	await chartRendered;

	if (chartInstance !== drawnChart || props.options === null) {
		return;
	}

	// An update rebuilds the tooltip, so a chart being read under the pointer
	// would lose the reading on every refresh. The options keep changing; what
	// they draw is what the pointer leaving asks for.
	if (pointerInside) {
		redrawOwed = true;
		return;
	}

	await drawnChart.updateOptions(props.options, true, false);
	emit('drawn', drawnChart);
}

function holdRedraw(): void {
	pointerInside = true;
}

function releaseRedraw(): void {
	pointerInside = false;

	if (!redrawOwed) {
		return;
	}

	redrawOwed = false;
	void drawChart();
}

onMounted(() => {
	void drawChart();
});

watch(
	() => props.options,
	() => {
		void drawChart();
	},
	{ flush: 'post' },
);

// ApexCharts attaches to the DOM outside Vue's tree, so leaving without this
// leaks the chart and its resize listeners.
onUnmounted(() => {
	chartInstance?.destroy();
	chartInstance = null;
});
</script>

<template>
	<div
		ref="canvasEl"
		@pointerenter="holdRedraw"
		@pointerleave="releaseRedraw"
	/>
</template>
