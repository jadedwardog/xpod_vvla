use candle_core::{Device, Tensor};
use candle_core::quantized::gguf_file;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_llama::ModelWeights;
use tokenizers::Tokenizer;
use std::error::Error;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptTemplates {
    pub router_system: String,
    pub persona_system: String,
    pub somatic_system: String,
    pub somatic_user: String,
    pub system_prefix: String,
    pub system_suffix: String,
    pub user_prefix: String,
    pub user_suffix: String,
    pub assistant_prefix: String,
    pub eos_tokens: Vec<String>,
}

impl Default for PromptTemplates {
    fn default() -> Self {
        Self {
            router_system: "Classify the user input into exactly one of these two categories:\n1. CHAT (for greetings, casual conversation, questions)\n2. EMBODIED (for requests to move, look, perform physical actions, or strong emotions)\nOutput ONLY the word CHAT or EMBODIED.".to_string(),
            persona_system: "Your name is {soul_name}. Your personality is: {tendencies}. Your instructions: {rules}. Recent memories: {memory}. You are talking to the user. Respond with exactly one short sentence of spoken dialogue. Output ONLY your spoken words. Do not narrate actions.".to_string(),
            somatic_system: "Analyze the dialogue and output the physical intent and emotional shift of the Assistant. You MUST output EXACTLY this JSON format and nothing else:\n{\n  \"physical_intent\": \"description of physical action\",\n  \"target_vector\": [0.0, 0.0, 0.0],\n  \"emotional_shift\": {\n    \"valence\": 0.1,\n    \"arousal\": 0.1,\n    \"dominance\": 0.1\n  }\n}".to_string(),
            somatic_user: "User: \"{user_prompt}\"\nAssistant: \"{dialogue}\"\n\nOutput the JSON object:".to_string(),
            system_prefix: "System: ".to_string(),
            system_suffix: "\n\n".to_string(),
            user_prefix: "User: ".to_string(),
            user_suffix: "\n\n".to_string(),
            assistant_prefix: "Assistant: ".to_string(),
            eos_tokens: vec!["</s>".to_string(), "<|end|>".to_string(), "<|endoftext|>".to_string(), "\nUser:".to_string(), "User:".to_string()],
        }
    }
}

impl PromptTemplates {
    pub fn format_prompt(&self, system_text: &str, user_text: &str, assistant_prefill: &str) -> String {
        format!(
            "{}{}{}{}{}{}{}{}",
            self.system_prefix, system_text, self.system_suffix,
            self.user_prefix, user_text, self.user_suffix,
            self.assistant_prefix, assistant_prefill
        )
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AffectiveState {
    pub valence: f32,
    pub arousal: f32,
    pub dominance: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SomaticState {
    pub physical_intent: String,
    pub target_vector: Vec<f32>,
    pub emotional_shift: AffectiveState,
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
    pub prompts: PromptTemplates,
    pub primary_model: Arc<Mutex<ModelWeights>>,
    pub conversational_model: Option<Arc<Mutex<ModelWeights>>>,
    pub conversational_tokenizer: Option<Tokenizer>,
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
            prompts: PromptTemplates::default(),
            primary_model: Arc::new(Mutex::new(model)),
            conversational_model: None,
            conversational_tokenizer: None,
        })
    }

    pub fn set_prompt_templates(&mut self, templates: PromptTemplates) {
        self.prompts = templates;
        println!("[INFO] Cognitive prompt templates updated securely in memory.");
    }

    pub async fn fetch_model_with_fallback(
    device: &Device,
    candidates: &[(&str, &str, &str)],
) -> Result<(ModelWeights, Option<Tokenizer>, String), Box<dyn Error + Send + Sync>> {
    let api = hf_hub::api::tokio::ApiBuilder::new().build()?;

    for (i, (gguf_repo, gguf_file, tok_repo)) in candidates.iter().enumerate() {
        println!(
            "[FALLBACK PROTOCOL] Attempting candidate {}/{}: {}/{}",
            i + 1, candidates.len(), gguf_repo, gguf_file
        );

        let weights_api = api.repo(hf_hub::Repo::with_revision(
            gguf_repo.to_string(),
            hf_hub::RepoType::Model,
            "main".to_string(),
        ));

        let weights_path = match weights_api.get(gguf_file).await {
            Ok(p) => p,
            Err(e) => {
                println!("[FALLBACK PROTOCOL] [WARN] Weights failed for {}: {}. Trying next...", gguf_repo, e);
                continue;
            }
        };

        let model = match (|| -> Result<ModelWeights, Box<dyn Error + Send + Sync>> {
            let mut f = std::fs::File::open(&weights_path)?;
            let content = gguf_file::Content::read(&mut f)?;
            Ok(ModelWeights::from_gguf(content, &mut f, device)?)
        })() {
            Ok(m) => m,
            Err(e) => {
                println!("[FALLBACK PROTOCOL] [WARN] Load failed for {}: {}. Trying next...", gguf_repo, e);
                continue;
            }
        };

        let tok_api = api.repo(hf_hub::Repo::with_revision(
            tok_repo.to_string(),
            hf_hub::RepoType::Model,
            "main".to_string(),
        ));
        let tokenizer = match tok_api.get("tokenizer.json").await {
            Ok(path) => match Tokenizer::from_file(&path) {
                Ok(t) => {
                    println!("[FALLBACK PROTOCOL] Loaded tokenizer from: {}", tok_repo);
                    Some(t)
                }
                Err(e) => {
                    println!("[FALLBACK PROTOCOL] [WARN] Tokenizer parse failed ({}). Will use primary tokenizer.", e);
                    None
                }
            },
            Err(e) => {
                println!("[FALLBACK PROTOCOL] [WARN] Tokenizer not available for {} ({}). Will use primary tokenizer.", tok_repo, e);
                None
            }
        };

        println!("[FALLBACK PROTOCOL] Successfully loaded: {}/{}", gguf_repo, gguf_file);
        return Ok((model, tokenizer, gguf_repo.to_string()));
    }

    Err(format!(
        "[FALLBACK PROTOCOL] [CRITICAL] All {} candidate(s) exhausted.",
        candidates.len()
    ).into())
}

pub async fn load_conversational_model_with_fallback(
    &mut self,
    candidates: &[(&str, &str, &str)],
) -> Result<String, Box<dyn Error + Send + Sync>> {
    let (model, tokenizer, resolved_repo) =
        Self::fetch_model_with_fallback(&self.device, candidates).await?;
    self.conversational_model = Some(Arc::new(Mutex::new(model)));
    self.conversational_tokenizer = tokenizer;
    println!("[INFO] Conversational LLM loaded from: {}", resolved_repo);
    Ok(resolved_repo)
}

    pub async fn generate_cognitive_response(
        &self,
        prompt: &str,
        ctx: &CognitiveContext,
    ) -> Result<ActionIntent, Box<dyn Error + Send + Sync>> {
        let cog_start = Instant::now();

        if prompt.trim().is_empty() {
            return Err("Empty prompt provided".into());
        }

        println!("[COGNITION LOG] [{:.2}ms] Initiating Agentic Multi-LLM Orchestration.", cog_start.elapsed().as_secs_f64() * 1000.0);

        let tendencies_str = ctx.soul_tendencies.join(", ");
        let rules_str = if ctx.active_rules.is_empty() {
            "Standard operation.".to_string()
        } else {
            ctx.active_rules.join(" ")
        };

        let st_mem_str = if ctx.short_term_memory.is_empty() {
            "No recent context.".to_string()
        } else {
            ctx.short_term_memory.join("\n").replace("Embodiment sidecar", "System")
        };

        let persona_sys_compiled = self.prompts.persona_system
            .replace("{soul_name}", &ctx.soul_name)
            .replace("{tendencies}", &tendencies_str)
            .replace("{rules}", &rules_str)
            .replace("{memory}", &st_mem_str);

        let router_prompt = self.prompts.format_prompt(&self.prompts.router_system, prompt, "");
        let persona_prompt = self.prompts.format_prompt(&persona_sys_compiled, prompt, "");

        let primary_tokenizer = self.tokenizer.clone();
        let primary_arc = self.primary_model.clone();

        let conv_arc = self.conversational_model.clone();
        let conv_tokenizer = self.conversational_tokenizer.clone();

        let device = self.device.clone();
        let user_prompt = prompt.to_string();

        let eos_tokens = self.prompts.eos_tokens.clone();
        let somatic_sys_tmpl = self.prompts.somatic_system.clone();
        let somatic_usr_tmpl = self.prompts.somatic_user.clone();
        let prompts_ref = self.prompts.clone();
        let soul_name_attr = ctx.soul_name.clone();

        let intent = tokio::task::spawn_blocking(move || -> Result<ActionIntent, Box<dyn Error + Send + Sync>> {

            println!("[COGNITION LOG] [{:.2}ms] Executing Agent 0 (Cognitive Router)...", cog_start.elapsed().as_secs_f64() * 1000.0);

            let route_decision = generate_text_sync(
                &primary_tokenizer, &primary_arc, &device,
                &router_prompt, 4, Some(0.0), false, &eos_tokens,
            )?;
            let is_embodied = route_decision.to_uppercase().contains("EMBODIED");

            println!("[COGNITION LOG] [{:.2}ms] Agent 0 routed to: {}", cog_start.elapsed().as_secs_f64() * 1000.0,
                if is_embodied { "EMBODIED PIPELINE" } else { "LIGHTWEIGHT CHAT PIPELINE" });

            let (dialogue_tokenizer, dialogue_model) = match (conv_tokenizer.as_ref(), conv_arc.as_ref()) {
                (Some(tok), Some(mdl)) => {
                    println!("[COGNITION LOG] Offloading dialogue to dedicated Conversational LLM...");
                    (tok, mdl)
                }
                _ => (&primary_tokenizer, &primary_arc),
            };

            println!("[COGNITION LOG] [{:.2}ms] Executing Agent 1 (Conversational Cortex)...", cog_start.elapsed().as_secs_f64() * 1000.0);

            let dialogue = generate_text_sync(
                dialogue_tokenizer, dialogue_model, &device,
                &persona_prompt, 45, Some(0.7), false, &eos_tokens,
            )?;
            println!("[COGNITION LOG] [{:.2}ms] Agent 1 raw dialogue: \"{}\"", cog_start.elapsed().as_secs_f64() * 1000.0, dialogue);

            let mut clean_dialogue = dialogue.clone();
            if let Some(idx) = clean_dialogue.find('\n') { clean_dialogue = clean_dialogue[..idx].to_string(); }
            if let Some(idx) = clean_dialogue.find("User:") { clean_dialogue = clean_dialogue[..idx].to_string(); }
            if let Some(idx) = clean_dialogue.find("Human:") { clean_dialogue = clean_dialogue[..idx].to_string(); }

            let soul_prefix = format!("{}:", soul_name_attr);
            if clean_dialogue.starts_with(&soul_prefix) {
                clean_dialogue = clean_dialogue[soul_prefix.len()..].to_string();
            } else if clean_dialogue.starts_with("Response:") {
                clean_dialogue = clean_dialogue["Response:".len()..].to_string();
            } else if clean_dialogue.starts_with("Assistant:") {
                clean_dialogue = clean_dialogue["Assistant:".len()..].to_string();
            }
            clean_dialogue = clean_dialogue.replace('"', "").trim().to_string();
            let sentence_end = clean_dialogue
                .char_indices()
                .find(|(_, c)| *c == '.' || *c == '!' || *c == '?')
                .map(|(i, c)| i + c.len_utf8());

            if let Some(end) = sentence_end {
                clean_dialogue = clean_dialogue[..end].trim().to_string();
            }
            if is_embodied {
                let somatic_user_compiled = somatic_usr_tmpl
                    .replace("{user_prompt}", &user_prompt)
                    .replace("{dialogue}", &clean_dialogue);

                let somatic_prompt = prompts_ref.format_prompt(&somatic_sys_tmpl, &somatic_user_compiled, "{");

                println!("[COGNITION LOG] [{:.2}ms] Executing Agent 2 (Somatic Nervous System)...", cog_start.elapsed().as_secs_f64() * 1000.0);

                let json_raw = generate_text_sync(
                    &primary_tokenizer, &primary_arc, &device,
                    &somatic_prompt, 250, None, true, &eos_tokens,
                )?;

                let final_json = format!("{{{}", json_raw.trim());
                println!("[COGNITION LOG] [{:.2}ms] Agent 2 somatic JSON: {}", cog_start.elapsed().as_secs_f64() * 1000.0, final_json);

                let extract_json = if let (Some(start), Some(end)) = (final_json.find('{'), final_json.rfind('}')) {
                    &final_json[start..=end]
                } else {
                    &final_json
                };

                let somatic_state: SomaticState = match serde_json::from_str(extract_json) {
                    Ok(parsed) => parsed,
                    Err(e) => {
                        return Err(format!("Somatic JSON parse failed: {}. Payload: {}", e, extract_json).into());
                    }
                };

                Ok(ActionIntent {
                    spoken_dialogue: clean_dialogue,
                    physical_intent: somatic_state.physical_intent,
                    target_vector: somatic_state.target_vector,
                    emotional_shift: somatic_state.emotional_shift,
                })
            } else {
                println!("[COGNITION LOG] [{:.2}ms] Bypassing Agent 2 (CHAT). Default somatic state.", cog_start.elapsed().as_secs_f64() * 1000.0);
                Ok(ActionIntent {
                    spoken_dialogue: clean_dialogue,
                    physical_intent: "Casual conversational idle.".to_string(),
                    target_vector: vec![0.0, 0.0, 0.0],
                    emotional_shift: AffectiveState { valence: 0.0, arousal: 0.0, dominance: 0.0 },
                })
            }
        }).await??;

        println!("[COGNITION LOG] [{:.2}ms] Total cognitive cycle complete.", cog_start.elapsed().as_secs_f64() * 1000.0);
        Ok(intent)
    }
}

fn generate_text_sync(
    tokenizer: &Tokenizer,
    model_arc: &Arc<Mutex<ModelWeights>>,
    device: &Device,
    prompt: &str,
    max_tokens: usize,
    temperature: Option<f64>,
    json_mode: bool,
    eos_tokens: &[String],
) -> Result<String, Box<dyn Error + Send + Sync>> {
    let mut tokens = tokenizer.encode(prompt, false)?.get_ids().to_vec();
    if tokens.is_empty() {
        return Err("Tokenizer yielded 0 tokens.".into());
    }

    let mut logits_processor = LogitsProcessor::new(299792458, temperature, None);
    let mut new_tokens = vec![];
    let mut start_pos = 0;

    let eos_ids: Vec<u32> = eos_tokens.iter()
        .filter_map(|eos| tokenizer.token_to_id(eos))
        .collect();

    let mut model = model_arc.lock().map_err(|_| "Model mutex poisoned")?;

    for _ in 0..max_tokens {
        let context_size = if start_pos > 0 { 1 } else { tokens.len() };
        let start_index = tokens.len().saturating_sub(context_size);
        let input_slice = &tokens[start_index..];

        if input_slice.is_empty() { break; }

        let input_tensor = Tensor::new(input_slice, device)?.unsqueeze(0)?;
        let logits = model.forward(&input_tensor, start_pos)?;
        let logits = logits.squeeze(0)?;

        let last_logits = match logits.rank() {
            2 => {
                let seq_len = logits.dim(0)?;
                if seq_len == 0 { break; }
                logits.get(seq_len.saturating_sub(1))?
            }
            1 => logits,
            _ => break,
        };

        let next_token = logits_processor.sample(&last_logits)?;

        if eos_ids.contains(&next_token) {
            break;
        }

        tokens.push(next_token);
        new_tokens.push(next_token);
        start_pos += context_size;

        if let Ok(text) = tokenizer.decode(&new_tokens, false) {
            if json_mode {
                let open_braces = text.chars().filter(|c| *c == '{').count();
                let closed_braces = text.chars().filter(|c| *c == '}').count();
                if closed_braces > open_braces { break; }
            } else if eos_tokens.iter().any(|eos| text.contains(eos)) {
                break;
            }
        }
    }

    let generated_text = tokenizer.decode(&new_tokens, true)?;
    let mut final_clean_text = generated_text;
    for eos in eos_tokens {
        final_clean_text = final_clean_text.replace(eos, "");
    }

    Ok(final_clean_text.trim().to_string())
}