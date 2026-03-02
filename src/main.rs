use std::error::Error;
use std::fs;
use std::env;
use tonic::transport::{Certificate, Channel, ClientTlsConfig};
use tonic::{Request, Status};
use axum::{routing::post, Router, Json};
use tower_http::services::ServeDir;
use serde::Deserialize;

pub mod vector_api {
    tonic::include_proto!("anki.vector.external_interface");
}

use vector_api::external_interface_client::ExternalInterfaceClient;

#[derive(Deserialize)]
struct ProvisionPayload {
    ip: String,
    email: String,
    password: String,
}

async fn handle_provision(Json(payload): Json<ProvisionPayload>) -> String {
    println!("Received provisioning data from Web UI for Vector IP: {}", payload.ip);
    
    // Future implementation:
    // 1. Use reqwest to hit https://{payload.ip}:443/ to download certificate
    // 2. Use reqwest to authenticate with Anki servers using email/password to get GUID
    // 3. Save to vector-cert.pem and .env
    // 4. Instruct user to restart server
    
    let env_content = format!("VECTOR_IP={}\nVECTOR_GUID=pending_guid\nVECTOR_CERT_PATH=vector-cert.pem\n", payload.ip);
    let _ = fs::write(".env", env_content);
    
    "Provisioning data received. Check server console.".to_string()
}

async fn start_ui_server() {
    let app = Router::new()
        .fallback_service(ServeDir::new("web_ui"))
        .route("/api/provision", post(handle_provision));
        
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("Web UI listening on http://0.0.0.0:3000");
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
        println!("Please access the Web UI to provision the robot.");
        start_ui_server().await;
        return Ok(());
    }

    let vector_ip = vector_ip.unwrap();
    let vector_guid = vector_guid.unwrap();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());

    tokio::spawn(start_ui_server());

    let cert_pem = fs::read_to_string(&cert_path)?;
    let cert = Certificate::from_pem(cert_pem);

    let tls_config = ClientTlsConfig::new()
        .ca_certificate(cert)
        .domain_name("Vector");

    let target_uri = format!("https://{}:443", vector_ip);
    let channel = Channel::from_shared(target_uri)?
        .tls_config(tls_config)?
        .connect()
        .await?;

    let mut client = ExternalInterfaceClient::with_interceptor(channel, move |mut req: Request<()>| {
        let auth_value = format!("Bearer {}", vector_guid);
        req.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::try_from(auth_value).unwrap(),
        );
        Ok(req)
    });

    println!("Successfully established mTLS channel to Vector.");

    tokio::signal::ctrl_c().await?;
    println!("Shutting down xpod...");

    Ok(())
}