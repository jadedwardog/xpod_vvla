use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        env::set_var("PROTOC", protobuf_src::protoc());
    }

    let external_proto = "proto/anki_vector/messaging/external_interface.proto";
    let rts_proto = "proto/rts.proto";
    
    println!("cargo:rerun-if-changed={}", external_proto);
    println!("cargo:rerun-if-changed={}", rts_proto);
    println!("cargo:rerun-if-changed=proto");
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(
            &[external_proto, rts_proto],
            &["proto", "."],
        )?;

    Ok(())
}