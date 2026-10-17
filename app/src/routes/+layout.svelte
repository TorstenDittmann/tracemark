<script lang="ts">
import './layout.css';
import { ModeWatcher } from 'mode-watcher';
import favicon from '#lib/assets/favicon.svg';
import NavProgress from '#lib/components/shell/nav-progress.svelte';
import { Toaster } from '#lib/components/ui/sonner/index.js';
import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon}>
</svelte:head>

<ModeWatcher />
<NavProgress />
<Toaster richColors closeButton position="bottom-right" />

{@render children()}
