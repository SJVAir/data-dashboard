<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";

	const app = useApp();

	// Only an editable, stored dashboard has a save status (the starter is never stored).
	const status = $derived.by(() => {
		const { session, isStarter } = app.current;
		return session && !isStarter && !session.readOnly ? session.status : null;
	});
	const label = $derived(
		status === "saving"
			? m.saving()
			: status === "error"
				? m.save_failed()
				: status === "saved"
					? m.saved()
					: ""
	);
</script>

<span
	aria-live="polite"
	class={["text-sm", status === "error" ? "text-destructive" : "text-muted-foreground"]}
>
	{label}
</span>
