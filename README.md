# **xpod: Visual-Language-Action Server**
## **Overview**
xpod is designed to support multiple embodied agents, each associated with a physical robot such as an Anki Vector. The goal is to create persistent, individual “souls” that inhabit these devices. Each soul maintains its own emotional state, memory, personality, and behavioural tendencies, while sharing a common cognitive infrastructure. The system is self‑hosted, open source, and built around a Rust monolith that coordinates all higher‑level cognition.

## **Architecture**
The architecture separates the mind from the body. The monolith contains the cognitive and emotional logic, while each robot type is supported by a dedicated sidecar responsible for hardware‑specific operations. This separation allows the same cognitive framework to drive different robot types without modifying the core system.

Each robot type has its own sidecar. A sidecar is a small service responsible for all hardware‑level communication. It handles device discovery, telemetry collection, movement commands, audio playback, camera streaming, and any other device‑specific behaviour.

The sidecar exposes a stable API to the monolith. This API includes endpoints for sending actions, receiving telemetry, and querying capabilities. Because the monolith communicates only through this abstract interface, new robot types can be added without modifying the cognitive core.

The sidecar also reports physical state to the monolith. This includes battery level, temperature, CPU load, motor temperature, network quality, and uptime. These values form the basis of the agent’s BodyState.

Each agent maintains two internal models: BodyState and EmotionState.

BodyState reflects the physical condition of the robot. It is updated continuously from sidecar telemetry. Low battery, high temperature, heavy CPU load, long uptime, and poor network quality all influence the BodyState.

EmotionState represents the agent’s internal affective condition. It includes variables such as valence, arousal, confidence, curiosity, attachment, stress, and patience. These values drift over time and are influenced by user interactions, task outcomes, and BodyState.

## **Prerequisites**
* Rust toolchain  
* Protocol Buffer compiler (protoc)  
* Anki Vector external\_interface.proto definitions  
* Valid session certificates and guid for each target Vector robot

## **About the Developer & Support**
I am a software developer and author with a strong passion for hobbyist robotics. xpod is a passion project built from the ground up to push the boundaries of what legacy hardware can do when bridged with modern AI inference models.

If you feel like saying hi, I am usually hanging around the Vector & Friends discord server and if you feel like throwing some coffee money my way, feel free via Ko-Fi.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M21USDWB)
