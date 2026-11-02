<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";

	const app = useApp();
	/** How many dashboards the question counts (`null`: not asking). */
	let shown = $state<number | null>(null);
	let open = $state(false);

	// Asked once the app starts in an account space; the code loads only then.
	onMount(() => {
		const space = app.space;
		if (space === "anonymous") return;
		let gone = false;
		void (async () => {
			try {
				const { moveOffer } = await import("$lib/sync/move-to-account");
				const offer = await moveOffer(app.platform, space);
				if (gone || !offer) return;
				shown = offer.shown;
				open = true;
			} catch (error) {
				// Asked again the next time the app starts.
				report(error, { operation: "move-offer" });
			}
		})();
		return () => (gone = true);
	});

	async function answer(choice: "yes" | "no") {
		open = false;
		try {
			const { answerMoveOffer } = await import("$lib/sync/move-to-account");
			await answerMoveOffer(app, choice);
		} catch (error) {
			report(error, { operation: "move-to-account" });
			toast.error(m.move_offer_failed());
		}
	}
</script>

<!-- Escape or an outside click dismisses it with no answer: it's asked again next time. -->
<Dialog.Root bind:open>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{m.move_offer_title()}</Dialog.Title>
			{#if shown !== null}
				<Dialog.Description>
					{m.move_offer_body({ count: formatNumber(shown), countValue: shown })}
				</Dialog.Description>
			{/if}
			<p class="text-muted-foreground text-sm">{m.move_offer_detail()}</p>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => answer("no")}>{m.move_offer_no()}</Button>
			<Button onclick={() => answer("yes")}>{m.move_offer_yes()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
