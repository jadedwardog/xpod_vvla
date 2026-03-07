use axum::{response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use blake2b_simd::Params;
use hex;

#[derive(Serialize)]
pub struct BleDevice {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub struct ApiStatus {
    status: String,
    message: String,
}

#[derive(Deserialize)]
pub struct HashPinRequest {
    pin: String,
    #[serde(rename = "sharedRx")]
    shared_rx: String,
    #[serde(rename = "sharedTx")]
    shared_tx: String,
}

#[derive(Serialize)]
pub struct HashPinResponse {
    #[serde(rename = "rx_key")]
    pub rx_key: String,
    #[serde(rename = "tx_key")]
    pub tx_key: String,
}

pub async fn init_ble() -> impl IntoResponse {
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Web Bluetooth bridge active".to_string(),
    })
}

pub async fn scan_ble() -> impl IntoResponse {
    let devices = vec![
        BleDevice {
            id: "00:11:22:33:44:55".to_string(),
            name: "Vector-N3E3 (VIRTUAL)".to_string(),
        }
    ];
    Json(devices)
}

pub async fn connect_ble() -> impl IntoResponse {
    Json(ApiStatus {
        status: "success".to_string(),
        message: "GATT connection simulated".to_string(),
    })
}

pub async fn send_pin() -> impl IntoResponse {
    Json(ApiStatus {
        status: "success".to_string(),
        message: "PIN challenge accepted".to_string(),
    })
}

pub async fn hash_pin(Json(payload): Json<HashPinRequest>) -> impl IntoResponse {
    println!("SIDECAR [BLE]: Received Hash Request for PIN: {}", payload.pin);
    
    let rx_bytes = match hex::decode(&payload.shared_rx) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("SIDECAR [BLE]: RX Hex decode failed: {}", e);
            return (axum::http::StatusCode::BAD_REQUEST, "Invalid RX hex").into_response();
        }
    };
    
    let tx_bytes = match hex::decode(&payload.shared_tx) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("SIDECAR [BLE]: TX Hex decode failed: {}", e);
            return (axum::http::StatusCode::BAD_REQUEST, "Invalid TX hex").into_response();
        }
    };

    println!("SIDECAR [BLE]: Inputs verified. Executing keyed Blake2b-256...");

    let rx_hashed = Params::new()
        .hash_length(32)
        .key(payload.pin.as_bytes())
        .hash(&rx_bytes);

    let tx_hashed = Params::new()
        .hash_length(32)
        .key(payload.pin.as_bytes())
        .hash(&tx_bytes);

    let response = HashPinResponse {
        rx_key: hex::encode(rx_hashed.as_bytes()),
        tx_key: hex::encode(tx_hashed.as_bytes()),
    };

    println!("SIDECAR [BLE]: Hashing complete. RX HASH: {}", response.rx_key);
    Json(response).into_response()
}

pub async fn connect_wifi() -> impl IntoResponse {
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Wi-Fi config sent".to_string(),
    })
}

pub async fn disconnect_ble() -> impl IntoResponse {
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Connection closed".to_string(),
    })
}