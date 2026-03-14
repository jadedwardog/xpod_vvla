use axum::{routing::{get, post}, Router, Json, http::StatusCode, response::IntoResponse, extract::State};
use serde::{Deserialize, Serialize};
use std::env;
use std::net::SocketAddr;
use tonic::{transport::{Channel, ClientTlsConfig, Certificate}, Request, Status};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::io::Read;
use ssh2::Session;

pub mod ble_api;

pub mod vector_api {
    tonic::include_proto!("anki.vector.external_interface");
}

pub mod setup_api {
    tonic::include_proto!("anki.vector.setup");
}

#[derive(Deserialize)]
struct RegisterBotPayload {
    esn: String,
    ip: String,
    client_token_guid: String,
}

#[derive(Serialize)]
struct SidecarStatus {
    connected: bool,
    robot_ip: Option<String>,
    robot_esn: Option<String>,
}

#[derive(Deserialize)]
struct DiagnosticRequest {
    ip: String,
}

struct AppState {
    active_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    robot_ip: Mutex<Option<String>>,
    robot_esn: Mutex<Option<String>>,
}

#[derive(Clone)]
struct AuthInterceptor {
    token: String,
}

impl tonic::service::Interceptor for AuthInterceptor {
    fn call(&mut self, mut request: Request<()>) -> Result<Request<()>, Status> {
        let token_val = format!("Bearer {}", self.token);
        request.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::from_str(&token_val).unwrap(),
        );
        Ok(request)
    }
}

async fn get_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let ip = state.robot_ip.lock().await.clone();
    let esn = state.robot_esn.lock().await.clone();
    Json(SidecarStatus {
        connected: ip.is_some(),
        robot_ip: ip,
        robot_esn: esn,
    })
}

async fn disconnect_robot(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut task_lock = state.active_task.lock().await;
    if let Some(task) = task_lock.take() {
        task.abort();
        println!("[INFO] Vector Sidecar: Disconnected from robot via API.");
    }
    *state.robot_ip.lock().await = None;
    *state.robot_esn.lock().await = None;
    StatusCode::OK
}

async fn connect_robot(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterBotPayload>,
) -> impl IntoResponse {
    let ip = payload.ip.clone();
    let guid = payload.client_token_guid.clone();
    let esn = payload.esn.clone();
    
    println!("[INFO] Vector Sidecar: Received connection request for robot at {} with GUID [{}] (ESN: {})", ip, guid, esn);

    let mut task_lock = state.active_task.lock().await;
    if let Some(task) = task_lock.take() {
        println!("[WARN] Vector Sidecar: Aborting previous connection to establish new session...");
        task.abort();
    }

    *state.robot_ip.lock().await = Some(ip.clone());
    *state.robot_esn.lock().await = Some(esn.clone());

    let state_clone = state.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = run_grpc_client(ip, guid, state_clone.clone()).await {
            eprintln!("[ERROR] Vector Sidecar: gRPC Client Error: {}", e);
            *state_clone.robot_ip.lock().await = None;
            *state_clone.robot_esn.lock().await = None;
        }
    });

    *task_lock = Some(handle);

    StatusCode::OK
}

async fn start_cloud_diagnostics(Json(payload): Json<DiagnosticRequest>) -> impl IntoResponse {
    let ip = payload.ip.clone();
    
    tokio::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            println!("[INFO] Vector Sidecar: Starting cloud diagnostic tail for {}...", ip);
            
            let tcp = match std::net::TcpStream::connect(format!("{}:22", ip)) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[ERROR] Vector Sidecar: SSH TCP connect failed: {}", e);
                    return;
                }
            };
            
            let mut sess = match Session::new() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[ERROR] Vector Sidecar: SSH session init failed: {}", e);
                    return;
                }
            };
            
            sess.set_tcp_stream(tcp);
            if let Err(e) = sess.handshake() {
                eprintln!("[ERROR] Vector Sidecar: SSH handshake failed: {}", e);
                return;
            }
            
            let key_path = std::path::Path::new("oskr.key");
            let key_path = if key_path.exists() {
                key_path
            } else {
                std::path::Path::new("../oskr.key")
            };
            
            if let Err(e) = sess.userauth_pubkey_file("root", None, key_path, None) {
                eprintln!("[ERROR] Vector Sidecar: SSH auth failed. Is oskr.key present? Error: {}", e);
                return;
            }
            
            let mut channel = match sess.channel_session() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[ERROR] Vector Sidecar: SSH channel failed: {}", e);
                    return;
                }
            };
            
            if let Err(e) = channel.exec("journalctl -u vic-cloud -u vic-gateway -f -n 0") {
                eprintln!("[ERROR] Vector Sidecar: SSH exec failed: {}", e);
                return;
            }
            
            sess.set_timeout(500);
            
            let mut buffer = [0; 1024];
            let start = std::time::Instant::now();
            
            while start.elapsed() < std::time::Duration::from_secs(15) {
                match channel.read(&mut buffer) {
                    Ok(bytes_read) if bytes_read > 0 => {
                        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
                        for line in output.lines() {
                            if !line.trim().is_empty() {
                                println!("[VECTOR-INTERNAL] {}", line);
                            }
                        }
                    }
                    Ok(_) | Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
            }
            
            println!("[INFO] Vector Sidecar: Diagnostic tailing completed (15s elapsed).");
            let _ = channel.close();
        }).await;
    });

    Json(serde_json::json!({
        "status": "success",
        "message": "Diagnostic SSH tailing initiated for 15 seconds"
    }))
}

async fn check_cloud_ready(Json(payload): Json<DiagnosticRequest>) -> impl IntoResponse {
    let ip = payload.ip.clone();
    
    let is_ready = tokio::task::spawn_blocking(move || {
        println!("[INFO] Vector Sidecar: Checking cloud daemon state for {}...", ip);
        
        let tcp = match std::net::TcpStream::connect(format!("{}:22", ip)) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[ERROR] Vector Sidecar: SSH TCP connect failed: {}", e);
                return false;
            }
        };
        
        let mut sess = match Session::new() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[ERROR] Vector Sidecar: SSH session init failed: {}", e);
                return false;
            }
        };
        
        sess.set_tcp_stream(tcp);
        if let Err(e) = sess.handshake() {
            eprintln!("[ERROR] Vector Sidecar: SSH handshake failed: {}", e);
            return false;
        }
        
        let key_path = std::path::Path::new("oskr.key");
        let key_path = if key_path.exists() {
            key_path
        } else {
            std::path::Path::new("../oskr.key")
        };
        
        if let Err(e) = sess.userauth_pubkey_file("root", None, key_path, None) {
            eprintln!("[ERROR] Vector Sidecar: SSH auth failed: {}", e);
            return false;
        }
        
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[ERROR] Vector Sidecar: SSH channel failed: {}", e);
                return false;
            }
        };
        
        if let Err(e) = channel.exec("systemctl is-active vic-cloud") {
            eprintln!("[ERROR] Vector Sidecar: SSH exec failed: {}", e);
            return false;
        }
        
        let mut output = String::new();
        let _ = channel.read_to_string(&mut output);
        let _ = channel.close();
        
        output.trim() == "active"
    }).await.unwrap_or(false);

    Json(serde_json::json!({
        "ready": is_ready
    }))
}

async fn run_network_diagnostics(Json(payload): Json<DiagnosticRequest>) -> impl IntoResponse {
    let ip = payload.ip.clone();
    
    let report = tokio::task::spawn_blocking(move || {
        let tcp = match std::net::TcpStream::connect(format!("{}:22", ip)) {
            Ok(t) => t,
            Err(e) => return format!("TCP Connect failed: {}", e),
        };
        
        let mut sess = Session::new().unwrap();
        sess.set_tcp_stream(tcp);
        sess.handshake().unwrap();
        
        let key_path = std::path::Path::new("oskr.key");
        let key_path = if key_path.exists() { key_path } else { std::path::Path::new("../oskr.key") };
        sess.userauth_pubkey_file("root", None, key_path, None).unwrap();
        
        let mut report = String::new();
        
        let cmds = vec![
            ("System Date/Time", "date"),
            ("DNS Resolution", "ping -c 1 accounts.anki.com"),
            ("Hosts File Overrides", "cat /etc/hosts | grep anki"),
            ("IPTables NAT Rules", "iptables -t nat -L OUTPUT -n -v"),
            ("SystemD xPod Route Status", "systemctl status xpod-route.service"),
            ("Curl Test to Core", "curl -v -k https://accounts.anki.com/1/sessions"),
        ];
        
        for (title, cmd) in cmds {
            report.push_str(&format!("--- {} ---\n> {}\n", title, cmd));
            if let Ok(mut channel) = sess.channel_session() {
                let _ = channel.exec(cmd);
                let mut output = String::new();
                let _ = channel.read_to_string(&mut output);
                report.push_str(&output);
                report.push_str("\n\n");
            }
        }
        report
    }).await.unwrap_or_else(|e| format!("Diagnostic task failed: {}", e));

    Json(serde_json::json!({
        "status": "success",
        "report": report
    }))
}

async fn reboot_robot(Json(payload): Json<DiagnosticRequest>) -> impl IntoResponse {
    let ip = payload.ip.clone();
    
    tokio::task::spawn_blocking(move || {
        println!("[INFO] Vector Sidecar: Issuing hardware reboot to {} to restore IPC sockets...", ip);
        
        let tcp = match std::net::TcpStream::connect(format!("{}:22", ip)) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[ERROR] Vector Sidecar: SSH TCP connect failed: {}", e);
                return;
            }
        };
        
        let mut sess = match Session::new() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[ERROR] Vector Sidecar: SSH session init failed: {}", e);
                return;
            }
        };
        
        sess.set_tcp_stream(tcp);
        if let Err(e) = sess.handshake() {
            eprintln!("[ERROR] Vector Sidecar: SSH handshake failed: {}", e);
            return;
        }
        
        let key_path = std::path::Path::new("oskr.key");
        let key_path = if key_path.exists() {
            key_path
        } else {
            std::path::Path::new("../oskr.key")
        };
        
        if let Err(e) = sess.userauth_pubkey_file("root", None, key_path, None) {
            eprintln!("[ERROR] Vector Sidecar: SSH auth failed: {}", e);
            return;
        }
        
        if let Ok(mut channel) = sess.channel_session() {
            let _ = channel.exec("/sbin/reboot");
            println!("[INFO] Vector Sidecar: Reboot command issued successfully.");
        }
    }).await.ok();

    Json(serde_json::json!({
        "status": "success",
        "message": "Reboot command sent to robot."
    }))
}

async fn run_grpc_client(ip: String, token: String, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let uri = format!("https://{}:443", ip);
    println!("[DEBUG] Vector Sidecar: Establishing gRPC TLS connection to {} using token GUID [{}]", uri, token);
    
    let pem = std::fs::read_to_string("vector-cert.pem").unwrap_or_else(|_| {
        println!("[WARN] Vector Sidecar: vector-cert.pem not found locally. Falling back to workspace root...");
        std::fs::read_to_string("../vector-cert.pem").unwrap_or_default()
    });

    if pem.is_empty() {
        return Err("Cannot establish TLS channel: vector-cert.pem is missing or empty.".into());
    }

    let ca = Certificate::from_pem(pem);
    
    let tls = ClientTlsConfig::new().ca_certificate(ca);

    let channel = Channel::from_shared(uri)?
        .tls_config(tls)?
        .connect()
        .await?;

    let interceptor = AuthInterceptor { token };
    let mut client = vector_api::external_interface_client::ExternalInterfaceClient::with_interceptor(channel, interceptor);

    println!("[INFO] Vector Sidecar: gRPC channel established. Subscribing to EventStream...");

    let req = Request::new(vector_api::EventRequest {
        connection_id: "xpod-sidecar".to_string(),
        ..Default::default()
    });

    let mut stream = client.event_stream(req).await?.into_inner();
    let core_client = reqwest::Client::new();
    let core_url = format!("http://{}:{}/api/core/telemetry", 
        env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string())
    );

    println!("[INFO] Vector Sidecar: EventStream active. Routing telemetry to xpod-core ({})...", core_url);

    let current_esn = state.robot_esn.lock().await.clone().unwrap_or_else(|| "UNKNOWN_ESN".to_string());

    while let Some(response) = stream.message().await? {
        if let Some(event_wrapper) = response.event {
            if let Some(event_type) = event_wrapper.event_type {
                let event_name = match &event_type {
                    vector_api::event::EventType::RobotState(_) => "RobotState",
                    vector_api::event::EventType::WakeWord(_) => "WakeWord",
                    vector_api::event::EventType::ObjectEvent(_) => "ObjectEvent",
                    vector_api::event::EventType::StimulationInfo(_) => "StimulationInfo",
                    vector_api::event::EventType::PhotoTaken(_) => "PhotoTaken",
                    _ => "OtherEvent"
                };

                let telemetry = serde_json::json!({
                    "esn": current_esn,
                    "event_type": event_name,
                    "payload": format!("{:?}", event_type)
                });

                let _ = core_client.post(&core_url)
                    .json(&telemetry)
                    .send()
                    .await;
            }
        }
    }

    println!("[INFO] Vector Sidecar: EventStream disconnected naturally.");
    *state.robot_ip.lock().await = None;
    *state.robot_esn.lock().await = None;
    Ok(())
}

#[tokio::main]
async fn main() {
    let port = env::var("SIDECAR_PORT").unwrap_or_else(|_| "30302".to_string());
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().expect("Invalid sidecar address");

    println!("[INFO] Vector Sidecar: Initialising on {}", addr);

    let shared_state = Arc::new(AppState {
        active_task: Mutex::new(None),
        robot_ip: Mutex::new(None),
        robot_esn: Mutex::new(None),
    });

    let initial_ip = env::var("VECTOR_IP").unwrap_or_default();
    let initial_guid = env::var("VECTOR_GUID").unwrap_or_default();
    let initial_esn = env::var("VECTOR_ESN").unwrap_or_default();

    if !initial_ip.is_empty() && !initial_guid.is_empty() && initial_guid != "placeholder-guid" {
        println!("[INFO] Vector Sidecar: Found existing credentials for IP {} (ESN: {}). Auto-connecting...", initial_ip, initial_esn);
        let ip_clone = initial_ip.clone();
        let state_clone = shared_state.clone();
        
        *shared_state.robot_ip.lock().await = Some(initial_ip);
        if !initial_esn.is_empty() {
            *shared_state.robot_esn.lock().await = Some(initial_esn);
        }
        
        let handle = tokio::spawn(async move {
            if let Err(e) = run_grpc_client(ip_clone, initial_guid, state_clone.clone()).await {
                eprintln!("[ERROR] Vector Sidecar: Auto-connect gRPC Client Error: {}", e);
                *state_clone.robot_ip.lock().await = None;
                *state_clone.robot_esn.lock().await = None;
            }
        });
        
        *shared_state.active_task.lock().await = Some(handle);
    }

    let app = Router::new()
        .route("/ble/init", get(ble_api::init_ble))
        .route("/ble/scan", post(ble_api::scan_ble))
        .route("/ble/connect", get(ble_api::connect_ble))
        .route("/ble/send_pin", get(ble_api::send_pin))
        .route("/ble/hash_pin", post(ble_api::hash_pin))
        .route("/ble/connect_wifi", get(ble_api::connect_wifi))
        .route("/ble/disconnect", get(ble_api::disconnect_ble))
        .route("/diagnostics/tail", post(start_cloud_diagnostics))
        .route("/diagnostics/network", post(run_network_diagnostics))
        .route("/diagnostics/cloud_ready", post(check_cloud_ready))
        .route("/diagnostics/reboot", post(reboot_robot))
        .route("/sidecar/connect", post(connect_robot))
        .route("/sidecar/status", get(get_status))
        .route("/sidecar/disconnect", post(disconnect_robot))
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Sidecar failed to bind to port");
    
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[ERROR] Sidecar server error: {}", e);
    }
}