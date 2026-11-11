import type { WidgetModule } from "../registry";
import MapWidget from "./MapWidget.svelte";

/**
 * The Map widget's lazily loaded code: map-sdk, MapLibre and their styles load only here.
 * map-sdk's `theme.css` isn't imported: it is Tailwind source (`@theme`, `@utility`), which only
 * `app.css` compiles, and `app.css` already defines the family tokens it would add.
 */
export const component: WidgetModule["component"] = MapWidget;
