<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';

let { projectId }: { projectId: string } = $props();

const views = $derived([
	{ href: `/projects/${projectId}/persons`, label: 'People' },
	{ href: `/projects/${projectId}/cohorts`, label: 'Cohorts' }
]);
</script>

<div><SubNav links={views} label="People views" exact={false} /></div>
