use axum::{response::IntoResponse, Json, http::StatusCode};
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
pub struct HashRequest {
    pin: String,
    #[serde(rename = "sharedRx")]
    shared_rx: String,
    #[serde(rename = "sharedTx")]
    shared_tx: String,
}

#[derive(Serialize)]
pub struct HashResponse {
    #[serde(rename = "hashedRx")]
    pub hashed_rx: String,
    #[serde(rename = "hashedTx")]
    pub hashed_tx: String,
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

pub async fn hash_pin(Json(payload): Json<HashRequest>) -> impl IntoResponse {
    let pin_bytes = payload.pin.as_bytes();
    
    let rx_bytes = match hex::decode(&payload.shared_rx) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid sharedRx hex").into_response(),
    };
    
    let tx_bytes = match hex::decode(&payload.shared_tx) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid sharedTx hex").into_response(),
    };

    let mut params = Params::new();
    params.hash_length(32);
    params.key(pin_bytes);

    let hashed_rx = params.hash(&rx_bytes);
    let hashed_tx = params.hash(&tx_bytes);

    Json(HashResponse {
        hashed_rx: hex::encode(hashed_rx.as_bytes()),
        hashed_tx: hex::encode(hashed_tx.as_bytes()),
    }).into_response()
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