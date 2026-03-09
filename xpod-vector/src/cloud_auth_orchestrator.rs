use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tokio::sync::mpsc;

pub struct AuthTelemetry {
    pub target_ip: String,
    pub ssh_user: String,
    pub private_key_path: String,
    pub xpod_token: String,
}

pub trait BleTransport: Send + Sync {
    fn transmit_auth_payload(&self, payload: &[u8]) -> Result<(), String>;
}

pub struct CloudAuthorisationProcess {
    config: AuthTelemetry,
    ble_transport: Arc<dyn BleTransport>,
}

impl CloudAuthorisationProcess {
    pub fn new(config: AuthTelemetry, ble_transport: Arc<dyn BleTransport>) -> Self {
        Self {
            config,
            ble_transport,
        }
    }

    pub async fn execute_with_diagnostics(&self) -> Result<(), String> {
        tracing::info!("Initiating diagnostic Cloud Authorisation sequence");

        let tcp = TcpStream::connect(format!("{}:22", self.config.target_ip))
            .map_err(|e| format!("TCP connection failed: {}", e))?;
        
        let mut session = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        session.set_tcp_stream(tcp);
        session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        session.userauth_pubkey_file(
            &self.config.ssh_user,
            None,
            std::path::Path::new(&self.config.private_key_path),
            None,
        ).map_err(|e| format!("SSH authentication failed: {}", e))?;

        tracing::info!("SSH Diagnostic session established at {}", self.config.target_ip);

        self.verify_routing_configuration(&session)?;
        self.verify_tls_trust_store(&session)?;

        let keep_tailing = Arc::new(AtomicBool::new(true));
        let tailing_flag = keep_tailing.clone();
        
        let tcp_tail = TcpStream::connect(format!("{}:22", self.config.target_ip))
            .map_err(|e| format!("Secondary TCP connection failed: {}", e))?;
        let mut session_tail = Session::new().map_err(|e| format!("Failed to create secondary SSH session: {}", e))?;
        session_tail.set_tcp_stream(tcp_tail);
        session_tail.handshake().map_err(|e| format!("Secondary SSH handshake failed: {}", e))?;
        session_tail.userauth_pubkey_file(
            &self.config.ssh_user,
            None,
            std::path::Path::new(&self.config.private_key_path),
            None,
        ).map_err(|e| format!("Secondary SSH authentication failed: {}", e))?;

        let (tx, mut rx) = mpsc::channel(100);

        let tail_handle = thread::spawn(move || {
            let mut channel = session_tail.channel_session().unwrap();
            channel.exec("journalctl -u vic-cloud -u vic-gateway -f -n 0").unwrap();
            
            let mut buffer = [0; 1024];
            while tailing_flag.load(Ordering::Relaxed) {
                match channel.read(&mut buffer) {
                    Ok(bytes_read) if bytes_read > 0 => {
                        let output = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                        for line in output.lines() {
                            if !line.trim().is_empty() {
                                let _ = tx.blocking_send(line.to_string());
                            }
                        }
                    }
                    Ok(_) => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
            let _ = channel.close();
        });

        let mut header = vec![0x04, 0x05, 0x1d, 0x0a];
        let token_bytes = self.config.xpod_token.as_bytes();
        header.extend_from_slice(token_bytes);
        
        let client_id = b"\x09Web-Setup";
        let app_id = b"\x0fcom.anki.vector";
        header.extend_from_slice(client_id);
        header.extend_from_slice(app_id);

        tracing::info!("Submitting Cloud Authorisation Request via BLE");
        self.ble_transport.transmit_auth_payload(&header)?;
        tracing::info!("BLE Transmission complete. Monitoring robot internal state for 5 seconds.");

        let timeout = tokio::time::sleep(Duration::from_secs(5));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Some(log_line) = rx.recv() => {
                    tracing::info!("[VECTOR-INTERNAL] {}", log_line);
                }
                _ = &mut timeout => {
                    tracing::info!("Diagnostic monitoring period concluded.");
                    break;
                }
            }
        }

        keep_tailing.store(false, Ordering::Relaxed);
        let _ = tail_handle.join();

        Ok(())
    }

    fn verify_routing_configuration(&self, session: &Session) -> Result<(), String> {
        let mut channel = session.channel_session().map_err(|e| e.to_string())?;
        channel.exec("cat /etc/hosts | grep anki").map_err(|e| e.to_string())?;
        
        let mut output = String::new();
        channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
        
        if output.is_empty() {
            tracing::warn!("No Anki domain overrides found in /etc/hosts. Device may attempt to route to dead AWS endpoints.");
        } else {
            tracing::info!("Discovered DNS overrides in /etc/hosts:\n{}", output.trim());
        }
        
        let _ = channel.close();
        Ok(())
    }

    fn verify_tls_trust_store(&self, session: &Session) -> Result<(), String> {
        let mut channel = session.channel_session().map_err(|e| e.to_string())?;
        channel.exec("ls -al /anki/etc/ | grep .crt").map_err(|e| e.to_string())?;
        
        let mut output = String::new();
        channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
        
        if output.is_empty() {
            tracing::warn!("No custom certificates found in /anki/etc/. TLS handshake with the Rust server will likely fail.");
        } else {
            tracing::info!("Discovered custom certificates in /anki/etc/:\n{}", output.trim());
        }
        
        let _ = channel.close();
        Ok(())
    }
}