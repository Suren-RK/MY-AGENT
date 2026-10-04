const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const providers = {
  openrouter: {
    apiKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    visionModel: process.env.OPENROUTER_VISION_MODEL || 'openai/gpt-4o'
  },
  groq: {
    apiKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    visionModel: process.env.GROQ_VISION_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  },
  custom: {
    apiKey: 'CUSTOM_API_KEY',
    baseUrl: process.env.CUSTOM_BASE_URL,
    model: process.env.CUSTOM_MODEL,
    visionModel: process.env.CUSTOM_VISION_MODEL || process.env.CUSTOM_MODEL
  }
};

const providerName = String(process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const provider = providers[providerName];

if (!provider) {
  console.error(`Unknown LLM_PROVIDER: ${providerName}`);
  console.error(`Supported providers: ${Object.keys(providers).join(', ')}`);
  process.exit(1);
}

const apiKey = process.env[provider.apiKey];
if (!apiKey) {
  console.error(`Missing ${provider.apiKey} for provider "${providerName}".`);
  process.exit(1);
}

if (!provider.baseUrl) {
  console.error(`Missing base URL for provider "${providerName}".`);
  process.exit(1);
}

// server.js already uses the OpenAI SDK. These normalized variables let the
// same agent code work with any OpenAI-compatible provider without duplicating
// provider logic throughout the planner, builder, debugger and QA pipeline.
process.env.OPENROUTER_API_KEY = apiKey;
process.env.OPENROUTER_BASE_URL = provider.baseUrl;
process.env.OPENROUTER_MODEL = provider.model;
process.env.OPENROUTER_VISION_MODEL = provider.visionModel;

console.log(`MY-AGENT LLM provider: ${providerName}`);
console.log(`MY-AGENT model: ${provider.model}`);

const child = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on('error', error => {
  console.error('Failed to start MY-AGENT:', error.message);
  process.exit(1);
});
