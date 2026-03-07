use std::error::Error;
use std::fs;
use std::env;
use std::time::Duration;
use std::path::{Path, PathBuf};
use axum::{routing::{post, any}, Router, Json, response::{IntoResponse, Response}, extract::Path as AxumPath, http::{Request, StatusCode}, body::Body};
use tower_http::services::ServeDir;
use serde::Deserialize;
use reqwest::Client;
use axum_server::tls_rustls::RustlsConfig;
use tokio::process::Command;

pub mod vla;
pub mod llm;
pub mod stt;

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
                    "VECTOR_IP={}\nVECTOR_GUID=placeholder-guid\nVECTOR_CERT_PATH=vector-cert.pem\nSERVER_PORT={}\nSERVER_HOST={}\n",
                    payload.ip, 
                    env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string()),
                    env::var("SERVER_HOST").unwrap_or_else(|_| "localhost".to_string())
                );
                let _ = fs::write(".env", env_content);
                return "Provisioning successful. Restart xpod.".into_response();
            }
        },
        Err(e) => return format!("Failed: {}", e).into_response(),
    }
    "Failed to retrieve certificate".into_response()
}

fn ensure_certificates_exist(cert_path: &Path, key_path: &Path, host: &str) -> Result<(), Box<dyn Error>> {
    if cert_path.exists() && key_path.exists() {
        return Ok(());
    }

    println!("xpod Core: Generating new self-signed TLS certificates...");
    let subject_alt_names = vec![host.to_string(), "localhost".to_string()];
    let cert = rcgen::generate_simple_self_signed(subject_alt_names)?;

    fs::write(cert_path, cert.serialize_pem()?)?;
    fs::write(key_path, cert.serialize_private_key_pem())?;

    Ok(())
}

async fn proxy_to_sidecar(
    AxumPath(path): AxumPath<String>,
    req: Request<Body>,
) -> Response {
    let uri = format!("http://127.0.0.1:30302/{}", path);
    println!("CORE PROXY: Forwarding request to sidecar -> {}", uri);
    
    let client = Client::new();
    let method = req.method().clone();
    let headers = req.headers().clone();
    let body = req.into_body();
    
    let reqwest_body = reqwest::Body::wrap_stream(axum::body::Body::into_data_stream(body));
    
    let mut request_builder = client.request(method, &uri).body(reqwest_body);

    for (k, v) in headers.iter() {
        request_builder = request_builder.header(k, v);
    }

    let response = match request_builder.send().await {
        Ok(resp) => resp,
        Err(e) => {
            let err_msg = format!("Sidecar connection failed: {}", e);
            eprintln!("CORE PROXY ERROR: {}", err_msg);
            return (StatusCode::BAD_GATEWAY, err_msg).into_response();
        }
    };
    
    let status = response.status();
    let mut axum_response = axum::response::Response::builder().status(status);

    for (k, v) in response.headers().iter() {
        axum_response = axum_response.header(k, v);
    }

    match response.bytes().await {
        Ok(body_bytes) => {
            if !status.is_success() {
                let error_msg = String::from_utf8_lossy(&body_bytes);
                eprintln!("CORE PROXY WARNING: Sidecar returned error {}: {}", status, error_msg);
            }
            axum_response.body(Body::from(body_bytes)).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        },
        Err(e) => {
            let err_msg = format!("Failed to read sidecar response body: {}", e);
            eprintln!("CORE PROXY ERROR: {}", err_msg);
            (StatusCode::INTERNAL_SERVER_ERROR, err_msg).into_response()
        }
    }
}

async fn run_server(ui_path: PathBuf) {
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let host = env::var("SERVER_HOST").unwrap_or_else(|_| "localhost".to_string());
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", port).parse().expect("Invalid address format");

    let cert_path = PathBuf::from("server-cert.pem");
    let key_path = PathBuf::from("server-key.pem");

    if let Err(e) = ensure_certificates_exist(&cert_path, &key_path, &host) {
        eprintln!("CRITICAL: Failed to ensure certificates exist: {}", e);
        std::process::exit(1);
    }

    let config = match RustlsConfig::from_pem_file(&cert_path, &key_path).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("CRITICAL: Failed to load TLS config from disk: {}", e);
            std::process::exit(1);
        },
    };

    let app = Router::new()
        .route("/api/provision", post(handle_provision))
        .route("/api/vector/*path", any(proxy_to_sidecar))
        .fallback_service(ServeDir::new(ui_path));
        
    println!("xpod Core: Starting HTTPS server on https://{}", addr);
    if let Err(e) = axum_server::bind_rustls(addr, config)
        .serve(app.into_make_service())
        .await
    {
        eprintln!("CRITICAL: Server binding failed: {}", e);
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install default rustls crypto provider");

    dotenvy::dotenv().ok();
    
    let cwd = env::current_dir()?;
    println!("xpod Core: Current working directory: {:?}", cwd);
    
    let mut web_ui_path = cwd.join("web_ui");
    if !web_ui_path.exists() {
        web_ui_path = cwd.join("xpod-core").join("web_ui");
    }

    if !web_ui_path.exists() {
        eprintln!("CRITICAL: web_ui directory not found in {:?} or xpod-core/web_ui", cwd);
        std::process::exit(1);
    } else {
        println!("xpod Core: web_ui directory resolved to {:?}", web_ui_path);
    }

    let vector_ip = env::var("VECTOR_IP");
    let vector_guid = env::var("VECTOR_GUID");
    
    if vector_ip.is_err() || vector_guid.is_err() {
        println!("xpod Core: Initialising in Provisioning Mode.");
        run_server(web_ui_path).await;
        return Ok(());
    }

    println!("xpod Core: Initialising in Production Mode.");
    let vector_ip = vector_ip.unwrap();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());

    let ui_task_path = web_ui_path.clone();
    tokio::spawn(async move {
        run_server(ui_task_path).await;
    });

    let sidecar_bin = "./target/debug/xpod-vector";
    println!("xpod Core: Spawning Vector sidecar process: {}", sidecar_bin);
    
    let mut sidecar = Command::new(sidecar_bin)
        .env("VECTOR_IP", &vector_ip)
        .env("VECTOR_CERT_PATH", &cert_path)
        .env("SIDECAR_PORT", "30302")
        .spawn()
        .expect("Failed to start Vector sidecar process");

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("xpod Core: Shutdown signal received. Cleaning up sidecar...");
            let _ = sidecar.kill().await;
        }
        status = sidecar.wait() => {
            if let Ok(exit_status) = status {
                eprintln!("xpod Core: Sidecar exited unexpectedly with status: {}", exit_status);
                std::process::exit(exit_status.code().unwrap_or(1));
            }
        }
    }

    Ok(())
}