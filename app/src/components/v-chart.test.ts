import { flushPromises, mount } from '@vue/test-utils';
import ApexCharts from 'apexcharts';
import { beforeEach, expect, test, vi } from 'vitest';
import VChart from './v-chart.vue';

const apex = vi.hoisted(() => {
	return { render: vi.fn(), updateOptions: vi.fn(), destroy: vi.fn() };
});

// jsdom has no layout to draw into, so the chart is stubbed down to the calls
// the component makes.
vi.mock('apexcharts', () => {
	return {
		default: vi.fn(function (this: Record<string, unknown>) {
			this.render = apex.render;
			this.updateOptions = apex.updateOptions;
			this.destroy = apex.destroy;
		}),
	};
});

beforeEach(() => {
	vi.mocked(ApexCharts).mockClear();
	apex.render.mockClear();
	apex.updateOptions.mockClear();
	apex.destroy.mockClear();
});

test('renders the first options once, without an update', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	expect(ApexCharts).toHaveBeenCalledTimes(1);
	expect(ApexCharts).toHaveBeenCalledWith(wrapper.element, { series: [1] });
	expect(apex.render).toHaveBeenCalledTimes(1);
	expect(apex.updateOptions).not.toHaveBeenCalled();
});

test('builds nothing until it is given options', async () => {
	const wrapper = mount(VChart, { props: { options: null } });
	await flushPromises();

	expect(ApexCharts).not.toHaveBeenCalled();

	await wrapper.setProps({ options: { series: [1] } });
	await flushPromises();

	expect(ApexCharts).toHaveBeenCalledWith(wrapper.element, { series: [1] });
	expect(apex.render).toHaveBeenCalledTimes(1);
	expect(apex.updateOptions).not.toHaveBeenCalled();
});

// Nothing is under the pointer yet, so nothing is lost by drawing it.
test('builds the chart even with the pointer already over it', async () => {
	const wrapper = mount(VChart, { props: { options: null } });
	await flushPromises();

	await wrapper.trigger('pointerenter');
	await wrapper.setProps({ options: { series: [1] } });
	await flushPromises();

	expect(apex.render).toHaveBeenCalledTimes(1);
});

test('updates the chart when the options change', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	await wrapper.setProps({ options: { series: [2] } });
	await flushPromises();

	expect(ApexCharts).toHaveBeenCalledTimes(1);
	expect(apex.updateOptions).toHaveBeenCalledTimes(1);
	expect(apex.updateOptions).toHaveBeenCalledWith({ series: [2] }, true, false);
});

test('updates a chart only once its first render has drawn it', async () => {
	let finishRender: () => void = () => undefined;

	apex.render.mockReturnValueOnce(new Promise<void>((resolve) => {
		finishRender = resolve;
	}));

	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await wrapper.setProps({ options: { series: [2] } });
	await flushPromises();

	expect(apex.updateOptions).not.toHaveBeenCalled();

	finishRender();
	await flushPromises();

	expect(apex.updateOptions).toHaveBeenCalledWith({ series: [2] }, true, false);
});

test('holds the update while the pointer is over the chart', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	await wrapper.trigger('pointerenter');
	await wrapper.setProps({ options: { series: [2] } });
	await flushPromises();

	expect(apex.updateOptions).not.toHaveBeenCalled();
});

test('applies the latest held options once when the pointer leaves', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	await wrapper.trigger('pointerenter');
	await wrapper.setProps({ options: { series: [2] } });
	await flushPromises();
	await wrapper.setProps({ options: { series: [3] } });
	await flushPromises();
	await wrapper.trigger('pointerleave');
	await flushPromises();

	expect(apex.updateOptions).toHaveBeenCalledTimes(1);
	expect(apex.updateOptions).toHaveBeenCalledWith({ series: [3] }, true, false);

	// The page re-applies what it hid on this, so the owed redraw announces too.
	expect(wrapper.emitted('drawn')).toHaveLength(2);

	// The held redraw is paid off, so the next visit owes nothing.
	await wrapper.trigger('pointerenter');
	await wrapper.trigger('pointerleave');
	await flushPromises();

	expect(apex.updateOptions).toHaveBeenCalledTimes(1);
});

test('asks for no redraw when the pointer leaves with nothing held', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	await wrapper.trigger('pointerenter');
	await wrapper.trigger('pointerleave');
	await flushPromises();

	expect(apex.updateOptions).not.toHaveBeenCalled();
});

test('hands the chart over after the render and after each update', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	await wrapper.setProps({ options: { series: [2] } });
	await flushPromises();

	const createdChart = vi.mocked(ApexCharts).mock.instances[0];

	expect(wrapper.emitted('drawn')).toHaveLength(2);
	expect(wrapper.emitted('drawn')![0]![0]).toBe(createdChart);
	expect(wrapper.emitted('drawn')![1]![0]).toBe(createdChart);
});

test('destroys the chart when it goes away', async () => {
	const wrapper = mount(VChart, { props: { options: { series: [1] } } });
	await flushPromises();

	wrapper.unmount();

	expect(apex.destroy).toHaveBeenCalledTimes(1);
});
