<script lang="ts">
	let { map, framed = true }: { map: unknown; framed?: boolean } = $props();
</script>

<p data-legend data-framed={framed} data-has-map={map ? "" : undefined}>PM2.5 legend</p>
