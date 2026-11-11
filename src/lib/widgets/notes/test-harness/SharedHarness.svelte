<script lang="ts">
	import { setContext } from "svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../../shared/viewer";
	import NoteWidget from "../NoteWidget.svelte";

	let { widget }: { widget: WidgetInstance } = $props();
	setContext<PlaceViewer>(PLACE_VIEWER_KEY, "shared");
</script>

<NoteWidget {widget} />
