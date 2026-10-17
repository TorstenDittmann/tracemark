use std::net::SocketAddr;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use tracemark_ingest::config::Config;
use tracemark_ingest::enrich::Enricher;
use tracemark_ingest::keys::{self, KeySource, KeyStore};
use tracemark_ingest::protocol::MAX_EVENTS;
use tracemark_ingest::routes::{self, AppState};
use tracemark_ingest::writer::{self, ClickHouse, WriterSettings};
use tokio::sync::mpsc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("tracemark-ingest: {error}");
            return ExitCode::FAILURE;
        }
    };
    init_tracing(config.log_json);

    match serve(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "fatal");
            ExitCode::FAILURE
        }
    }
}

fn init_tracing(json: bool) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if json {
        builder.json().init();
    } else {
        builder.init();
    }
}

async fn serve(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()?;

    let keys = KeyStore::new();
    let poller = tokio::spawn(keys::poll(
        KeySource {
            client: client.clone(),
            app_internal_url: config.app_internal_url.clone(),
            internal_token: config.internal_token.clone(),
        },
        keys.clone(),
        config.key_refresh,
    ));

    let clickhouse = ClickHouse::new(
        client,
        reqwest::Url::parse(&config.clickhouse_url)?,
        &config.clickhouse_database,
        &config.clickhouse_user,
        &config.clickhouse_password,
    );
    // A full batch must always fit, otherwise it could never be enqueued.
    let (events, rx) = mpsc::channel(config.queue_capacity.max(MAX_EVENTS));
    let writer = tokio::spawn(writer::run(
        rx,
        clickhouse,
        WriterSettings {
            flush_interval: config.flush_interval,
            max_rows: config.flush_max_rows,
            spill_dir: config.spill_dir.clone(),
            retry_backoff: Duration::from_millis(500),
        },
    ));

    let enricher = Enricher::open(config.geoip_db.as_deref())
        .map_err(|error| format!("cannot open GEOIP_DB: {error}"))?
        .with_address_header(config.address_header.clone(), config.xff_depth);
    if !enricher.has_geoip() {
        tracing::info!("GEOIP_DB not set; events get no location properties");
    }
    let app = routes::router(AppState {
        keys,
        events,
        enricher: Arc::new(enricher),
    });
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    // The router (and with it the last event sender) is gone, so the writer
    // flushes its buffer and exits.
    tracing::info!("server stopped; waiting for writer to finish");
    poller.abort();
    writer.await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}
