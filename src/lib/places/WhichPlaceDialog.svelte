<script lang="ts">
	import { untrack } from "svelte";
	import {
		settleWhichPlace as settle,
		whichPlace as ask
	} from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Label } from "$lib/components/ui/label";
	import * as RadioGroup from "$lib/components/ui/radio-group";
	import type { ChosenPlace } from "$lib/data/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { placeName } from "./bar-name";

	/** Each place's name once looked up (`null`: it can't be named). */
	let names = $state.raw<(string | null)[] | null>(null);
	let value = $state("0");
	/** A place was chosen: the place picker opens next and takes focus. */
	let chosen = false;
	let controller: AbortController | null = null;

	// Each opening starts fresh; closing stops the lookups.
	$effect(() => {
		const open = ask.open;
		void ask.opening;
		untrack(() => {
			controller?.abort();
			controller = null;
			if (!open) return;
			chosen = false;
			value = "0";
			names = null;
			const signal = (controller = new AbortController()).signal;
			void Promise.all(ask.places.map((p) => placeName(p, signal).catch(() => null))).then(
				(found) => {
					if (!signal.aborted) names = found;
				}
			);
		});
	});
	$effect(() => () => controller?.abort());

	function label(place: ChosenPlace, index: number): string {
		const name = names?.[index];
		if (name) return name;
		// Only the dashboard's owner duplicates it, so a point is their own location.
		if (place.kind === "point") return m.which_place_your_location();
		return m.which_place_unnamed({ number: formatNumber(index + 1) });
	}

	function choose(): void {
		const place = ask.places[Number(value)];
		if (!place) return;
		chosen = true;
		settle(place);
	}

	function onCloseAutoFocus(event: Event): void {
		event.preventDefault();
		if (chosen) return;
		const opener = ask.opener;
		if (opener?.isConnected) opener.focus();
	}
</script>

<!-- Closing it any other way (Escape, outside click) is no choice: it resolves `null`. -->
<Dialog.Root
	bind:open={ask.open}
	onOpenChange={(open) => {
		if (!open) settle(null);
	}}
>
	<Dialog.Content data-which-place-dialog {onCloseAutoFocus}>
		<Dialog.Header>
			<Dialog.Title id="which-place-title">{m.which_place_replace_title()}</Dialog.Title>
			<Dialog.Description id="which-place-description">
				{m.which_place_replace_description()}
			</Dialog.Description>
		</Dialog.Header>
		{#if names}
			<RadioGroup.Root
				bind:value
				aria-labelledby="which-place-title"
				aria-describedby="which-place-description"
			>
				{#each ask.places as place, i (i)}
					<div class="flex items-center gap-3">
						<RadioGroup.Item value={String(i)} id="which-place-{i}" />
						<Label for="which-place-{i}" class="font-normal">{label(place, i)}</Label>
					</div>
				{/each}
			</RadioGroup.Root>
		{:else}
			<p role="status" class="text-muted-foreground text-sm">{m.place_picker_dialog_loading()}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => settle(null)}>{m.which_place_cancel()}</Button>
			<Button disabled={!names} onclick={choose}>{m.which_place_continue()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
