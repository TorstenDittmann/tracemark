// Bayesian experiment statistics: conversion rates (Beta-Binomial) and counts per person
// (Gamma-Poisson), summarized by sampling the posteriors with a seeded generator so the same
// data always gives the same numbers.

export const SAMPLES = 20_000;

/** A small, fast seeded PRNG (mulberry32) returning floats in [0, 1). */
export function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function normal(rand: () => number): number {
	// Box-Muller; 1 - rand() keeps the logarithm finite.
	return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** A Gamma(shape, 1) sample (Marsaglia and Tsang). */
export function gamma(rand: () => number, shape: number): number {
	if (shape < 1) return gamma(rand, shape + 1) * (1 - rand()) ** (1 / shape);
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let x: number;
		let v: number;
		do {
			x = normal(rand);
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = 1 - rand();
		if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
	}
}

export function beta(rand: () => number, a: number, b: number): number {
	const x = gamma(rand, a);
	return x / (x + gamma(rand, b));
}

function quantile(sorted: Float64Array, q: number): number {
	const at = (sorted.length - 1) * q;
	const low = Math.floor(at);
	const high = Math.ceil(at);
	return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

export interface VariantSummary {
	key: string;
	/** Exposed people. */
	people: number;
	/** Conversions, or events for a count metric. */
	value: number;
	/** Observed rate: conversions or events per exposed person. */
	rate: number;
	/** 95% credible interval of the true rate. */
	interval: [number, number];
	/** Chance this variant's true rate is the highest. */
	chanceToBeBest: number;
}

/** Summaries for posterior samples drawn per variant by `draw`. */
function summarize(
	variants: { key: string; people: number; value: number }[],
	draw: (variant: { people: number; value: number }) => number,
	samples: number
): VariantSummary[] {
	const draws = variants.map(() => new Float64Array(samples));
	const wins = variants.map(() => 0);
	for (let s = 0; s < samples; s++) {
		let best = 0;
		for (const [i, variant] of variants.entries()) {
			const value = draw(variant);
			(draws[i] as Float64Array)[s] = value;
			if (value > ((draws[best] as Float64Array)[s] ?? 0)) best = i;
		}
		wins[best] = (wins[best] ?? 0) + 1;
	}
	return variants.map((variant, i) => {
		const sorted = (draws[i] as Float64Array).sort();
		return {
			key: variant.key,
			people: variant.people,
			value: variant.value,
			rate: variant.people ? variant.value / variant.people : 0,
			interval: [quantile(sorted, 0.025), quantile(sorted, 0.975)],
			chanceToBeBest: (wins[i] ?? 0) / samples
		};
	});
}

/**
 * Conversion metric: each variant's conversion rate has a Beta(1 + conversions,
 * 1 + non-conversions) posterior, starting from a uniform prior.
 */
export function conversionResults(
	variants: { key: string; people: number; value: number }[],
	{ samples = SAMPLES, seed = 1 } = {}
): VariantSummary[] {
	const rand = random(seed);
	return summarize(
		variants,
		(v) => beta(rand, 1 + v.value, 1 + Math.max(0, v.people - v.value)),
		samples
	);
}

/**
 * Count metric: events per person, with a Gamma(1 + events, people) posterior on the rate of
 * a Poisson process (a nearly flat prior).
 */
export function countResults(
	variants: { key: string; people: number; value: number }[],
	{ samples = SAMPLES, seed = 1 } = {}
): VariantSummary[] {
	const rand = random(seed);
	return summarize(variants, (v) => gamma(rand, 1 + v.value) / Math.max(v.people, 1e-9), samples);
}

/**
 * People needed per variant to detect a relative change `mde` from a `baseline` conversion
 * rate with a two-sided 5% significance level and 80% power.
 */
export function sampleSize(baseline: number, mde: number): number | null {
	const p1 = baseline;
	const p2 = baseline * (1 + mde);
	if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1 && p1 !== p2)) return null;
	const alpha = 1.959964; // z for 97.5%
	const power = 0.841621; // z for 80%
	const mean = (p1 + p2) / 2;
	const n =
		(alpha * Math.sqrt(2 * mean * (1 - mean)) + power * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
			2 /
		(p2 - p1) ** 2;
	return Math.ceil(n);
}
