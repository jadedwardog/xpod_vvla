use candle_core::{Device, Tensor};
use candle_core::quantized::gguf_file;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_llama::ModelWeights;
use tokenizers::Tokenizer;
use std::error::Error;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AffectiveState {
    pub valence: f32,
    pub arousal: f32,
    pub dominance: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionIntent {
    pub spoken_dialogue: String,
    pub physical_intent: String,
    pub target_vector: Vec<f32>,
    pub emotional_shift: AffectiveState,
}

#[derive(Debug, Clone)]
pub struct CognitiveContext {
    pub soul_name: String,
    pub soul_tendencies: Vec<String>,
    pub short_term_memory: Vec<String>,
    pub long_term_memory: Vec<String>,
    pub recalled_sensory_memories: Vec<String>,
    pub current_emotive_state: String,
    pub active_rules: Vec<String>,
}

pub struct LlmModule {
    pub device: Device,
    pub tokenizer: Tokenizer,
    pub model: Arc<Mutex<ModelWeights>>,
}

impl LlmModule {
    pub fn new(tokenizer_path: &str, weights_path: &str) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let device = if candle_core::utils::metal_is_available() {
            Device::new_metal(0)?
        } else if candle_core::utils::cuda_is_available() {
            Device::new_cuda(0)?
        } else {
            Device::Cpu
        };

        let tokenizer = Tokenizer::from_file(tokenizer_path)?;
            
        let mut file = std::fs::File::open(weights_path)?;
        let content = gguf_file::Content::read(&mut file)?;
        
        let model = ModelWeights::from_gguf(content, &mut file, &device)?;

        Ok(Self { 
            device, 
            tokenizer,
            model: Arc::new(Mutex::new(model))
        })
    }

    pub async fn generate_cognitive_response(
        &self, 
        prompt: &str, 
        ctx: &CognitiveContext
    ) -> Result<ActionIntent, Box<dyn Error + Send + Sync>> {
        if prompt.trim().is_empty() {
            return Err("Empty prompt provided".into());
        }

        let tendencies_str = ctx.soul_tendencies.join(", ");
        let rules_str = if ctx.active_rules.is_empty() { "Standard operation.".to_string() } else { ctx.active_rules.join(" ") };
        let lt_mem_str = if ctx.long_term_memory.is_empty() { "No factual history recalled.".to_string() } else { ctx.long_term_memory.join("\n") };
        let sens_mem_str = if ctx.recalled_sensory_memories.is_empty() { "No sensory associations triggered.".to_string() } else { ctx.recalled_sensory_memories.join("\n") };
        let st_mem_str = if ctx.short_term_memory.is_empty() { "No recent context.".to_string() } else { ctx.short_term_memory.join("\n") };

        let system_prompt = format!(
            "Identity: {0}. Tendencies: {1}. \
            [DYNAMIC RULES]\n{2}\n\
            [STATE]\n{3}\n\
            [SENSORY TRIGGERS]\n{4}\n\
            [FACTUAL RECALL]\n{5}\n\
            [RECENT EPISODES]\n{6}\n\
            Task: Respond as {0}. Be concise, embodied, and grounded in the provided state and memories. \
            You MUST respond with a single, valid JSON object matching this schema exactly, with no markdown formatting or trailing text:\n\
            {{\n  \"spoken_dialogue\": \"string\",\n  \"physical_intent\": \"string\",\n  \"target_vector\": [0.0, 0.0, 0.0],\n  \"emotional_shift\": {{\n    \"valence\": 0.0,\n    \"arousal\": 0.0,\n    \"dominance\": 0.0\n  }}\n}}",
            ctx.soul_name, tendencies_str, rules_str, ctx.current_emotive_state, sens_mem_str, lt_mem_str, st_mem_str
        );

        let formatted_prompt = format!("<|system|>\n{}<|end|>\n<|user|>\n{}<|end|>\n<|assistant|>\n", system_prompt, prompt);

        let tokenizer = self.tokenizer.clone();
        let model_arc = self.model.clone();
        let device = self.device.clone();

        let raw_output = tokio::task::spawn_blocking(move || -> Result<String, Box<dyn Error + Send + Sync>> {
            let mut tokens = tokenizer
                .encode(formatted_prompt, true)?
                .get_ids()
                .to_vec();
            
            let mut model = model_arc.lock().map_err(|_| "Model mutex poisoned")?;
            let mut logits_processor = LogitsProcessor::new(299792458, Some(0.7), None);
            
            let mut new_tokens = vec![];
            let mut start_pos = 0;
            
            for index in 0..256 {
                let context_size = if index > 0 { 1 } else { tokens.len() };
                let start_index = tokens.len().saturating_sub(context_size);
                let input_slice = &tokens[start_index..];
                
                let input_tensor = Tensor::new(input_slice, &device)?.unsqueeze(0)?;
                
                let logits = model.forward(&input_tensor, start_pos)?;
                let logits = logits.squeeze(0)?;
                let seq_len = logits.dim(0)?;
                let last_logits = logits.get(seq_len - 1)?;
                
                let next_token = logits_processor.sample(&last_logits)?;
                
                tokens.push(next_token);
                new_tokens.push(next_token);
                start_pos += context_size;
                
                if let Ok(text) = tokenizer.decode(&[next_token], true) {
                    if text.contains("<|end|>") || text.contains("<|endoftext|>") || text.contains("}") {
                        let full_text_so_far = tokenizer.decode(&new_tokens, true).unwrap_or_default();
                        if full_text_so_far.trim().ends_with('}') && full_text_so_far.contains('{') {
                           break; 
                        }
                    }
                }
            }
            
            let generated_text = tokenizer.decode(&new_tokens, true)?;
                
            Ok(generated_text.replace("<|end|>", "").replace("<|endoftext|>", "").trim().to_string())
        }).await??;

        let raw_str = raw_output.trim();
        
        let json_str = if let (Some(start), Some(end)) = (raw_str.find('{'), raw_str.rfind('}')) {
            &raw_str[start..=end]
        } else {
            return Err(format!("Model failed to generate JSON boundaries. Raw output: {}", raw_str).into());
        };

        let intent: ActionIntent = match serde_json::from_str(json_str) {
            Ok(parsed) => parsed,
            Err(e) => {
                return Err(format!("JSON validation failed: {}. Extracted payload: {}", e, json_str).into());
            }
        };

        Ok(intent)
    }
}