use base64::{engine::general_purpose, Engine as _};
use candle_core::{Device, Tensor};
use image::io::Reader as ImageReader;
use std::error::Error;
use std::io::Cursor;

pub struct VlaModel {
    device: Device,
}

impl VlaModel {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        let device = if candle_core::utils::cuda_is_available() {
            Device::new_cuda(0)?
        } else if candle_core::utils::metal_is_available() {
            Device::new_metal(0)?
        } else {
            Device::Cpu
        };

        println!("Initialising VLA module on device: {:?}", device);
        Ok(Self { device })
    }

    pub fn process_frame(&self, frame_data: &[u8]) -> Result<Tensor, Box<dyn Error>> {
        let cursor = Cursor::new(frame_data);
        let img = ImageReader::new(cursor).with_guessed_format()?.decode()?;
        
        let resized = img.resize_exact(224, 224, image::imageops::FilterType::Triangle);
        let rgb_img = resized.to_rgb8();
        let raw_pixels = rgb_img.into_raw();

        let tensor = Tensor::from_vec(raw_pixels, (224, 224, 3), &self.device)?
            .permute((2, 0, 1))? 
            .to_dtype(candle_core::DType::F32)?
            .affine(1.0 / 255.0, 0.0)?; 

        Ok(tensor)
    }

    pub fn predict_action(&self, visual_tensor: &Tensor, instruction: &str) -> Result<Vec<f32>, Box<dyn Error>> {
        let mean = visual_tensor.mean_all()?.to_scalar::<f32>()?;
        
        println!("[VLA Inference] Processing instruction: '{}'", instruction);
        println!("[VLA Inference] Visual tensor mean luminance: {:.4}", mean);
        
        let action_vector = vec![0.5, 0.0, mean]; 
        
        Ok(action_vector)
    }

    pub fn analyze_base64_frame(&self, base64_data: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
        let b64 = if let Some(idx) = base64_data.find(',') {
            &base64_data[idx + 1..]
        } else {
            base64_data
        };

        let image_bytes = general_purpose::STANDARD.decode(b64)
            .map_err(|e| Box::new(e) as Box<dyn Error + Send + Sync>)?;
            
        let tensor = self.process_frame(&image_bytes)
            .map_err(|e| e.to_string())?;

        let mean = tensor.mean_all().map_err(|e| e.to_string())?.to_scalar::<f32>().map_err(|e| e.to_string())?;
        
        let observation = if mean > 0.6 {
            "Bright environment detected. High luminance."
        } else if mean < 0.2 {
            "Dark environment detected. Low visibility."
        } else {
            "Standard ambient lighting conditions."
        };

        Ok(format!("Visual Analysis (Shape: {:?}, Mean Luma: {:.2}): {}", tensor.shape(), mean, observation))
    }
}