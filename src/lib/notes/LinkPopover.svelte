<script lang="ts">
	import type { Snippet } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import * as Popover from "$lib/components/ui/popover";
	import { m } from "$lib/paraglide/messages.js";
	import { addressFrom } from "./editor";

	let {
		open = $bindable(false),
		current,
		onapply,
		onremove,
		onclosed,
		trigger
	}: {
		open?: boolean;
		/** The address of the link the selection is in, if any. */
		current: string | null;
		/** Links the selection; `false` when the address isn't one a Note accepts. */
		onapply: (url: string) => boolean;
		onremove: () => void;
		/** After it closes (focus goes back to the note's text). */
		onclosed: () => void;
		/** The button that opens it (the toolbar's Link button), given the trigger's props. */
		trigger: Snippet<[Record<string, unknown>]>;
	} = $props();

	const id = $props.id();
	let value = $state("");
	let invalid = $state(false);

	// Each opening starts from the selection's link.
	$effect(() => {
		if (!open) return;
		value = current ?? "";
		invalid = false;
	});

	function apply(event: SubmitEvent): void {
		event.preventDefault();
		const text = value.trim();
		if (text === "") {
			if (current !== null) onremove();
			open = false;
			return;
		}
		if (!onapply(addressFrom(text))) {
			invalid = true;
			return;
		}
		open = false;
	}

	function remove(): void {
		onremove();
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			{@render trigger(props)}
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="end"
		class="w-80 motion-reduce:animate-none"
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			onclosed();
		}}
	>
		<form class="flex flex-col gap-2" onsubmit={apply} novalidate>
			<Label for="{id}-address">{m.note_link_address()}</Label>
			<Input
				id="{id}-address"
				type="url"
				inputmode="url"
				autocomplete="url"
				bind:value
				aria-invalid={invalid}
				aria-describedby={invalid ? `${id}-error` : undefined}
				oninput={() => (invalid = false)}
			/>
			<!-- Rendered empty first, so the message is announced when it appears. -->
			<p id="{id}-error" role="status" class="text-destructive text-xs">
				{#if invalid}{m.note_link_invalid()}{/if}
			</p>
			<div class="flex flex-wrap justify-end gap-2">
				{#if current !== null}
					<Button type="button" variant="outline" size="sm" onclick={remove}>
						{m.note_link_remove()}
					</Button>
				{/if}
				<Button type="submit" size="sm">{m.note_link_apply()}</Button>
			</div>
		</form>
	</Popover.Content>
</Popover.Root>
