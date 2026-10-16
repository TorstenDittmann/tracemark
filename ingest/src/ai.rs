//! Adds `$ai_cost_usd` to AI generation events from their model and token counts.
//!
//! Prices come from the app (built-in list plus each project's overrides) in USD per million
//! tokens. `$ai_input_tokens` counts every input token, including the cached ones counted again
//! in `$ai_cache_read_input_tokens` and `$ai_cache_creation_input_tokens`. A cost the client sent
//! wins.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Map, Value};
use uuid::Uuid;

/// Events that get a cost.
const EVENTS: [&str; 2] = ["$ai_generation", "$ai_embedding"];
pub const COST: &str = "$ai_cost_usd";
const INPUT_COST: &str = "$ai_input_cost_usd";
const OUTPUT_COST: &str = "$ai_output_cost_usd";
const MODEL: &str = "$ai_model";
const INPUT_TOKENS: &str = "$ai_input_tokens";
const OUTPUT_TOKENS: &str = "$ai_output_tokens";
const CACHE_READ_TOKENS: &str = "$ai_cache_read_input_tokens";
const CACHE_WRITE_TOKENS: &str = "$ai_cache_creation_input_tokens";

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Price {
    pub model: String,
    pub input: f64,
    pub output: f64,
    #[serde(default)]
    pub cache_read: Option<f64>,
    #[serde(default)]
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Prices {
    #[serde(default)]
    pub defaults: Vec<Price>,
    /// Each project's overrides, by project id.
    #[serde(default)]
    pub projects: HashMap<Uuid, Vec<Price>>,
}

/// A model name as prices are looked up: lowercase, without a `provider/` prefix.
fn normalize(model: &str) -> String {
    let name = model.trim().to_lowercase();
    match name.rfind('/') {
        Some(slash) => name[slash + 1..].to_owned(),
        None => name,
    }
}

impl Prices {
    /// The price for `model` in `project`: an exact match, else the longest entry the model starts
    /// with. A project's own entry replaces the built-in one of the same name.
    pub fn lookup(&self, project: Uuid, model: &str) -> Option<&Price> {
        let name = normalize(model);
        if name.is_empty() {
            return None;
        }
        let own = self
            .projects
            .get(&project)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let mut best: Option<(usize, &Price)> = None;
        for (rank, price) in own
            .iter()
            .map(|p| (1, p))
            .chain(self.defaults.iter().map(|p| (0, p)))
        {
            let key = normalize(&price.model);
            if key.is_empty() || !name.starts_with(&key) {
                continue;
            }
            // Longer keys win; at equal length the project's own entry does.
            let score = key.len() * 2 + rank;
            if best.is_none_or(|(s, _)| score > s) {
                best = Some((score, price));
            }
        }
        best.map(|(_, price)| price)
    }
}

fn number(props: &Map<String, Value>, key: &str) -> Option<f64> {
    match props.get(key)? {
        Value::Number(n) => n.as_f64().filter(|n| n.is_finite() && *n >= 0.0),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite() && *n >= 0.0),
        _ => None,
    }
}

/// Adds the cost to an AI generation's properties when its model has a price.
pub fn add_cost(event: &str, project: Uuid, props: &mut Map<String, Value>, prices: &Prices) {
    if !EVENTS.contains(&event) {
        return;
    }
    if props.contains_key(COST) {
        // Keep the client's cost, as a number so it lands in the cost column.
        if let Some(cost) = number(props, COST) {
            props.insert(COST.to_owned(), cost.into());
        }
        return;
    }
    let Some(price) = props
        .get(MODEL)
        .and_then(Value::as_str)
        .and_then(|model| prices.lookup(project, model))
    else {
        return;
    };
    let input = number(props, INPUT_TOKENS);
    let output = number(props, OUTPUT_TOKENS);
    if input.is_none() && output.is_none() {
        return;
    }
    let cache_read = number(props, CACHE_READ_TOKENS).unwrap_or(0.0);
    let cache_write = number(props, CACHE_WRITE_TOKENS).unwrap_or(0.0);
    let uncached = (input.unwrap_or(0.0) - cache_read - cache_write).max(0.0);
    let input_cost = (uncached * price.input
        + cache_read * price.cache_read.unwrap_or(price.input)
        + cache_write * price.cache_write.unwrap_or(price.input))
        / 1e6;
    let output_cost = output.unwrap_or(0.0) * price.output / 1e6;
    props.insert(INPUT_COST.to_owned(), input_cost.into());
    props.insert(OUTPUT_COST.to_owned(), output_cost.into());
    props.insert(COST.to_owned(), (input_cost + output_cost).into());
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn price(model: &str, input: f64, output: f64) -> Price {
        Price {
            model: model.into(),
            input,
            output,
            cache_read: None,
            cache_write: None,
        }
    }

    fn prices() -> Prices {
        Prices {
            defaults: vec![
                price("gpt-4o", 2.5, 10.0),
                price("gpt-4o-mini", 0.15, 0.6),
                Price {
                    cache_read: Some(0.3),
                    cache_write: Some(3.75),
                    ..price("claude-sonnet-4-5", 3.0, 15.0)
                },
            ],
            projects: HashMap::from([(Uuid::from_u128(1), vec![price("GPT-4o", 1.0, 1.0)])]),
        }
    }

    fn props(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    fn cost(project: u128, value: Value) -> Map<String, Value> {
        let mut props = props(value);
        add_cost(
            "$ai_generation",
            Uuid::from_u128(project),
            &mut props,
            &prices(),
        );
        props
    }

    fn close(value: Option<&Value>, expected: f64) {
        let actual = value.and_then(Value::as_f64).expect("a number");
        assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
    }

    #[test]
    fn matches_exact_names_then_the_longest_prefix() {
        let prices = prices();
        let other = Uuid::from_u128(2);
        assert_eq!(prices.lookup(other, "gpt-4o").unwrap().input, 2.5);
        assert_eq!(
            prices.lookup(other, "gpt-4o-2024-08-06").unwrap().input,
            2.5
        );
        assert_eq!(
            prices
                .lookup(other, "gpt-4o-mini-2024-07-18")
                .unwrap()
                .input,
            0.15
        );
        assert_eq!(
            prices.lookup(other, "openai/GPT-4o-mini").unwrap().input,
            0.15
        );
        assert_eq!(prices.lookup(other, "gpt-4").map(|p| p.input), None);
        assert_eq!(prices.lookup(other, "").map(|p| p.input), None);
    }

    #[test]
    fn project_prices_replace_built_in_ones_of_the_same_name_only() {
        let prices = prices();
        let project = Uuid::from_u128(1);
        assert_eq!(
            prices.lookup(project, "gpt-4o-2024-08-06").unwrap().input,
            1.0
        );
        assert_eq!(prices.lookup(project, "gpt-4o-mini").unwrap().input, 0.15);
    }

    #[test]
    fn prices_input_output_and_cached_tokens() {
        let props = cost(
            2,
            json!({
                "$ai_model": "claude-sonnet-4-5-20250929",
                "$ai_input_tokens": 1_000_000,
                "$ai_output_tokens": 100_000,
                "$ai_cache_read_input_tokens": 400_000,
                "$ai_cache_creation_input_tokens": 100_000
            }),
        );
        // 500k uncached at $3, 400k read at $0.30, 100k written at $3.75; 100k out at $15.
        close(props.get(INPUT_COST), 1.5 + 0.12 + 0.375);
        close(props.get(OUTPUT_COST), 1.5);
        close(props.get(COST), 1.995 + 1.5);
    }

    #[test]
    fn cached_tokens_default_to_the_input_price() {
        let props = cost(
            2,
            json!({ "$ai_model": "gpt-4o", "$ai_input_tokens": "2000", "$ai_cache_read_input_tokens": 1000 }),
        );
        close(props.get(COST), 2000.0 * 2.5 / 1e6);
    }

    #[test]
    fn leaves_events_without_a_price_or_tokens_alone() {
        let unknown = cost(2, json!({ "$ai_model": "mystery", "$ai_input_tokens": 10 }));
        assert!(!unknown.contains_key(COST));
        let no_tokens = cost(2, json!({ "$ai_model": "gpt-4o" }));
        assert!(!no_tokens.contains_key(COST));
        let mut span = props(json!({ "$ai_model": "gpt-4o", "$ai_input_tokens": 10 }));
        add_cost("$ai_span", Uuid::from_u128(2), &mut span, &prices());
        assert!(!span.contains_key(COST));
    }

    #[test]
    fn keeps_the_clients_cost_as_a_number() {
        let props = cost(
            2,
            json!({ "$ai_model": "gpt-4o", "$ai_input_tokens": 10, "$ai_cost_usd": "0.5" }),
        );
        assert_eq!(props.get(COST), Some(&json!(0.5)));
        assert!(!props.contains_key(INPUT_COST));
    }
}
