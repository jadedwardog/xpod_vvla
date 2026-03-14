# **xpod: Visual-Language-Action Server**
## **Overview**
xpod is a self-hosted, AI architecture designed to breathe life into robotic hardware and virtual avatars. It can operate entirely offline, utilizing local LLMs, Speech-to-Text (STT) and Vision-Language-Action (VLA) models to give your devices a persistent and evolving "Soul".

By eliminating cloud-dependencies xpod ensures ultra-low latency, absolute privacy and edge-device compatibility using hardware-accelerated quantization via candle-core.

## **Architecture**
The AI engine doesn't just pass strings to an LLM, it weaves a deeply contextual state using four distinct memory pillars.
* A rolling buffer of immediate episodic events and active dialogue.
* Vector-embedded long-term factual recall (like "The user's name is Dave").
* Instantaneous and recalled sensory triggers (e.g., battery levels, a specific visual or song triggering a past emotion etc).
* Evolving, rule-based logic.

## **Stack**
* Rust, Tokio, Axum
* candle-core, candle-transformers
* Custom JWTs, secure telemetry streams, and WebRTC integration.

## **About the Developer & Support**
I am a software developer and author with a strong passion for hobbyist robotics. xpod is a passion project built from the ground up to push the boundaries of what legacy hardware can do when bridged with modern AI inference models.

If you feel like saying hi, I am usually hanging around the Vector & Friends discord server and if you feel like throwing some coffee money my way, feel free via Ko-Fi.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M21USDWB)