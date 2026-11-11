import type { WidgetModule } from "../registry";
import DataTable from "./DataTable.svelte";

/** The Data table's lazily loaded code: its component, with the data layer behind it. */
export const component: WidgetModule["component"] = DataTable;
