# Experiments

An experiment compares the variants of a feature flag. Pick a flag with at least two variants
(for example `control` and `test`), add the metrics you care about, and launch it.

## What gets counted

- **Exposure.** A person is in the experiment once they were served one of the flag's variants,
  recorded by the `$feature_flag_called` event the browser and Node SDKs send when your code reads
  a flag. Each person counts in the first variant they were served while the experiment ran;
  people first served `false` or a value that isn't one of the variants are left out.
- **Metrics.** Only events after a person's first exposure, up to when the experiment stopped,
  count.
  - _Conversion_: the share of exposed people who did the event at least once.
  - _Count per person_: how many times they did it, divided by the exposed people.

Anonymous ids that were later identified count as the person they identified as.

## Reading the results

Results are Bayesian. Each variant's rate gets a posterior from a flat prior (Beta for
conversions, Gamma for counts), and footprint draws 20,000 samples from each to report:

- **95% interval**: where the true rate most likely lies.
- **Chance to be best**: how often that variant's sample came out highest. At 95% or more the
  page calls the variant very likely best.

The sampling is seeded, so the same data always shows the same numbers.

## Launching and stopping

Launching sets the start of the results window to now and turns the flag on if it was off.
Stopping freezes the window; the flag keeps serving variants until you change it, so roll out the
winner from the flag's page.

The sample size calculator gives the people each variant needs to detect a relative change in a
conversion rate at a 5% significance level with 80% power.
