import type { WidgetModule } from "../registry";
import ChartWidget from "./ChartWidget.svelte";

/** The Chart's lazily loaded code: its component, with the data layer and uPlot behind it. */
const module: WidgetModule = { component: ChartWidget };
export const { component } = module;
