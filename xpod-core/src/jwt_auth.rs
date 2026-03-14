use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct VectorClaims {
    pub sub: String,
    pub iat: usize,
    pub nbf: usize,
    pub exp: usize,
}

pub struct JwtManager {
    secret: String,
}

impl JwtManager {
    pub fn new(secret: &str) -> Self {
        Self {
            secret: secret.to_string(),
        }
    }

    pub fn generate_vector_token(&self, robot_esn: &str) -> Result<String, jsonwebtoken::errors::Error> {
        let past_timestamp: usize = 1420070400;
        
        let future_timestamp: usize = 2114380800;

        let claims = VectorClaims {
            sub: robot_esn.to_string(),
            iat: past_timestamp,
            nbf: past_timestamp,
            exp: future_timestamp,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }
}