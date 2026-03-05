use axum::{response::IntoResponse, Json};
use serde::Serialize;

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

pub async fn init_ble() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Initialising Bluetooth adapter stack...");
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Web Bluetooth bridge active".to_string(),
    })
}

pub async fn scan_ble() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Scanning for Vector robots in pairing mode...");
    
    let devices = vec![
        BleDevice {
            id: "00:11:22:33:44:55".to_string(),
            name: "Vector-N3E3 (VIRTUAL)".to_string(),
        }
    ];
    Json(devices)
}

pub async fn connect_ble() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Handshake requested for virtual peripheral.");
    Json(ApiStatus {
        status: "success".to_string(),
        message: "GATT connection simulated".to_string(),
    })
}

pub async fn send_pin() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Encrypted PIN verification requested.");
    Json(ApiStatus {
        status: "success".to_string(),
        message: "PIN challenge accepted".to_string(),
    })
}

pub async fn connect_wifi() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Provisioning Wi-Fi credentials to robot.");
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Wi-Fi config sent".to_string(),
    })
}

pub async fn disconnect_ble() -> impl IntoResponse {
    println!("DASHBOARD [BLE]: Severing Bluetooth link.");
    Json(ApiStatus {
        status: "success".to_string(),
        message: "Connection closed".to_string(),
    })
}