import 'dotenv/config';

function optional(name, fallback = '') {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(optional('PORT', '3000')),
  nodeEnv: optional('NODE_ENV', 'development'),

  metaVerifyToken: optional('META_VERIFY_TOKEN'),
  metaAppSecret: optional('META_APP_SECRET'),

  whatsappAccessToken: optional('WHATSAPP_ACCESS_TOKEN'),
  phoneNumberId: optional('PHONE_NUMBER_ID'),
  graphApiVersion: optional('GRAPH_API_VERSION', 'v25.0'),
  groqApiKey: optional('GROQ_API_KEY'),
};