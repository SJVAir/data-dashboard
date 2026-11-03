<script lang="ts">
	import { onMount } from "svelte";
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
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
