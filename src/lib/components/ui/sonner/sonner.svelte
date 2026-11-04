<script lang="ts">
	import { onMount } from "svelte";
	import { Toaster as Sonner, toast, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { announce } from "$lib/a11y/announcer.svelte";
	import Loader2Icon from "@lucide/svelte/icons/loader-2";
	import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
	import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
	import InfoIcon from "@lucide/svelte/icons/info";
	import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

	let { ...restProps }: SonnerProps = $props();

	// Toasts follow the page's mode: the `data-theme` override on <html>, else the system scheme.
	// (Not mode-watcher: it keeps its own choice in localStorage, which throws when storage is
	// blocked, and never sees the dashboard's override.)
	let theme = $state<"light" | "dark">("light");
	onMount(() => {
		const root = document.documentElement;
		const system = matchMedia("(prefers-color-scheme: dark)");
		const update = () => {
			const forced = root.getAttribute("data-theme");
			theme = forced === "light" || forced === "dark" ? forced : system.matches ? "dark" : "light";
		};
		update();
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
		system.addEventListener("change", update);
		return () => {
			observer.disconnect();
			system.removeEventListener("change", update);
		};
	});

	// The toaster's own live region is outside every dialog, so a modal dialog cuts it off from
	// screen readers. A toast shown while a dialog is open is also read from the dialog's region
	// (`onlyInDialog`: with no dialog open, the toaster's region reads it, once).
	// `getActiveToasts` reads svelte-sonner's toast state, so this effect reruns on each change.
	// Plain sets on purpose: what was already read is bookkeeping, not something to react to.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let seen = new Set<string>();
	$effect(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const shown = new Set<string>();
		for (const t of toast.getActiveToasts()) {
			const words = [t.title, t.description].filter((x): x is string => typeof x === "string");
			if (words.length === 0) continue;
			const key = `${t.id}\n${words.join("\n")}`;
			shown.add(key);
			if (!seen.has(key)) announce(words.join(" "), { onlyInDialog: true });
		}
		seen = shown;
	});
</script>

<Sonner
	{theme}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-card-border); --border-radius: var(--radius);"
	toastOptions={{
		classes: {
			toast: "cn-toast"
		}
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
