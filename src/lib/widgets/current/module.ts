import type { WidgetModule } from "../registry";
import CurrentWidget from "./CurrentWidget.svelte";

/** The Current conditions tile's lazily loaded code. */
export const component: WidgetModule["component"] = CurrentWidget;
