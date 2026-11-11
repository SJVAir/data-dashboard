<script lang="ts">
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { handleUndoShortcut } from "$lib/actions/global";
	import { Button } from "$lib/components/ui/button";
	import { formatShortcut } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";

	const app = useApp();
	const session = $derived(app.current.session);
</script>

<svelte:window onkeydown={(event) => handleUndoShortcut(app, event)} />

<div class="flex items-center gap-1">
	<Button
		variant="ghost"
		size="icon"
		aria-label={m.undo()}
		title={formatShortcut("Z")}
		disabled={!session?.canUndo}
		onclick={() => app.current.session?.undo()}
	>
		<Undo2 aria-hidden="true" />
	</Button>
	<Button
		variant="ghost"
		size="icon"
		aria-label={m.redo()}
		title={formatShortcut("Z", { shift: true })}
		disabled={!session?.canRedo}
		onclick={() => app.current.session?.redo()}
	>
		<Redo2 aria-hidden="true" />
	</Button>
</div>
