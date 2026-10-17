<script lang="ts">
import StatusPill from '#lib/components/status-pill.svelte';
import type { ExperimentStatus } from '#lib/experiments.js';

let { status }: { status: ExperimentStatus } = $props();

const labels: Record<ExperimentStatus, string> = {
	draft: 'Draft',
	running: 'Running',
	complete: 'Complete'
};
</script>

<StatusPill
	tone={status === 'running' ? 'primary' : status === 'complete' ? 'success' : 'muted'}
	pulse={status === 'running'}
>
	{labels[status]}
</StatusPill>
