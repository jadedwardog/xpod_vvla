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

#[derive(Deserialize)]
struct ProvisionPayload {
    ip: String,
    email: String,
    password: String,
}

async fn handle_provision(Json(payload): Json<ProvisionPayload>) -> impl IntoResponse {
    println!("Received provisioning data for Vector at {}", payload.ip);
    
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
                println!("Successfully downloaded and saved vector-cert.pem");
            }
        },
        Err(e) => return format!("Failed to download certificate: {}", e).into_response(),
    }

    let guid = "fake-guid-token-12345"; 
    
    let env_content = format!(
        "VECTOR_IP={}\nVECTOR_GUID={}\nVECTOR_CERT_PATH=vector-cert.pem\n",
        payload.ip, guid
    );
    
    let _ = fs::write(".env", env_content);
    println!("Configuration saved to .env. Please restart the server.");

    "Provisioning successful. Check your server terminal.".into_response()
}

async fn start_ui_server() {
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let app = Router::new()
        .fallback_service(ServeDir::new("web_ui"))
        .route("/api/provision", post(handle_provision));
        
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Web UI listening on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenvy::dotenv().ok();

    println!("Starting xpod: Vector Visual-Language-Action Server...");

    let vector_ip = env::var("VECTOR_IP");
    let vector_guid = env::var("VECTOR_GUID");
    
    if vector_ip.is_err() || vector_guid.is_err() {
        println!("Configuration missing. Server running in setup mode.");
        start_ui_server().await;
        return Ok(());
    }

    let vector_ip = vector_ip.unwrap();
    let _vector_guid = vector_guid.unwrap();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());

    tokio::spawn(start_ui_server());

    let cert_pem = fs::read_to_string(&cert_path)?;
    let cert = Certificate::from_pem(cert_pem);

    let tls_config = ClientTlsConfig::new()
        .ca_certificate(cert)
        .domain_name("Vector");

    let target_uri = format!("https://{}:443", vector_ip);
    let _channel = Channel::from_shared(target_uri)?
        .tls_config(tls_config)?
        .connect()
        .await?;

    println!("Successfully established mTLS channel to Vector at {}.", vector_ip);

    tokio::signal::ctrl_c().await?;
    println!("Shutting down xpod...");

    Ok(())
}