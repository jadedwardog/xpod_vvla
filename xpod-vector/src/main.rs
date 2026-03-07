use axum::{routing::{get, post}, Router};
use std::env;
use std::net::SocketAddr;

pub mod ble_api;

pub mod vector_api {
    tonic::include_proto!("anki.vector.external_interface");
}

pub mod setup_api {
    tonic::include_proto!("anki.vector.setup");
}

#[tokio::main]
async fn main() {
    let port = env::var("SIDECAR_PORT").unwrap_or_else(|_| "30302".to_string());
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().expect("Invalid sidecar address");

    println!("Vector Sidecar: Initialising on {}", addr);

    let app = Router::new()
        .route("/ble/init", get(ble_api::init_ble))
        .route("/ble/scan", post(ble_api::scan_ble))
        .route("/ble/connect", get(ble_api::connect_ble))
        .route("/ble/send_pin", get(ble_api::send_pin))
        .route("/ble/hash_pin", post(ble_api::hash_pin))
        .route("/ble/connect_wifi", get(ble_api::connect_wifi))
        .route("/ble/disconnect", get(ble_api::disconnect_ble));

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Sidecar failed to bind to port");
    
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Sidecar server error: {}", e);
    }
}