import type { WidgetModule } from "../registry";
import OutsideWidget from "./OutsideWidget.svelte";

/** "Can we go outside?"'s lazily loaded code. */
export const component: WidgetModule["component"] = OutsideWidget;
