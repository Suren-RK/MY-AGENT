const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const providers = {
  ollama: {
    apiKey: 'OLLAMA_API_KEY',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
    visionModel: process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:2b',
    requiresApiKey: false
  },
  groq: {
    apiKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    visionModel: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
    requiresApiKey: true
  },
  openrouter: {
    apiKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    visionModel: process.env.OPENROUTER_VISION_MODEL || 'openai/gpt-4o',
    requiresApiKey: true
  },
  custom: {
    apiKey: 'CUSTOM_API_KEY',
    baseUrl: process.env.CUSTOM_BASE_URL,
    model: process.env.CUSTOM_MODEL,
    visionModel: process.env.CUSTOM_VISION_MODEL || process.env.CUSTOM_MODEL,
    requiresApiKey: true
  }
};

const providerName = String(process.env.LLM_PROVIDER || 'ollama').toLowerCase();
const provider = providers[providerName];

if (!provider) {
  console.error(`Unknown LLM_PROVIDER: ${providerName}`);
  console.error(`Supported providers: ${Object.keys(providers).join(', ')}`);
  process.exit(1);
}

const apiKey = process.env[provider.apiKey];

if (provider.requiresApiKey && !apiKey) {
  console.error(`Missing ${provider.apiKey} for provider "${providerName}".`);
  process.exit(1);
}

if (!provider.baseUrl) {
  console.error(`Missing base URL for provider "${providerName}".`);
  process.exit(1);
}

if (!provider.model) {
  console.error(`Missing model for provider "${providerName}".`);
  process.exit(1);
}

// The OpenAI SDK requires an apiKey value, but local Ollama ignores it.
process.env.OPENROUTER_API_KEY = apiKey || 'ollama-local';
process.env.OPENROUTER_BASE_URL = provider.baseUrl;
process.env.OPENROUTER_MODEL = provider.model;
process.env.OPENROUTER_VISION_MODEL = provider.visionModel;

console.log(`MY-AGENT LLM provider: ${providerName}`);
console.log(`MY-AGENT model: ${provider.model}`);
console.log(`MY-AGENT vision model: ${provider.visionModel}`);
console.log(`MY-AGENT LLM endpoint: ${provider.baseUrl}`);

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
