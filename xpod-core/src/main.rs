use std::error::Error;
use std::fs;
use std::env;
use std::time::Duration;
use std::path::{Path, PathBuf};
use axum::{
    routing::{any, get, post}, 
    Router, 
    Json, 
    response::{IntoResponse, Response}, 
    extract::{Path as AxumPath, State, ws::{Message, WebSocket, WebSocketUpgrade}}, 
    http::{Request, StatusCode}, 
    body::Body
};
use tower_http::services::ServeDir;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use axum_server::tls_rustls::RustlsConfig;
use tokio::process::Command;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{RwLock, broadcast};

pub mod vla;
pub mod llm;
pub mod stt;
pub mod jwt_auth;

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

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Identity {
    pub id: String,
    pub name: String,
    pub tendencies: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EmotionalState {
    pub arousal: f32,
    pub valence: f32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EpisodicMemory {
    pub timestamp: u64,
    pub arousal: f32,
    pub valence: f32,
    pub event_description: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "type")]
pub enum IntentPacket {
    #[serde(rename = "speak")]
    Speak { text: String },
    #[serde(rename = "animate")]
    Animate { emotion: String },
    #[serde(rename = "soul_state")]
    SoulState { arousal: f32, valence: f32, battery: f32 },
    #[serde(rename = "error")]
    Error { message: String },
}

fn default_motor_tx() -> broadcast::Sender<IntentPacket> {
    broadcast::channel(100).0
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Soul {
    pub identity: Identity,
    pub emotion: EmotionalState,
    pub memories: Vec<EpisodicMemory>,
    pub active_connection: bool,
    pub battery_level: f32,
    pub dynamic_rules: Vec<String>,
    #[serde(skip, default = "default_motor_tx")]
    pub motor_intent_tx: broadcast::Sender<IntentPacket>,
}

impl Soul {
    pub fn new(id: String, name: String) -> Self {
        let (tx, _) = broadcast::channel(100);
        Soul {
            identity: Identity {
                id,
                name,
                tendencies: vec!["Curious".to_string(), "Analytical".to_string()],
            },
            emotion: EmotionalState {
                arousal: 0.2,
                 valence: 0.5,
            },
            memories: Vec::new(),
            active_connection: false,
            battery_level: 1.0,
            dynamic_rules: vec![
                "Keep responses brief and conversational.".to_string(),
                "Always acknowledge the sensory environment if relevant.".to_string()
            ],
            motor_intent_tx: tx,
        }
    }

    pub fn adjust_emotion(&mut self, arousal_delta: f32, valence_delta: f32) {
        self.emotion.arousal = (self.emotion.arousal + arousal_delta).clamp(0.0, 1.0);
        self.emotion.valence = (self.emotion.valence + valence_delta).clamp(0.0, 1.0);
    }

    pub fn record_memory(&mut self, description: String) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.memories.push(EpisodicMemory {
            timestamp,
            arousal: self.emotion.arousal,
            valence: self.emotion.valence,
            event_description: description,
        });

        if self.memories.len() > 100 {
            self.memories.remove(0);
        }
    }
}

pub struct AppState {
    pub souls: RwLock<HashMap<String, Soul>>,
    pub vla_module: Arc<vla::VlaModel>,
    pub stt_module: Arc<stt::SttModule>,
    pub llm_module: Arc<llm::LlmModule>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TelemetryPacket {
    #[serde(rename = "proprioception")]
    Proprioception { battery: f32 },
    #[serde(rename = "visual")]
    Visual { data: String },
    #[serde(rename = "audio")]
    Audio { data: String },
    #[serde(rename = "text")]
    Text { data: String },
}

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

#[derive(Deserialize, Debug)]
struct TelemetryEvent {
    event_type: String,
    #[allow(dead_code)]
    payload: serde_json::Value,
}

#[derive(Deserialize)]
pub struct TextPrompt {
    pub text: String,
}

async fn trigger_cognition(state: Arc<AppState>, soul_id: String, text: String) {
    let mut ctx: Option<llm::CognitiveContext> = None;
    
    {
        let mut souls = state.souls.write().await;
        if let Some(soul) = souls.get_mut(&soul_id) {
            soul.record_memory(format!("User says: {}", text));
            
            ctx = Some(llm::CognitiveContext {
                soul_name: soul.identity.name.clone(),
                soul_tendencies: soul.identity.tendencies.clone(),
                short_term_memory: soul.memories.iter().rev().take(15).map(|m| m.event_description.clone()).collect(),
                long_term_memory: vec![],
                recalled_sensory_memories: vec![],
                current_emotive_state: format!("Arousal: {:.2}, Valence: {:.2}, Battery: {:.0}%", 
                    soul.emotion.arousal, soul.emotion.valence, soul.battery_level * 100.0),
                active_rules: soul.dynamic_rules.clone(),
            });
        } else {
            eprintln!("[ERROR] xpod-core: trigger_cognition aborted. Soul '{}' missing from matrix.", soul_id);
        }
    }

    if let Some(cognitive_ctx) = ctx {
        match state.llm_module.generate_cognitive_response(&text, &cognitive_ctx).await {
            Ok(response) => {
                let mut souls = state.souls.write().await;
                if let Some(soul) = souls.get_mut(&soul_id) {
                    soul.adjust_emotion(response.emotional_shift.arousal, response.emotional_shift.valence);
                    soul.record_memory(format!("Cognition: [Intent: {}] {}", response.physical_intent, response.spoken_dialogue));
                    
                    let speak_intent = IntentPacket::Speak { text: response.spoken_dialogue };
                    let state_intent = IntentPacket::SoulState { 
                        arousal: soul.emotion.arousal, 
                        valence: soul.emotion.valence,
                        battery: soul.battery_level
                    };
                    
                    if let Err(e) = soul.motor_intent_tx.send(speak_intent) {
                        eprintln!("[WARN] xpod-core: Dropped speak_intent due to closed motor channel: {}", e);
                    }
                    if let Err(e) = soul.motor_intent_tx.send(state_intent) {
                        eprintln!("[WARN] xpod-core: Dropped state_intent due to closed motor channel: {}", e);
                    }
                } else {
                    eprintln!("[ERROR] xpod-core: Soul '{}' vanished before cognition could be applied.", soul_id);
                }
            },
            Err(e) => {
                let error_msg = format!("Cognitive pipeline failure: {}", e);
                eprintln!("[LLM ERROR] {}", error_msg);
                let mut souls = state.souls.write().await;
                if let Some(soul) = souls.get_mut(&soul_id) {
                    if let Err(e) = soul.motor_intent_tx.send(IntentPacket::Error { message: error_msg }) {
                        eprintln!("[WARN] xpod-core: Failed to propagate error intent: {}", e);
                    }
                }
            }
        }
    }
}

async fn handle_web_text(
    AxumPath(soul_id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TextPrompt>,
) -> impl IntoResponse {
    let state_clone = state.clone();
    tokio::spawn(async move {
        trigger_cognition(state_clone, soul_id, payload.text).await;
    });
    StatusCode::ACCEPTED
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumPath(soul_id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_sidecar_socket(socket, state, soul_id))
}

async fn handle_sidecar_socket(mut socket: WebSocket, state: Arc<AppState>, soul_id: String) {
    let mut motor_rx = {
        let mut souls = state.souls.write().await;
        if let Some(soul) = souls.get_mut(&soul_id) {
            soul.active_connection = true;
            soul.record_memory("Embodiment sidecar connected.".to_string());
            println!("[xpod-core] Soul {} possessed by sidecar.", soul_id);
            soul.motor_intent_tx.subscribe()
        } else {
            println!("[xpod-core] Provisioning new Soul context for {}.", soul_id);
            let mut new_soul = Soul::new(soul_id.clone(), format!("Agent {}", soul_id));
            new_soul.active_connection = true;
            new_soul.record_memory("Embodiment sidecar connected. Initiated new soul matrix.".to_string());
            let rx = new_soul.motor_intent_tx.subscribe();
            souls.insert(soul_id.clone(), new_soul);
            rx
        }
    };

    loop {
        tokio::select! {
            msg = socket.recv() => {
                let Some(msg) = msg else { 
                    eprintln!("[WARN] xpod-core: WebSocket recv() returned None. Socket closed for soul {}.", soul_id);
                    break; 
                }; 
                
                let text = match msg {
                    Ok(Message::Text(t)) => t,
                    Ok(other) => {
                        eprintln!("[DEBUG] xpod-core: Ignored non-text WebSocket message for soul {}: {:?}", soul_id, other);
                        continue;
                    }
                    Err(e) => {
                        eprintln!("[ERROR] xpod-core: WebSocket read error for soul {}: {}", soul_id, e);
                        break;
                    }
                };

                let packet = match serde_json::from_str::<TelemetryPacket>(&text) {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("[ERROR] xpod-core: Failed to parse TelemetryPacket for soul {}. Error: {}. Payload: {}", soul_id, e, text);
                        continue;
                    }
                };

                match packet {
                    TelemetryPacket::Proprioception { battery } => {
                        let mut souls = state.souls.write().await;
                        if let Some(soul) = souls.get_mut(&soul_id) {
                            soul.battery_level = battery;
                            if battery < 0.2 {
                                soul.adjust_emotion(0.01, -0.01); 
                            }
                            let update = IntentPacket::SoulState { 
                                arousal: soul.emotion.arousal, 
                                valence: soul.emotion.valence,
                                battery: soul.battery_level
                            };
                            let _ = soul.motor_intent_tx.send(update);
                        }
                    }
                    TelemetryPacket::Visual { data } => {
                        if let Ok(observation) = state.vla_module.analyze_base64_frame(&data) {
                            let mut souls = state.souls.write().await;
                            if let Some(soul) = souls.get_mut(&soul_id) {
                                soul.record_memory(format!("Vision: {}", observation));
                                soul.adjust_emotion(0.005, 0.0);
                            }
                        }
                    }
                    TelemetryPacket::Audio { data } => {
                        match state.stt_module.process_base64_audio(&data) {
                            Ok(transcript) if transcript != "Silence" && !transcript.contains("Background noise") => {
                                let mut souls = state.souls.write().await;
                                if let Some(soul) = souls.get_mut(&soul_id) {
                                    soul.adjust_emotion(0.02, 0.0);
                                    println!("[PERCEPTION] {} detected acoustic energy.", soul_id);
                                }
                            },
                            Ok(_) => {},
                            Err(e) => eprintln!("[STT ERROR] {}", e),
                        }
                    }
                    TelemetryPacket::Text { data } => {
                        let state_clone = state.clone();
                        let sid = soul_id.clone();
                        tokio::spawn(async move {
                            trigger_cognition(state_clone, sid, data).await;
                        });
                    }
                }
            }
            intent_res = motor_rx.recv() => {
                match intent_res {
                    Ok(intent) => {
                        match serde_json::to_string(&intent) {
                            Ok(json) => {
                                if let Err(e) = socket.send(Message::Text(json)).await {
                                    eprintln!("[ERROR] xpod-core: Failed to send intent to sidecar for soul {}: {}", soul_id, e);
                                    break; 
                                }
                            }
                            Err(e) => {
                                eprintln!("[ERROR] xpod-core: Failed to serialize IntentPacket for soul {}: {}", soul_id, e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[WARN] xpod-core: Motor broadcast channel lagged/dropped for soul {}: {}", soul_id, e);
                    }
                }
            }
        }
    }

    let mut souls = state.souls.write().await;
    if let Some(soul) = souls.get_mut(&soul_id) {
        soul.active_connection = false;
        soul.record_memory("Embodiment sidecar disconnected.".to_string());
        println!("[xpod-core] Soul {} released sidecar.", soul_id);
    }
}

async fn get_jwt() -> impl IntoResponse {
    println!("[INFO] xpod Core: UI requested fresh JWT for BLE injection.");
    let jwt_manager = jwt_auth::JwtManager::new("xpod_super_secret_signing_key");
    match jwt_manager.generate_vector_token("xpod-user-0001") {
        Ok(token) => Json(serde_json::json!({ "token": token })).into_response(),
        Err(e) => {
            eprintln!("[ERROR] xpod Core: Failed to generate JWT: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn handle_provision(Json(payload): Json<ProvisionPayload>) -> impl IntoResponse {
    println!("[INFO] xpod Core: Provisioning initiated for Bot ESN: {} at IP: {}", payload.esn, payload.ip);

    let ca_cert = fs::read_to_string("robot-ca.pem").unwrap_or_else(|_| {
        println!("[WARN] robot-ca.pem not found. Falling back to server-cert.pem");
        fs::read_to_string("server-cert.pem").unwrap_or_default()
    });

    if ca_cert.is_empty() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read certificates".to_string()).into_response();
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
    
    println!("[DEBUG] xpod Core: Applying strict Root CA provisioning via systemd.");

    let ssh_script = format!(
        "mount -o rw,remount / && \
         sed -i '/anki.com/d' /etc/hosts && \
         echo '{ip} accounts.anki.com' >> /etc/hosts && \
         echo '{ip} session-certs.token.anki.com' >> /etc/hosts && \
         echo '{ip} chipper.anki.com' >> /etc/hosts && \
         echo '{ip} ota.anki.com' >> /etc/hosts && \
         cat << 'EOF' > /anki/etc/system.crt\n\
         {cert}\n\
         EOF\n\
         cat << 'EOF' > /anki/etc/wirepod-cert.crt\n\
         {cert}\n\
         EOF\n\
         cat << 'EOF' > /lib/systemd/system/xpod-route.service\n\
         [Unit]\n\
         Description=xPod Port Redirect\n\
         After=network.target\n\
         [Service]\n\
         Type=oneshot\n\
         ExecStart=/bin/sh -c \"iptables -t nat -D OUTPUT -p tcp -d {ip} --dport 443 -j DNAT --to-destination {ip}:{port} 2>/dev/null || true; iptables -t nat -A OUTPUT -p tcp -d {ip} --dport 443 -j DNAT --to-destination {ip}:{port}\"\n\
         RemainAfterExit=yes\n\
         [Install]\n\
         WantedBy=multi-user.target\n\
         EOF\n\
         systemctl daemon-reload && \
         systemctl enable xpod-route.service && \
         systemctl start xpod-route.service",
        ip = payload.server_ip,
        port = server_port,
        cert = ca_cert
    );

    let ssh_result = Command::new("ssh")
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("UserKnownHostsFile=/dev/null")
        .arg("-o").arg("ConnectTimeout=10")
        .arg("-i").arg(key_path)
        .arg(format!("root@{}", payload.ip))
        .arg(&ssh_script)
        .output()
        .await;

    match ssh_result {
        Ok(output) if output.status.success() => {
            println!("[INFO] xpod Core: SSH Provisioning successful. Target completely overridden.");
            
            let default_sidecar_port = server_port.parse::<u16>().unwrap_or(30301) + 1;
            let sidecar_port = env::var("SIDECAR_PORT").unwrap_or_else(|_| default_sidecar_port.to_string());

            let env_content = format!(
                "VECTOR_IP={}\nVECTOR_GUID=placeholder-guid\nVECTOR_CERT_PATH=vector-cert.pem\nSERVER_PORT={}\nSERVER_HOST={}\nSIDECAR_PORT={}\n",
                payload.ip, 
                server_port,
                env::var("SERVER_HOST").unwrap_or_else(|_| "localhost".to_string()),
                sidecar_port
            );
            let _ = fs::write(".env", env_content);
            "Provisioning successful. Cloud service updated.".into_response()
        },
        Ok(output) => {
            let err = String::from_utf8_lossy(&output.stderr);
            eprintln!("[ERROR] xpod Core: SSH execution failed: {}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH failed: {}", err)).into_response()
        },
        Err(e) => {
            eprintln!("[ERROR] xpod Core: SSH failed to start: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH failed to start: {}", e)).into_response()
        }
    }
}

async fn handle_sessions() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested cloud session validation.");
    
    let jwt_manager = jwt_auth::JwtManager::new("xpod_super_secret_signing_key");
    let real_jwt = jwt_manager.generate_vector_token("xpod-user-0001").unwrap_or_else(|_| "00000000-0000-0000-0000-000000000000".to_string());

    Json(SessionWrapper {
        session: SessionResponse {
            session_token: real_jwt,
            time_created: "2015-01-01T00:00:00Z".to_string(),
            time_expires: "2037-01-01T00:00:00Z".to_string(),
        },
        user: UserData {
            id: "xpod-user-0001".to_string(),
            name: "Admin".to_string(),
            email: "admin@xpod.local".to_string(),
            is_email_verified: true,
            email_failure_code: None,
            time_created: "2015-01-01T00:00:00Z".to_string(),
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
            time_created: "2015-01-01T00:00:00Z".to_string(),
        }
    })
}

async fn handle_app_tokens() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested App Token (JWT). Generating time-traveled token...");
    
    let jwt_manager = jwt_auth::JwtManager::new("xpod_super_secret_signing_key");
    
    let app_token = match jwt_manager.generate_vector_token("xpod-user-0001") {
        Ok(token) => token,
        Err(e) => {
            eprintln!("[ERROR] xpod Core: Failed to generate time-traveled JWT: {}", e);
            "fallback_dummy_token".to_string()
        }
    };

    Json(serde_json::json!({
        "app_token": app_token.clone(),
        "AppToken": app_token
    }))
}

async fn handle_pull_jdocs() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested JDocs.");
    Json(serde_json::json!({
        "items": [
            {
                "doc_name": "vic.RobotSettings",
                "doc_version": 1,
                "fmt_version": 1,
                "client_metadata": "metadata",
                "json_doc": "{\"button_wakeword\":0,\"clock_24_hour\":false,\"custom_eye_color\":{\"enabled\":false,\"hue\":0,\"saturation\":0},\"default_location\":\"\",\"locale\":\"en-US\",\"master_volume\":2,\"temp_is_fahrenheit\":true,\"time_zone\":\"America/New_York\"}"
            }
        ]
    }))
}

async fn handle_push_jdocs() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot pushed JDocs update.");
    StatusCode::OK
}

async fn handle_firmware_list() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested OTA firmware list. Providing payload for fresh bot updates.");
    let host = env::var("SERVER_HOST").unwrap_or_else(|_| "192.168.50.124".to_string());
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    
    Json(serde_json::json!({
        "firmwares": [
            {
                "version": "3.0.1.32d-oskr",
                "url": format!("http://{}:{}/ota/vector.ota", host, port),
                "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
                "size": 123456789
            }
        ]
    }))
}

async fn handle_app_settings() -> impl IntoResponse {
    println!("[INFO] xpod Core: Robot requested app settings.");
    Json(serde_json::json!({}))
}

async fn handle_telemetry(Json(event): Json<TelemetryEvent>) -> impl IntoResponse {
    println!("[DEBUG] xpod Core [Perception]: Received somatic event: {:?}", event.event_type);
    StatusCode::OK
}

async fn handle_shutdown() -> impl IntoResponse {
    println!("[CRITICAL] xpod Core: Remote shutdown initiated. Terminating sidecars and core...");
    let _ = std::process::Command::new("pkill")
        .arg("-f")
        .arg("xpod-vector")
        .output();
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        std::process::exit(0);
    });

    StatusCode::OK
}

async fn proxy_to_sidecar(AxumPath(path): AxumPath<String>, req: Request<Body>) -> Response {
    let server_port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let default_sidecar_port = server_port.parse::<u16>().unwrap_or(30301) + 1;
    let sidecar_port = env::var("SIDECAR_PORT").unwrap_or_else(|_| default_sidecar_port.to_string());
    
    let uri = format!("http://127.0.0.1:{}/{}", sidecar_port, path);
    println!("[DEBUG] CORE PROXY: Forwarding request to -> {}", uri);
    
    let client = Client::new();
    let method = req.method().clone();
    let headers = req.headers().clone();
    
    let reqwest_body = reqwest::Body::wrap_stream(axum::body::Body::into_data_stream(req.into_body()));
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
            } else {
                println!("[DEBUG] CORE PROXY: Successfully received {} bytes chunk from sidecar", body_bytes.len());
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

fn ensure_certificates_exist(cert_path: &Path, key_path: &Path, host: &str) -> Result<(), Box<dyn Error>> {
    let ca_path = PathBuf::from("robot-ca.pem");
    let cert_version_file = PathBuf::from("cert_version_v11_ecdsa_ca.txt");
    
    if cert_path.exists() && key_path.exists() && ca_path.exists() && cert_version_file.exists() {
        return Ok(());
    }
    
    println!("[INFO] xpod Core: >>> GENERATING STRICT CA-SIGNED ECDSA TLS CERTIFICATES <<<");

    let mut ca_params = rcgen::CertificateParams::new(vec!["xPod Root CA".to_string()]);
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_params.alg = &rcgen::PKCS_ECDSA_P256_SHA256;
    let ca_cert = rcgen::Certificate::from_params(ca_params)?;

    let subject_alt_names = vec![
        "accounts.anki.com".to_string(),
        host.to_string(), 
        "localhost".to_string(),
        "session-certs.token.anki.com".to_string(),
        "chipper.anki.com".to_string(),
        "ota.anki.com".to_string()
    ];
    
    let mut leaf_params = rcgen::CertificateParams::new(subject_alt_names);
    leaf_params.alg = &rcgen::PKCS_ECDSA_P256_SHA256;
    let mut dn = rcgen::DistinguishedName::new();
    dn.push(rcgen::DnType::CommonName, "accounts.anki.com");
    leaf_params.distinguished_name = dn;
    
    let leaf_cert = rcgen::Certificate::from_params(leaf_params)?;
    
    fs::write(cert_path, leaf_cert.serialize_pem_with_signer(&ca_cert)?)?;
    fs::write(key_path, leaf_cert.serialize_private_key_pem())?;
    fs::write(&ca_path, ca_cert.serialize_pem()?)?;
    fs::write(&cert_version_file, "v11 ECDSA active")?;
    
    Ok(())
}

async fn check_sidecar_health(uri: &str, child: &mut tokio::process::Child) -> bool {
    let client = Client::builder().timeout(Duration::from_secs(1)).build().unwrap_or_default();
    for i in 1..=15 {
        if let Ok(Some(status)) = child.try_wait() {
            eprintln!("[FATAL] xpod Core: Sidecar process crashed prematurely with status: {}", status);
            return false;
        }

        match client.get(uri).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    println!("[INFO] xpod Core: Sidecar health check passed.");
                    return true;
                } else {
                    println!("[WARN] xpod Core: Sidecar health check returned non-success status: {}", resp.status());
                }
            }
            Err(e) => {
                println!("[DEBUG] xpod Core: Waiting for sidecar on {} (Attempt {}/15): {}", uri, i, e);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    eprintln!("[FATAL] xpod Core: Sidecar health check timed out after 15 seconds.");
    false
}

type PromptConfigMap = HashMap<String, llm::PromptTemplates>;

async fn run_server(ui_path: PathBuf, core_dir: PathBuf) {
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let host = env::var("SERVER_HOST").unwrap_or_else(|_| "localhost".to_string());
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", port).parse().expect("Invalid address");

    let cert_path = PathBuf::from("server-cert.pem");
    let key_path = PathBuf::from("server-key.pem");

    ensure_certificates_exist(&cert_path, &key_path, &host).expect("Cert generation failed");

    let config = RustlsConfig::from_pem_file(&cert_path, &key_path).await.expect("Failed to load TLS");
    let mut initial_souls = HashMap::new();
    let default_soul = Soul::new(
        "virtual-explorer-01".to_string(),
        "Virtual Navigator".to_string(),
    );
    initial_souls.insert(default_soul.identity.id.clone(), default_soul);
    println!("[INFO] xpod Core: Verifying local AI models (GGUF / Safetensors)...");
    
    let models_dir = core_dir.join("models");
    let local_tokenizer = models_dir.join("tokenizer.json");
    let local_weights = models_dir.join("tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf");

    let (tokenizer_path, llm_weights_path) = if local_tokenizer.exists() && local_weights.exists() {
        println!("[INFO] xpod Core: Found packaged models in local {:?} directory. Operating strictly offline.", models_dir);
        (local_tokenizer, local_weights)
    } else {
        println!("[WARN] xpod Core: Packaged models not found in {:?}. Falling back to HuggingFace Hub resolution...", models_dir);
        
        let api = hf_hub::api::tokio::ApiBuilder::new().build().expect("Failed to init HF API");
        
        println!("[INFO] HF-Hub: Resolving model weights and tokenizer...");
        let base_repo = api.repo(hf_hub::Repo::with_revision(
            "TinyLlama/TinyLlama-1.1B-Chat-v1.0".to_string(),
            hf_hub::RepoType::Model,
            "main".to_string(),
        ));
        let gguf_repo = api.repo(hf_hub::Repo::with_revision(
            "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF".to_string(),
            hf_hub::RepoType::Model,
            "main".to_string(),
        ));
        
        let tok = base_repo.get("tokenizer.json").await.expect("Failed to resolve tokenizer.json");
        let weights = gguf_repo.get("tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf").await.expect("Failed to resolve GGUF weights");
        
        println!("[INFO] HF-Hub: Models verified at {:?}", weights.parent().unwrap());
        (tok, weights)
    };

    println!("[INFO] xpod Core: Bootstrapping Neural Pipelines...");
    let vla_module = Arc::new(vla::VlaModel::new().unwrap_or_else(|e| {
        eprintln!("Failed to init VLA pipeline: {}", e);
        std::process::exit(1);
    }));
    
    let stt_module = Arc::new(stt::SttModule::new().unwrap_or_else(|e| {
        eprintln!("Failed to init STT pipeline: {}", e);
        std::process::exit(1);
    }));
    
    let mut cognitive_core = llm::LlmModule::new(
        tokenizer_path.to_str().unwrap(),
        llm_weights_path.to_str().unwrap()
    ).unwrap_or_else(|e| {
        eprintln!("Failed to init LLM pipeline: {}", e);
        std::process::exit(1);
    });

    println!("[INFO] xpod Core: Establishing Agentic Split-Brain Architecture...");
    
    let resolved_repo = match cognitive_core.load_conversational_model_with_fallback(
        "QuantFactory/Meta-Llama-3-8B-Instruct-GGUF",
        "Meta-Llama-3-8B-Instruct.Q4_K_M.gguf",
        "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
        "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    ).await {
        Ok(repo) => repo,
        Err(e) => {
            eprintln!("[FATAL] Could not resolve conversational LLM fallback protocol: {}", e);
            std::process::exit(1);
        }
    };

    let prompts_file_path = core_dir.join("prompts.json");

    let config_map: PromptConfigMap = if prompts_file_path.exists() {
        println!("[INFO] xpod Core: Loading prompt templates map from {:?}...", prompts_file_path);
        match fs::read_to_string(&prompts_file_path) {
            Ok(contents) => {
                match serde_json::from_str::<PromptConfigMap>(&contents) {
                    Ok(parsed) => parsed,
                    Err(e) => {
                        eprintln!("[WARN] xpod Core: Failed to parse prompts.json as a dictionary ({}). Generating new defaults.", e);
                        let mut map = HashMap::new();
                        map.insert("TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF".to_string(), llm::PromptTemplates::default());
                        map
                    }
                }
            },
            Err(e) => {
                eprintln!("[WARN] xpod Core: Failed to read prompts.json ({}). Using defaults.", e);
                let mut map = HashMap::new();
                map.insert("TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF".to_string(), llm::PromptTemplates::default());
                map
            }
        }
    } else {
        println!("[INFO] xpod Core: prompts.json not found. Generating multi-model template dictionary at {:?}...", prompts_file_path);
        
        let mut map = HashMap::new();
        map.insert("TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF".to_string(), llm::PromptTemplates::default());
        
        let mut llama3_tmpl = llm::PromptTemplates::default();
        llama3_tmpl.system_prefix = "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n".to_string();
        llama3_tmpl.system_suffix = "<|eot_id|>".to_string();
        llama3_tmpl.user_prefix = "<|start_header_id|>user<|end_header_id|>\n\n".to_string();
        llama3_tmpl.user_suffix = "<|eot_id|>".to_string();
        llama3_tmpl.assistant_prefix = "<|start_header_id|>assistant<|end_header_id|>\n\n".to_string();
        llama3_tmpl.eos_tokens = vec!["<|eot_id|>".to_string(), "<|end_of_text|>".to_string()];
        map.insert("QuantFactory/Meta-Llama-3-8B-Instruct-GGUF".to_string(), llama3_tmpl);

        if let Ok(json) = serde_json::to_string_pretty(&map) {
            if let Err(e) = fs::write(&prompts_file_path, json) {
                eprintln!("[WARN] xpod Core: Failed to write default prompts.json: {}", e);
            }
        }
        map
    };

    let selected_template = config_map.get(&resolved_repo)
        .cloned()
        .unwrap_or_else(|| {
            println!("[WARN] xpod Core: No template found for repo '{}'. Falling back to default TinyLlama formatting.", resolved_repo);
            llm::PromptTemplates::default()
        });

    cognitive_core.set_prompt_templates(selected_template);

    let llm_module = Arc::new(cognitive_core);

    let shared_state = Arc::new(AppState {
        souls: RwLock::new(initial_souls),
        vla_module,
        stt_module,
        llm_module,
    });

    let app = Router::new()
        .route("/api/core/telemetry", any(handle_telemetry))
        .route("/api/core/shutdown", any(handle_shutdown))
        .route("/api/core/text/:soul_id", post(handle_web_text))
        .route("/v1/soul-possess/:soul_id", get(ws_handler))
        .route("/api/core/get_jwt", get(get_jwt))
        .route("/api/core/provision_bot", any(handle_provision))
        .route("/1/sessions", any(handle_sessions))
        .route("/v1/sessions", any(handle_sessions))
        .route("/1/users/me", any(handle_users_me))
        .route("/v1/users/me", any(handle_users_me))
        .route("/1/app_tokens", any(handle_app_tokens))
        .route("/v1/app_tokens", any(handle_app_tokens))
        .route("/1/pull_jdocs", any(handle_pull_jdocs))
        .route("/v1/pull_jdocs", any(handle_pull_jdocs))
        .route("/1/push_jdocs", any(handle_push_jdocs))
        .route("/v1/push_jdocs", any(handle_push_jdocs))
        .route("/1/update/firmware_list", any(handle_firmware_list))
        .route("/v1/update/firmware_list", any(handle_firmware_list))
        .route("/1/app_settings", any(handle_app_settings))
        .route("/v1/app_settings", any(handle_app_settings))
        .route("/api/robot/*path", any(proxy_to_sidecar))
        .route("/api/vector/*path", any(proxy_to_sidecar))
        .fallback_service(ServeDir::new(ui_path))
        .with_state(shared_state);
        
    println!("[INFO] xpod Core: Starting HTTPS server on https://{}", addr);
    
    axum_server::bind_rustls(addr, config).serve(app.into_make_service()).await.unwrap();
}

fn find_sidecar_binary(name: &str) -> Option<PathBuf> {
    let possible_paths = vec![format!("./target/debug/{}", name), format!("../target/debug/{}", name), format!("./{}", name)];
    for path_str in possible_paths {
        let path = PathBuf::from(&path_str);
        if path.exists() && path.is_file() {
            return fs::canonicalize(&path).ok();
        }
    }
    None
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    rustls::crypto::ring::default_provider().install_default().expect("Failed to install crypto provider");
    dotenvy::dotenv().ok();
    
    let cwd = env::current_dir()?;
    let core_dir = if cwd.join("xpod-core").exists() {
        cwd.join("xpod-core")
    } else {
        cwd.clone()
    };
    
    let mut web_ui_path = core_dir.join("web_ui");
    if !web_ui_path.exists() { web_ui_path = cwd.join("web_ui"); }

    let binary_name = "xpod-vector";
    let sidecar_path = find_sidecar_binary(binary_name).expect("Could not locate sidecar binary");
    
    println!("[INFO] xpod Core: Ensuring port environment is clear...");
    let _ = std::process::Command::new("pkill")
        .arg("-f")
        .arg(binary_name)
        .output();
    
    let vector_ip = env::var("VECTOR_IP").unwrap_or_default();
    let cert_path = env::var("VECTOR_CERT_PATH").unwrap_or_else(|_| "vector-cert.pem".to_string());
    let server_port = env::var("SERVER_PORT").unwrap_or_else(|_| "30301".to_string());
    let sidecar_port = (server_port.parse::<u16>().unwrap_or(30301) + 1).to_string();

    let mut sidecar_process = Command::new(&sidecar_path)
        .env("VECTOR_IP", &vector_ip)
        .env("VECTOR_CERT_PATH", &cert_path)
        .env("SIDECAR_PORT", &sidecar_port)
        .kill_on_drop(true)
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()?;

    let health_url = format!("http://127.0.0.1:{}/ble/init", sidecar_port);
    println!("[INFO] xpod Core: Awaiting sidecar readiness at {}...", health_url);

    if !check_sidecar_health(&health_url, &mut sidecar_process).await {
        eprintln!("[FATAL] xpod Core: Failed to establish healthy connection to sidecar. Exiting.");
        let _ = sidecar_process.kill().await;
        std::process::exit(1);
    }

    let ui_task_path = web_ui_path.clone();
    let core_dir_clone = core_dir.clone();
    
    tokio::spawn(async move { run_server(ui_task_path, core_dir_clone).await; });

    tokio::select! {
        _ = tokio::signal::ctrl_c() => { let _ = sidecar_process.kill().await; }
        status = sidecar_process.wait() => { std::process::exit(status?.code().unwrap_or(1)); }
    }

    Ok(())
}