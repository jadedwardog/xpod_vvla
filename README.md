# **xpod: Vector Visual-Language-Action Server**
## **Overview**
xpod is a high-performance, hub-and-spoke server designed to manage multiple Anki Vector robots. Written entirely in Rust, it bypasses legacy SDKs to interact directly with Vector's internal clank API via gRPC and mutual TLS.

The server acts as an inference routing hub, extracting high-frequency sensor data and passing it to distinct Vision-Language-Action models to generate discrete motor control tokens.

## **Architecture**
The application is built on the Tokio asynchronous runtime and Tonic gRPC implementation to ensure deterministic performance and memory safety.
* Manages concurrent mTLS streams for multiple Vector bots, injecting the unique guid authorization token into gRPC interceptors without blocking the execution thread.
* Buffers the raw CameraFeedResponse and AudioFeedResponse byte streams.
* Maps discrete inference actions back to the Anki motor control protobufs, ensuring strict adherence to the robot's behavior control lock hierarchy.

## **Prerequisites**
* Rust toolchain  
* Protocol Buffer compiler (protoc)  
* Anki Vector external\_interface.proto definitions  
* Valid session certificates and guid for each target Vector robot

## **About the Developer & Support**
I am a software developer and author with a strong passion for hobbyist robotics. xpod is a passion project built from the ground up to push the boundaries of what legacy hardware can do when bridged with modern AI inference models.

If you feel like saying hi, I am usually hanging around the Vector & Friends discord server and if you feel like throwing some coffee money my way, feel free via Ko-Fi.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M21USDWB)
