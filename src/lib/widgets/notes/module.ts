import type { WidgetModule } from "../registry";
import NoteWidget from "./NoteWidget.svelte";

/** The Note widget's lazily loaded code (with the Markdown parser). */
export const component: WidgetModule["component"] = NoteWidget;
