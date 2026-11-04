<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import { addWidget } from "$lib/actions/dashboard";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { addableWidgetTypes } from "$lib/widgets/registry";

	let { variant = "outline" }: { variant?: "outline" | "default" } = $props();

	const app = useApp();
	// Types register when the app starts, before this renders.
	const types = addableWidgetTypes();
</script>

<!-- The types that can be added; until one registers, nothing can be, so it's disabled. -->
<DropdownMenu.Root>
	<DropdownMenu.Trigger class={buttonVariants({ variant })} disabled={types.length === 0}>
		<Plus aria-hidden="true" />
		{m.add_widget()}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="min-w-48">
		{#each types as type (type.type)}
			<DropdownMenu.Item onSelect={() => addWidget(app, type.type)}>
				<type.icon aria-hidden="true" />
				{type.label()}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
