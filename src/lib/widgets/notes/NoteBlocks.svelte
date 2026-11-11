<script lang="ts">
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import type { NoteBlock, NoteInline } from "$lib/notes/markdown";

	let { blocks }: { blocks: NoteBlock[] } = $props();
</script>

{#snippet inlines(nodes: NoteInline[])}
	{#each nodes as node, i (i)}
		{#if node.kind === "text"}
			{node.text}
		{:else if node.kind === "break"}
			<br />
		{:else if node.kind === "strong"}
			<strong>{@render inlines(node.children)}</strong>
		{:else if node.kind === "em"}
			<em>{@render inlines(node.children)}</em>
		{:else if node.kind === "link"}
			<a
				href={node.href}
				target="_blank"
				rel="ugc nofollow noopener"
				class="text-primary underline underline-offset-2"
			>
				{@render inlines(node.children)}
				<ExternalLinkCue class="inline size-3.5 align-baseline" />
			</a>
		{/if}
	{/each}
{/snippet}

{#each blocks as block, i (i)}
	{#if block.kind === "heading"}
		<h3 class="text-base font-semibold">{@render inlines(block.children)}</h3>
	{:else if block.kind === "paragraph"}
		<p>{@render inlines(block.children)}</p>
	{:else if block.kind === "list" && block.ordered}
		<ol class="list-decimal ps-6" start={block.start}>
			{#each block.items as item, j (j)}
				<li>{@render inlines(item)}</li>
			{/each}
		</ol>
	{:else if block.kind === "list"}
		<ul class="list-disc ps-6">
			{#each block.items as item, j (j)}
				<li>{@render inlines(item)}</li>
			{/each}
		</ul>
	{/if}
{/each}
