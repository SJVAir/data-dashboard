<script lang="ts">
	import { p, isActive } from "../../router";

	let { onNavigate }: { onNavigate?: () => void } = $props();

	const links = [
		{ href: "/", label: "Monitors" },
		{ href: "/hms", label: "HMS Smoke/Fire" },
		{ href: "/collocation-sites", label: "Collocation Sites" }
	] as const;
</script>

<ul class="flex flex-col gap-1">
	{#each links as link (link.href)}
		<li>
			<a
				href={p(link.href)}
				class="hover:bg-muted block rounded-md px-3 py-2 font-medium"
				class:bg-accent={isActive(link.href)}
				aria-current={isActive(link.href) ? "page" : undefined}
				onclick={onNavigate}
			>
				{link.label}
			</a>
		</li>
	{/each}
</ul>
