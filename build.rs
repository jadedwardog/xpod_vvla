use std::env;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_proto = "proto/anki_vector/messaging/external_interface.proto";
    
    println!("cargo:rerun-if-changed={}", api_proto);

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(
            &[api_proto],
            &["proto"],
        )?;

    Ok(())
}