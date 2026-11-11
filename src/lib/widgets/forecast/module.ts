import type { WidgetModule } from "../registry";
import ForecastWidget from "./ForecastWidget.svelte";

/** The Forecast strip's lazily loaded code. */
export const component: WidgetModule["component"] = ForecastWidget;
