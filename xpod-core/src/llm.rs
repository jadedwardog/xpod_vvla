use candle_core::{Device, Tensor};
use candle_core::quantized::gguf_file;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_llama::ModelWeights;
use tokenizers::Tokenizer;
use std::error::Error;
use std::sync::{Arc, Mutex};

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
    pub fn new(tokenizer_path: &str, weights_path: &str) -> Result<Self, Box<dyn Error>> {
        let device = if candle_core::utils::metal_is_available() {
            Device::new_metal(0)?
        } else if candle_core::utils::cuda_is_available() {
            Device::new_cuda(0)?
        } else {
            Device::Cpu
        };

        println!("[INFO] Initialising Cognitive LLM module on device: {:?}", device);
        
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("Tokenizer load error: {}", e))?;
            
        println!("[INFO] Loading Quantized GGUF weights from: {}", weights_path);
        let mut file = std::fs::File::open(weights_path)?;
        let content = gguf_file::Content::read(&mut file)?;
        
        let model = ModelWeights::from_gguf(content, &mut file, &device)?;

        Ok(Self { 
            device, 
            tokenizer,
            model: Arc::new(Mutex::new(model))
        })
    }

    pub async fn generate_response(
        &self, 
        prompt: &str, 
        ctx: &CognitiveContext
    ) -> Result<String, Box<dyn Error>> {
        if prompt.trim().is_empty() {
            return Ok("".to_string());
        }

        let tendencies_str = ctx.soul_tendencies.join(", ");
        let rules_str = if ctx.active_rules.is_empty() { "None".to_string() } else { ctx.active_rules.join(" ") };
        let lt_mem_str = if ctx.long_term_memory.is_empty() { "No relevant factual memories recalled.".to_string() } else { ctx.long_term_memory.join("\n") };
        let sens_mem_str = if ctx.recalled_sensory_memories.is_empty() { "No relevant sensory/emotive memories triggered.".to_string() } else { ctx.recalled_sensory_memories.join("\n") };
        let st_mem_str = if ctx.short_term_memory.is_empty() { "No recent context.".to_string() } else { ctx.short_term_memory.join("\n") };

        let system_prompt = format!(
            "You are a robotic companion with a persistent soul named {}. Your core personality tendencies are: {}. You are observant, slightly analytical, and concise. Respond in a brief, conversational manner.\n\
            \n[DYNAMIC RULES & DIRECTIVES]\n{}\n\
            \n[CURRENT EMOTIVE & SENSORY STATE]\n{}\n\
            \n[TRIGGERED SENSORY/EMOTIVE MEMORIES]\n{}\n\
            \n[RECALLED FACTUAL MEMORIES]\n{}\n\
            \n[RECENT SHORT-TERM CONTEXT]\n{}",
            ctx.soul_name, tendencies_str, rules_str, ctx.current_emotive_state, sens_mem_str, lt_mem_str, st_mem_str
        );

        let formatted_prompt = format!("<|system|>\n{}<|end|>\n<|user|>\n{}<|end|>\n<|assistant|>\n", system_prompt, prompt);

        let tokenizer = self.tokenizer.clone();
        let model_arc = self.model.clone();
        let device = self.device.clone();

        let output = tokio::task::spawn_blocking(move || -> Result<String, Box<dyn Error + Send + Sync>> {
            let mut tokens = tokenizer
                .encode(formatted_prompt, true)
                .map_err(|e| e.to_string())?
                .get_ids()
                .to_vec();
            
            let mut model = model_arc.lock().unwrap();
            let mut logits_processor = LogitsProcessor::new(299792458, Some(0.7), None);
            
            let mut new_tokens = vec![];
            let max_tokens = 60;
            let mut start_pos = 0;
            
            for index in 0..max_tokens {
                let context_size = if index > 0 { 1 } else { tokens.len() };
                let start_index = tokens.len().saturating_sub(context_size);
                let input_slice = &tokens[start_index..];
                
                let input_tensor = Tensor::new(input_slice, &device)
                    .map_err(|e| e.to_string())?
                    .unsqueeze(0)
                    .map_err(|e| e.to_string())?;
                
                let logits = model.forward(&input_tensor, start_pos).map_err(|e| e.to_string())?;
                
                let logits = logits.squeeze(0).map_err(|e| e.to_string())?;
                let seq_len = logits.dim(0).map_err(|e| e.to_string())?;
                let last_logits = logits.get(seq_len - 1).map_err(|e| e.to_string())?;
                
                let next_token = logits_processor.sample(&last_logits).map_err(|e| e.to_string())?;
                
                tokens.push(next_token);
                new_tokens.push(next_token);
                start_pos += context_size;
                
                if let Ok(text) = tokenizer.decode(&[next_token], true) {
                    if text.contains("<|end|>") || text.contains("<|endoftext|>") || text.contains("<|assistant|>") {
                        break;
                    }
                }
            }
            
            let mut generated_text = tokenizer
                .decode(&new_tokens, true)
                .map_err(|e| e.to_string())?;
                
            generated_text = generated_text
                .replace("<|end|>", "")
                .replace("<|endoftext|>", "")
                .trim()
                .to_string();
                
            Ok(generated_text)
        }).await.map_err(|e| e.to_string())??;

        Ok(output)
    }
}