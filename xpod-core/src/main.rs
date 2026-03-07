use std::error::Error;
use std::fs;
use std::env;
use std::time::Duration;
use std::path::{Path, PathBuf};
use axum::{routing::{post, any}, Router, Json, response::{IntoResponse, Response}, extract::Path as AxumPath, http::{Request, StatusCode}, body::Body};
use tower_http::services::ServeDir;
use serde::{Deserialize, Serialize};
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

#[derive(Serialize)]
struct SessionResponse {
    session_token: String,
    user_id: String,
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

async fn handle_sessions() -> impl IntoResponse {
    println!("xpod Core: Robot requested cloud session validation. Blindly authorising.");
    
    Json(SessionResponse {
        session_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-X6s96Yy8939s894ksjdhfskjhf-dummy".to_string(),
        user_id: "xpod-user-0001".to_string(),
    })
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
    println!("CORE PROXY: Forwarding -> {}", uri);
    
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

async fn check_sidecar_health(uri: &str) -> bool {
    let client = Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap_or_default();

    println!("xpod Core: Initialising sidecar health check at {}...", uri);

    for i in 1..=10 {
        match client.get(uri).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    println!("xpod Core: Sidecar health check passed.");
                    return true;
                } else {
                    println!("xpod Core: Sidecar health check returned status {} (attempt {}/10).", resp.status(), i);
                }
            }
            Err(e) => {
                println!("xpod Core: Sidecar connection attempt {} failed: {}.", i, e);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    false
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
            eprintln!("CRITICAL: Failed to load TLS config: {}", e);
            std::process::exit(1);
        },
    };

    let app = Router::new()
        .route("/api/provision", post(handle_provision))
        .route("/v1/sessions", post(handle_sessions))
        .route("/api/robot/*path", any(proxy_to_sidecar))
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

fn find_sidecar_binary(name: &str) -> Option<PathBuf> {
    let possible_paths = vec![
        format!("./target/debug/{}", name),
        format!("../target/debug/{}", name),
        format!("./{}", name),
    ];

    println!("xpod Core: Searching for sidecar binary '{}'...", name);

    for path_str in possible_paths {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            if path.is_file() {
                if let Ok(abs_path) = fs::canonicalize(&path) {
                    println!("xpod Core: Binary found at: {:?}", abs_path);
                    return Some(abs_path);
                }
            } else if path.is_dir() {
                println!("xpod Core: Checked {:?} - Found directory, skipping.", path);
            }
        } else {
            println!("xpod Core: Checked {:?} - Not found.", path);
        }
    }
    None
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
        eprintln!("CRITICAL: web_ui directory not found.");
        std::process::exit(1);
    }

    let binary_name = "xpod-vector";
    let sidecar_path = match find_sidecar_binary(binary_name) {
        Some(p) => p,
        None => {
            eprintln!("CRITICAL: Could not locate compiled binary '{}'.", binary_name);
            eprintln!("Please run 'cargo build' from the workspace root to compile all members.");
            std::process::exit(1);
        }
    };
    
    let vector_ip = env::var("VECTOR_IP").unwrap_or_default();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());

    println!("xpod Core: Config: PORT=30302, IP={}, CERT={}", vector_ip, cert_path);

    let sidecar_spawn_result = Command::new(&sidecar_path)
        .env("VECTOR_IP", &vector_ip)
        .env("VECTOR_CERT_PATH", &cert_path)
        .env("SIDECAR_PORT", "30302")
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn();

    let mut sidecar_process = match sidecar_spawn_result {
        Ok(child) => {
            if let Some(pid) = child.id() {
                println!("xpod Core: Sidecar process started successfully (PID: {}).", pid);
            }
            child
        },
        Err(e) => {
            eprintln!("CRITICAL: Failed to spawn sidecar at {:?}: {}.", sidecar_path, e);
            std::process::exit(1);
        }
    };

    if !check_sidecar_health("http://127.0.0.1:30302/ble/init").await {
        eprintln!("CRITICAL: Sidecar failed health check after 10 retries. Cleaning up.");
        let _ = sidecar_process.kill().await;
        std::process::exit(1);
    }

    let ui_task_path = web_ui_path.clone();
    tokio::spawn(async move {
        run_server(ui_task_path).await;
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("xpod Core: Received shutdown signal. Terminating sidecar.");
            let _ = sidecar_process.kill().await;
        }
        status = sidecar_process.wait() => {
            if let Ok(exit_status) = status {
                eprintln!("xpod Core: Sidecar process terminated unexpectedly: {}.", exit_status);
                std::process::exit(exit_status.code().unwrap_or(1));
            }
        }
    }

    Ok(())
}