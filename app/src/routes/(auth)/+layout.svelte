<script lang="ts">
import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-12">
	<p class="text-lg font-semibold tracking-tight">footprint</p>
	<div class="w-full max-w-sm">{@render children()}</div>
</main>
