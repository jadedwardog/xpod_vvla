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

const UNIVERSAL_OSKR_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAp8wMPSe9LPHUKdnGmQd4uPpS1Ip6osRLUIq+KbMGw64FUIJh
/arLzQ3WkFMoV92iGOJqvCg2ddjLtQS9XVh6IjKjTkiOf8hUK5p5sjuVINz/z4cN
N+mFu0mklOTjLYgQUbikHcdQHNohCinQLGqCZA9pwnpeg86l9x9O3bV8Vw7vCadV
2XOnAJUeCCPCP79ifcLV7ts0IE+9j7774ZtuV/iJSZD7r6sbeWNNjXim/3uAqUos
CsTuwAiJl4tofjhLk1dlz732T8UGbYOE8si+BvH7OsOKjYkuw3RBAxqVH0qryl6V
uNyIYp0ehtqu6Qp7BWknUeWqzapvxSluK5Ve7QIDAQABAoIBAFa59yVwsa1WPJN4
9NXJb9MjxsYF4QbZsBer7ke9OWTQP/zxttYWfgm4+kpUQMjRS+PSutoPar6UVA12
qq1hepbMV22xwL04/JAg4n+FnjmDIFDR+7oHX9CCaqdueiDhb5Xdei3OA5E2CNeo
7ujWEBjJgp87AjjcCRnmO6wKDn8r6YfR0tG50Yqf1XjBksRGWy+4hTsSDRT3xUgw
fgByH5YLuc1ZI12eZSJhWn1K7jnJAGEZ2RFag5yCbhvWgBQNUVcIgWJt3GYEAFix
5gsI7UAw5ylIH9F6kl8vpvFTx326AkcBCjMLY9psAHrgRCcG88QJeEHsW0ET2akE
IknGG10CgYEA0rcUyEYYfu1MQjDDADekRPP/TwClJEI6sPE75Big0MzV78PRfwrB
cLHmfEqfHrR9TNwLz/Unbq6aWF85LCof3qFrU4IbXyz+JwL2/8seZ9fsWrbrI6En
ZR9PIftqPtbinxbap6t+ABT1RYkJ/HTI2pJE+/fQTS3GjEw6XJzL2YMCgYEAy9u9
sdz+MB7xdiI4j/xxjHQZJeDcvLAeJZUW44Jjv+Bn2f0TeDWuYwdYkHy88/nzXvpO
3zNP93iZeF+Igfm9pdQnXZfN0Fcvok6yeBK7HrmNaZmMeDu96Ky5BfYkXvKX2/Y/
Ntq2p8J5p/Nq9qT+qujdaZf51PbJg64oBUrbKs8CgYEAyqEAPS8a80Pip2wYuSbI
sv4oL6KhK+L8aZcxTsFYNDImMLEPzqlbJ7ILwM5Jgc9zBuw797j6OHdzOTQo2I2R
pBd6DA37oGS16nHxcD21eYqsYPex2stoBNg80qLgopklyHLDxaUmP5Hn4vxLPBhZ
5cXuzJacGvvACL5tCQ5HAV0CgYB++idFA0bcyFlUYOpkXTSI7MPBQTec3AJbHGs+
WLgzCt8E+8rFxIITsr6qeNflC9pYXYcFJdv4ZAkL3k2Tz/Adu3CtrmGHFNdZvLUT
b29YKvF3RiolteiLZhJ1MSTkcyy92Lr1OvQsuEi4oTkN2iW6ZQOMwxndWb6ZI8BP
05mCJwKBgQDQ4OGBMXL6jIWf7c+lmK/sHg4uzY9JGOGRIUVVqK5J2yST4FlK00f2
k+nITtKMig4m+8w2FQ7cFjJ2kzh+DXX3/0fl69iJRCBnJKDY7tH3d2kWCLLkNhAu
cPNasU815tacMMSMjlCrJq2woLrHM8ToOKpQIbIkpoXcpo0Zh+ceUQ==
-----END RSA PRIVATE KEY-----"#;

#[allow(dead_code)]
#[derive(Deserialize)]
struct ProvisionPayload {
    ip: String,
    esn: String,
    server_ip: String,
}

#[derive(Serialize)]
struct SessionResponse {
    session_token: String,
    time_created: String,
    time_expires: String,
}

#[derive(Serialize)]
struct SessionWrapper {
    session: SessionResponse,
    user: UserData,
}

#[derive(Serialize)]
struct UserResponse {
    user: UserData,
}

#[derive(Serialize)]
struct UserData {
    id: String,
    name: String,
    email: String,
    is_email_verified: bool,
    email_failure_code: Option<i32>,
    time_created: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
struct TelemetryEvent {
    event_type: String,
    payload: serde_json::Value,
}

async fn handle_provision(Json(payload): Json<ProvisionPayload>) -> impl IntoResponse {
    println!("[INFO] xpod Core: Provisioning initiated for Bot ESN: {} at IP: {}", payload.esn, payload.ip);

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();

    let cert_url = format!("https://{}:443/session/certificate", payload.ip);
    let cert_text = match client.get(&cert_url).send().await {
        Ok(resp) => resp.text().await.unwrap_or_default(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to retrieve bot certificate: {}", e)).into_response(),
    };
    let _ = fs::write("vector-cert.pem", cert_text);

    let server_cert = fs::read_to_string("server-cert.pem").unwrap_or_default();
    if server_cert.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read server-cert.pem".to_string()).into_response();
    }

    let key_path = "oskr.key";
    let _ = fs::write(key_path, UNIVERSAL_OSKR_KEY);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(mut perms) = fs::metadata(key_path).map(|m| m.permissions()) {
            perms.set_mode(0o600);
            let _ = fs::set_permissions(key_path, perms);
        }
    }

    let server_port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    
    let default_sidecar_port = server_port.parse::<u16>().unwrap_or(30301) + 1;
    let sidecar_port = env::var("SIDECAR_PORT").unwrap_or_else(|_| default_sidecar_port.to_string());

    println!("[DEBUG] xpod Core: Preparing SSH payload for certificate injection and DNS redirection.");

    let ssh_script = format!(
        "mount -o rw,remount / && \
         sed -i '/accounts.anki.com/d' /etc/hosts && \
         sed -i '/session-certs.token.anki.com/d' /etc/hosts && \
         echo '{ip} accounts.anki.com' >> /etc/hosts && \
         echo '{ip} session-certs.token.anki.com' >> /etc/hosts && \
         iptables -t nat -D OUTPUT -p tcp -d {ip} --dport 443 -j DNAT --to-destination {ip}:{port} 2>/dev/null || true && \
         iptables -t nat -A OUTPUT -p tcp -d {ip} --dport 443 -j DNAT --to-destination {ip}:{port} && \
         cat << 'EOF' > /anki/etc/system.crt\n\
         {cert}\n\
         EOF\n\
         systemctl restart vic-cloud",
        ip = payload.server_ip,
        port = server_port,
        cert = server_cert
    );

    println!("[DEBUG] xpod Core: Establishing SSH session to {}...", payload.ip);
    let ssh_result = Command::new("ssh")
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("UserKnownHostsFile=/dev/null")
        .arg("-i").arg(key_path)
        .arg(format!("root@{}", payload.ip))
        .arg(&ssh_script)
        .output()
        .await;

    match ssh_result {
        Ok(output) if output.status.success() => {
            println!("[INFO] xpod Core: SSH Provisioning successful for ESN: {}", payload.esn);
            let env_content = format!(
                "VECTOR_IP={}\nVECTOR_GUID=placeholder-guid\nVECTOR_CERT_PATH=vector-cert.pem\nSERVER_PORT={}\nSERVER_HOST={}\nSIDECAR_PORT={}\n",
                payload.ip, 
                server_port,
                env::var("SERVER_HOST").unwrap_or_else(|_| "localhost".to_string()),
                sidecar_port
            );
            let _ = fs::write(".env", env_content);
            "Provisioning successful. Ready for Cloud Auth.".into_response()
        },
        Ok(output) => {
            let err = String::from_utf8_lossy(&output.stderr);
            eprintln!("[ERROR] xpod Core: SSH execution failed for ESN {}: {}", payload.esn, err);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH execution failed: {}", err)).into_response()
        },
        Err(e) => {
            eprintln!("[ERROR] xpod Core: SSH command failed to start for IP {}: {}", payload.ip, e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH command failed to start: {}", e)).into_response()
        }
    }
}

async fn handle_sessions() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested cloud session validation. Blindly authorising.");
    
    Json(SessionWrapper {
        session: SessionResponse {
            session_token: "xpod_token_validated".to_string(),
            time_created: "2026-01-01T00:00:00Z".to_string(),
            time_expires: "2036-01-01T00:00:00Z".to_string(),
        },
        user: UserData {
            id: "xpod-user-0001".to_string(),
            name: "Admin".to_string(),
            email: "admin@xpod.local".to_string(),
            is_email_verified: true,
            email_failure_code: None,
            time_created: "2026-01-01T00:00:00Z".to_string(),
        }
    })
}

async fn handle_users_me() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested user details.");
    Json(UserResponse {
        user: UserData {
            id: "xpod-user-0001".to_string(),
            name: "Admin".to_string(),
            email: "admin@xpod.local".to_string(),
            is_email_verified: true,
            email_failure_code: None,
            time_created: "2026-01-01T00:00:00Z".to_string(),
        }
    })
}

async fn handle_telemetry(Json(event): Json<TelemetryEvent>) -> impl IntoResponse {
    println!("[DEBUG] xpod Core [Perception]: Received somatic event: {:?}", event.event_type);
    StatusCode::OK
}

fn ensure_certificates_exist(cert_path: &Path, key_path: &Path, host: &str) -> Result<(), Box<dyn Error>> {
    let cert_version_file = PathBuf::from("cert_version_v2.txt");
    
    if cert_path.exists() && key_path.exists() && cert_version_file.exists() {
        return Ok(());
    }

    println!("[INFO] xpod Core: Generating new self-signed TLS certificates with Anki SANs...");
    let subject_alt_names = vec![
        host.to_string(), 
        "localhost".to_string(),
        "accounts.anki.com".to_string(),
        "session-certs.token.anki.com".to_string()
    ];
    let cert = rcgen::generate_simple_self_signed(subject_alt_names)?;

    fs::write(cert_path, cert.serialize_pem()?)?;
    fs::write(key_path, cert.serialize_private_key_pem())?;
    fs::write(cert_version_file, "v2 active")?;

    Ok(())
}

async fn proxy_to_sidecar(
    AxumPath(path): AxumPath<String>,
    req: Request<Body>,
) -> Response {
    let server_port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let default_sidecar_port = server_port.parse::<u16>().unwrap_or(30301) + 1;
    let sidecar_port = env::var("SIDECAR_PORT").unwrap_or_else(|_| default_sidecar_port.to_string());
    
    let uri = format!("http://127.0.0.1:{}/{}", sidecar_port, path);
    println!("[DEBUG] CORE PROXY: Forwarding -> {}", uri);
    
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
            eprintln!("[ERROR] CORE PROXY ERROR: {}", err_msg);
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
                eprintln!("[WARN] CORE PROXY WARNING: Sidecar returned error {}: {}", status, error_msg);
            }
            axum_response.body(Body::from(body_bytes)).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        },
        Err(e) => {
            let err_msg = format!("Failed to read sidecar response body: {}", e);
            eprintln!("[ERROR] CORE PROXY ERROR: {}", err_msg);
            (StatusCode::INTERNAL_SERVER_ERROR, err_msg).into_response()
        }
    }
}

async fn check_sidecar_health(uri: &str) -> bool {
    let client = Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap_or_default();

    println!("[INFO] xpod Core: Initialising sidecar health check at {}...", uri);

    for i in 1..=10 {
        match client.get(uri).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    println!("[INFO] xpod Core: Sidecar health check passed.");
                    return true;
                } else {
                    println!("[WARN] xpod Core: Sidecar health check returned status {} (attempt {}/10).", resp.status(), i);
                }
            }
            Err(e) => {
                println!("[WARN] xpod Core: Sidecar connection attempt {} failed: {}.", i, e);
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
        eprintln!("[CRITICAL] xpod Core: Failed to ensure certificates exist: {}", e);
        std::process::exit(1);
    }

    let config = match RustlsConfig::from_pem_file(&cert_path, &key_path).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[CRITICAL] xpod Core: Failed to load TLS config: {}", e);
            std::process::exit(1);
        },
    };

    let app = Router::new()
        .route("/api/core/provision_bot", post(handle_provision))
        .route("/api/core/telemetry", post(handle_telemetry))
        .route("/1/sessions", post(handle_sessions))
        .route("/v1/sessions", post(handle_sessions))
        .route("/1/users/me", axum::routing::get(handle_users_me))
        .route("/v1/users/me", axum::routing::get(handle_users_me))
        .route("/api/robot/*path", any(proxy_to_sidecar))
        .route("/api/vector/*path", any(proxy_to_sidecar))
        .fallback_service(ServeDir::new(ui_path));
        
    println!("[INFO] xpod Core: Starting HTTPS server on https://{}", addr);
    if let Err(e) = axum_server::bind_rustls(addr, config)
        .serve(app.into_make_service())
        .await
    {
        eprintln!("[CRITICAL] xpod Core: Server binding failed: {}", e);
        std::process::exit(1);
    }
}

fn find_sidecar_binary(name: &str) -> Option<PathBuf> {
    let possible_paths = vec![
        format!("./target/debug/{}", name),
        format!("../target/debug/{}", name),
        format!("./{}", name),
    ];

    println!("[INFO] xpod Core: Searching for sidecar binary '{}'...", name);

    for path_str in possible_paths {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            if path.is_file() {
                if let Ok(abs_path) = fs::canonicalize(&path) {
                    println!("[INFO] xpod Core: Binary found at: {:?}", abs_path);
                    return Some(abs_path);
                }
            } else if path.is_dir() {
                println!("[DEBUG] xpod Core: Checked {:?} - Found directory, skipping.", path);
            }
        } else {
            println!("[DEBUG] xpod Core: Checked {:?} - Not found.", path);
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
    println!("[INFO] xpod Core: Current working directory: {:?}", cwd);

    let mut web_ui_path = cwd.join("web_ui");
    if !web_ui_path.exists() {
        web_ui_path = cwd.join("xpod-core").join("web_ui");
    }

    if !web_ui_path.exists() {
        eprintln!("[CRITICAL] xpod Core: web_ui directory not found.");
        std::process::exit(1);
    }

    let binary_name = "xpod-vector";
    let sidecar_path = match find_sidecar_binary(binary_name) {
        Some(p) => p,
        None => {
            eprintln!("[CRITICAL] xpod Core: Could not locate compiled binary '{}'.", binary_name);
            eprintln!("Please run 'cargo build' from the workspace root to compile all members.");
            std::process::exit(1);
        }
    };
    
    let vector_ip = env::var("VECTOR_IP").unwrap_or_default();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());
    
    let server_port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let default_sidecar_port = server_port.parse::<u16>().unwrap_or(30301) + 1;
    let sidecar_port = env::var("SIDECAR_PORT").unwrap_or_else(|_| default_sidecar_port.to_string());

    println!("[INFO] xpod Core: Config: SERVER_PORT={}, SIDECAR_PORT={}, IP={}, CERT={}", server_port, sidecar_port, vector_ip, cert_path);

    let sidecar_spawn_result = Command::new(&sidecar_path)
        .env("VECTOR_IP", &vector_ip)
        .env("VECTOR_CERT_PATH", &cert_path)
        .env("SIDECAR_PORT", &sidecar_port)
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn();

    let mut sidecar_process = match sidecar_spawn_result {
        Ok(child) => {
            if let Some(pid) = child.id() {
                println!("[INFO] xpod Core: Sidecar process started successfully (PID: {}).", pid);
            }
            child
        },
        Err(e) => {
            eprintln!("[CRITICAL] xpod Core: Failed to spawn sidecar at {:?}: {}.", sidecar_path, e);
            std::process::exit(1);
        }
    };

    let health_url = format!("http://127.0.0.1:{}/ble/init", sidecar_port);
    if !check_sidecar_health(&health_url).await {
        eprintln!("[CRITICAL] xpod Core: Sidecar failed health check after 10 retries. Cleaning up.");
        let _ = sidecar_process.kill().await;
        std::process::exit(1);
    }

    let ui_task_path = web_ui_path.clone();
    tokio::spawn(async move {
        run_server(ui_task_path).await;
    });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("[INFO] xpod Core: Received shutdown signal. Terminating sidecar.");
            let _ = sidecar_process.kill().await;
        }
        status = sidecar_process.wait() => {
            if let Ok(exit_status) = status {
                eprintln!("[ERROR] xpod Core: Sidecar process terminated unexpectedly: {}.", exit_status);
                std::process::exit(exit_status.code().unwrap_or(1));
            }
        }
    }

    Ok(())
}