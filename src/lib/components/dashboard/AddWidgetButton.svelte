<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import { addWidget, startGetData } from "$lib/actions/dashboard";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { addWidgetEntries } from "$lib/widgets/registry";

	let { variant = "outline" }: { variant?: "outline" | "default" } = $props();

	const app = useApp();
	// Types register when the app starts, before this renders.
	// Data types open Get data unless they're also addable; the others are added directly.
	const types = addWidgetEntries().map(({ type, direct }) => ({
		type,
		run: () => (direct ? addWidget(app, type.type) : startGetData(app, type.type))
	}));
</script>

<!-- The types that can be added (in registration order); until one registers, nothing can be, so it's disabled. -->
<DropdownMenu.Root>
	<DropdownMenu.Trigger class={buttonVariants({ variant })} disabled={types.length === 0}>
		<Plus aria-hidden="true" />
		{m.add_widget()}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="min-w-48">
		{#each types as { type, run } (type.type)}
			<DropdownMenu.Item onSelect={run}>
				<type.icon aria-hidden="true" />
				{type.label()}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
