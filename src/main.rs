use std::error::Error;
use std::fs;
use std::env;
use std::time::Duration;
use tonic::transport::{Certificate, Channel, ClientTlsConfig};
use axum::{routing::post, Router, Json, response::IntoResponse};
use tower_http::services::ServeDir;
use serde::Deserialize;
use reqwest::Client;

pub mod vector_api {
    tonic::include_proto!("anki.vector.external_interface");
}

pub mod setup_api {
    tonic::include_proto!("anki.vector.setup");
}

pub mod vla;
pub mod llm;
pub mod stt;
pub mod ble_api;

#[derive(Deserialize)]
struct ProvisionPayload {
    ip: String,
}

async fn handle_provision(Json(payload): Json<ProvisionPayload>) -> impl IntoResponse {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();

    let cert_url = format!("https://{}:443/session/certificate", payload.ip);
    match client.get(&cert_url).send().await {
        Ok(resp) => {
            if let Ok(cert_text) = resp.text().await {
                let _ = fs::write("vector-cert.pem", cert_text);
                let env_content = format!(
                    "VECTOR_IP={}\nVECTOR_GUID=placeholder-guid\nVECTOR_CERT_PATH=vector-cert.pem\nSERVER_PORT={}\n",
                    payload.ip, env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string())
                );
                let _ = fs::write(".env", env_content);
                return "Provisioning successful. Restart xpod.".into_response();
            }
        },
        Err(e) => return format!("Failed: {}", e).into_response(),
    }
    "Failed to retrieve certificate".into_response()
}

async fn run_server() {
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let app = Router::new()
        .route("/api/provision", post(handle_provision))
        .route("/api/ble/init", axum::routing::get(ble_api::init_ble))
        .route("/api/ble/scan", post(ble_api::scan_ble))
        .route("/api/ble/connect", axum::routing::get(ble_api::connect_ble))
        .route("/api/ble/send_pin", axum::routing::get(ble_api::send_pin))
        .route("/api/ble/connect_wifi", axum::routing::get(ble_api::connect_wifi))
        .route("/api/ble/disconnect", axum::routing::get(ble_api::disconnect_ble))
        .fallback_service(ServeDir::new("web_ui"));
        
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Failed to bind to port");
    println!("Web UI listening on http://{}", addr);
    
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Server error: {}", e);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenvy::dotenv().ok();
    println!("Starting xpod: Vector Visual-Language-Action Server...");

    let vector_ip = env::var("VECTOR_IP");
    let vector_guid = env::var("VECTOR_GUID");
    
    if vector_ip.is_err() || vector_guid.is_err() {
        println!("Configuration missing. Server running in setup mode.");
        run_server().await;
        return Ok(());
    }

    let vector_ip = vector_ip.unwrap();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());

    tokio::spawn(async move {
        run_server().await;
    });

    if let Ok(cert_pem) = fs::read_to_string(&cert_path) {
        let cert = Certificate::from_pem(cert_pem);
        let tls_config = ClientTlsConfig::new()
            .ca_certificate(cert)
            .domain_name("Vector");

        let target_uri = format!("https://{}:443", vector_ip);
        match Channel::from_shared(target_uri)?.tls_config(tls_config)?.connect().await {
            Ok(_) => println!("mTLS channel established to Vector at {}.", vector_ip),
            Err(e) => println!("Connection deferred: {}", e),
        }
    }

    tokio::signal::ctrl_c().await?;
    println!("Shutting down xpod...");
    Ok(())
}