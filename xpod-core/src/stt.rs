use base64::{engine::general_purpose, Engine as _};
use candle_core::{Device, Tensor};
use candle_transformers::models::whisper;
use std::error::Error;

pub struct SttModule {
    pub device: Device,
    pub model: Option<whisper::model::Whisper>,
}

impl SttModule {
    pub fn new() -> Result<Self, Box<dyn Error + Send + Sync>> {
        let device = if candle_core::utils::cuda_is_available() {
            Device::new_cuda(0)?
        } else if candle_core::utils::metal_is_available() {
            Device::new_metal(0)?
        } else {
            Device::Cpu
        };

        println!("[INFO] Initialising STT (Whisper) module on device: {:?}", device);
        
        Ok(Self { 
            device, 
            model: None 
        })
    }

    pub fn transcribe_audio(&self, pcm_data: &[f32]) -> Result<String, Box<dyn Error + Send + Sync>> {
        if pcm_data.is_empty() {
            return Ok("Silence".to_string());
        }

        let tensor = Tensor::from_slice(pcm_data, (pcm_data.len(),), &self.device)?;
        
        let energy = tensor.sqr()?.mean_all()?.to_scalar::<f32>()?;
        
        if energy > 0.05 {
            Ok(format!("Auditory Event Detected (Energy: {:.4})", energy))
        } else {
            Ok("Silence".to_string())
        }
    }

    pub fn process_base64_audio(&self, base64_data: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
        let b64 = if let Some(idx) = base64_data.find(',') {
            &base64_data[idx + 1..]
        } else {
            base64_data
        };

        let audio_bytes = general_purpose::STANDARD.decode(b64)?;
        
        if audio_bytes.is_empty() {
            return Ok("Silence".to_string());
        }

        let mut pcm_f32 = Vec::with_capacity(audio_bytes.len() / 2);
        for chunk in audio_bytes.chunks_exact(2) {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
            pcm_f32.push(sample as f32 / 32768.0);
        }

        self.transcribe_audio(&pcm_f32)
    }
}