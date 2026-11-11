import type { WidgetModule } from "../registry";
import MapPlaceholder from "./MapPlaceholder.svelte";

/** The Map widget's lazily loaded code (a placeholder until the map itself is wired in). */
export const component: WidgetModule["component"] = MapPlaceholder;
