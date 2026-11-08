<script lang="ts">
	import XIcon from "@lucide/svelte/icons/x";
	import type { PesticideSearchHit, PesticideSearchType } from "@sjvair/sdk/pesticides";
	import { Combobox } from "bits-ui";
	import { searchPesticides } from "./sources";
	import { m } from "$lib/paraglide/messages.js";

	/** Results asked for per search (the server's cap). */
	const LIMIT = 25;
	/** A search starts after this many characters (the SDK sends none before). */
	const MIN_QUERY = 2;
	/** Typing pauses this long before a search goes out. */
	const DEBOUNCE_MS = 250;

	let {
		type,
		label,
		value,
		name,
		onchange
	}: {
		/** What the server searches: chemicals, crops (commodities) or products. */
		type: PesticideSearchType;
		label: string;
		/** The chosen id, if any. */
		value: string | undefined;
		/** The chosen id's display name, once known. */
		name: string | undefined;
		onchange: (id: string | undefined, name?: string) => void;
	} = $props();

	const uid = $props.id();
	const inputId = `${uid}-input`;
	const statusId = `${uid}-status`;

	let open = $state(false);
	let query = $state("");
	let results = $state.raw<PesticideSearchHit<PesticideSearchType>[]>([]);
	let more = $state(false);
	let status = $state<"idle" | "searching" | "done" | "error">("idle");

	// A search per pause in typing; the previous one is dropped.
	$effect(() => {
		const q = query.trim();
		if (q.length < MIN_QUERY) {
			results = [];
			more = false;
			status = "idle";
			return;
		}
		const controller = new AbortController();
		status = "searching";
		const timer = setTimeout(() => {
			searchPesticides({ type, q, limit: LIMIT, signal: controller.signal }).then(
				(found) => {
					// A search the next one replaced (or the picker closed) is dropped.
					if (controller.signal.aborted) return;
					// Placeholder chemicals ("unknown", "confidential") aren't offered.
					results = found.results.filter((hit) => !("placeholder" in hit && hit.placeholder));
					more = found.more;
					status = "done";
				},
				() => {
					if (controller.signal.aborted) return;
					results = [];
					more = false;
					status = "error";
				}
			);
		}, DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	const statusText = $derived(
		status === "searching"
			? m.get_data_search_searching()
			: status === "error"
				? m.get_data_search_error()
				: status === "done" && results.length === 0
					? m.get_data_search_none()
					: status === "done" && more
						? m.get_data_search_more()
						: ""
	);

	function pick(id: string) {
		if (!id) return;
		const hit = results.find((r) => r.id === id);
		onchange(id, hit?.name);
		query = "";
	}

	function clear() {
		onchange(undefined);
		query = "";
		document.getElementById(inputId)?.focus();
	}
</script>

<div class="flex flex-col gap-1">
	<label for={inputId} class="text-xs font-medium">{label}</label>
	<Combobox.Root
		type="single"
		value={value ?? ""}
		onValueChange={pick}
		bind:open
		inputValue={name ?? ""}
	>
		<div class="flex items-center gap-1">
			<Combobox.Input
				id={inputId}
				oninput={(e) => (query = e.currentTarget.value)}
				placeholder={m.get_data_search_hint()}
				aria-describedby={statusText ? statusId : undefined}
				class="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-ring text-field h-8 w-full min-w-0 rounded-(--radius-control) border px-2 focus-visible:outline-2 md:text-sm"
			/>
			{#if value}
				<button
					type="button"
					class="text-muted-foreground hover:bg-secondary focus-visible:outline-ring inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-control) focus-visible:outline-2"
					aria-label={m.get_data_search_clear({ label })}
					onclick={clear}
				>
					<XIcon class="size-4" aria-hidden="true" />
				</button>
			{/if}
		</div>
		<Combobox.Portal>
			<Combobox.Content
				sideOffset={4}
				class="bg-popover text-popover-foreground border-card-border shadow-card z-50 max-h-72 w-(--bits-combobox-anchor-width) min-w-48 overflow-y-auto rounded-(--radius-control) border p-1"
			>
				{#each results as hit (hit.id)}
					<Combobox.Item
						value={hit.id}
						label={hit.name}
						class="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex min-h-8 shrink-0 cursor-default flex-col justify-center rounded-(--radius-control) px-2 py-1 text-sm"
					>
						<span>{hit.name}</span>
						{#if hit.detail}
							<span class="text-muted-foreground text-xs">{hit.detail}</span>
						{/if}
					</Combobox.Item>
				{/each}
				{#if results.length === 0}
					<p class="text-muted-foreground px-2 py-1 text-sm">
						{statusText || m.get_data_search_hint()}
					</p>
				{/if}
			</Combobox.Content>
		</Combobox.Portal>
	</Combobox.Root>
	<p id={statusId} role="status" class="text-muted-foreground min-h-4 text-xs">{statusText}</p>
</div>
