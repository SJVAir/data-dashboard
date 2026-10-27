<script module lang="ts">
	const privacy = $state({ open: false });

	/** Opens the "Your data and privacy" dialog (one is mounted in the app root). */
	export function openPrivacy(): void {
		privacy.open = true;
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { openClearData } from "./ClearDataDialog.svelte";

	const app = useApp();
	const noticesUrl = $derived(new URL("THIRD-PARTY-NOTICES.txt", app.staticBase).href);

	function clear() {
		privacy.open = false;
		openClearData();
	}
</script>

<Dialog.Root bind:open={privacy.open}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.privacy_title()}</Dialog.Title>
		</Dialog.Header>
		<div class="grid gap-3 text-sm">
			<p>{m.privacy_local()}</p>
			<p>{m.privacy_server()}</p>
			<p>{m.privacy_errors()}</p>
			<p>{m.privacy_no_tracking()}</p>
			<p>{m.privacy_clear()}</p>
			<p>
				<a href={noticesUrl} target="_blank" rel="noopener" class="underline underline-offset-4">
					{m.privacy_notices_link()}
				</a>
			</p>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={clear}>{m.clear_data_button()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
