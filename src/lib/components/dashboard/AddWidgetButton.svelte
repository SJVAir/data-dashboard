<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import { addWidget } from "$lib/actions/dashboard";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";

	let { variant = "outline" }: { variant?: "outline" | "default" } = $props();

	const app = useApp();
</script>

<Button {variant} onclick={() => addWidget(app)}>
	<Plus aria-hidden="true" />
	{m.add_widget()}
</Button>
