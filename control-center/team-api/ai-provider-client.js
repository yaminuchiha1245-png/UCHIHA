'use strict';

const https = require('node:https');

const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI API',
    host: 'api.openai.com',
    path: '/v1/models'
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    label: 'Anthropic API',
    host: 'api.anthropic.com',
    path: '/v1/models?limit=1000'
  }),
  gemini: Object.freeze({
    id: 'gemini',
    label: 'Gemini API',
    host: 'generativelanguage.googleapis.com',
    path: '/v1beta/models?pageSize=1000'
  })
});

const CONNECT_TIMEOUT_MS = 10000;
const READ_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function validateProvider(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, id)) {
    const error = new Error('Unsupported AI provider.');
    error.code = 'ai_provider_invalid';
    throw error;
  }
  return id;
}

function validateApiKey(value) {
  const key = String(value || '').trim();
  if (key.length < 8 || key.length > 2048 || /[\r\n\0]/.test(key)) {
    const error = new Error('Invalid AI API key.');
    error.code = 'ai_key_invalid';
    throw error;
  }
  return key;
}

function buildRequest(providerValue, apiKeyValue) {
  const provider = validateProvider(providerValue);
  const apiKey = validateApiKey(apiKeyValue);
  const info = PROVIDERS[provider];
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'UCHIHA-Control-Center/2.0.0-alpha16'
  };
  if (provider === 'openai') {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['x-goog-api-key'] = apiKey;
    headers['x-goog-api-client'] = 'uchiha-control-center/2.0.0-alpha16';
  }
  return {
    method: 'GET',
    protocol: 'https:',
    hostname: info.host,
    port: 443,
    path: info.path,
    headers
  };
}

function safeModel(id, name) {
  const value = String(id || '').trim();
  if (!value || value.length > 200 || /[\r\n\0]/.test(value)) return null;
  const label = String(name || value).trim().slice(0, 200) || value;
  return { id: value, name: label };
}

function normalizeProviderResponse(providerValue, body) {
  const provider = validateProvider(providerValue);
  const parsed = body && typeof body === 'object' ? body : {};
  let rows = [];
  if (provider === 'openai') {
    rows = Array.isArray(parsed.data) ? parsed.data.map((item) => safeModel(item && item.id, item && item.id)) : [];
  } else if (provider === 'anthropic') {
    rows = Array.isArray(parsed.data) ? parsed.data.map((item) => safeModel(item && item.id, item && item.display_name)) : [];
  } else {
    rows = Array.isArray(parsed.models) ? parsed.models.map((item) => {
      const raw = String(item && item.name || '');
      const id = raw.startsWith('models/') ? raw.slice(7) : raw;
      return safeModel(id, item && item.displayName);
    }) : [];
  }
  const unique = new Map();
  for (const row of rows) if (row && !unique.has(row.id)) unique.set(row.id, row);
  const models = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!models.length) {
    const error = new Error('Provider returned no usable models.');
    error.code = 'ai_provider_response_invalid';
    throw error;
  }
  return models;
}

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const status = Number(res.statusCode || 0);
      if (status >= 300 && status < 400) {
        res.resume();
        const error = new Error('AI provider redirect rejected.');
        error.code = 'ai_provider_redirect_rejected';
        reject(error);
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(Object.assign(new Error('AI provider response too large.'), { code: 'ai_provider_response_too_large' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          const error = new Error('AI provider rejected credentials.');
          error.code = status === 401 || status === 403 ? 'ai_credentials_rejected' : 'ai_provider_unavailable';
          error.status = status;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('Invalid AI provider response.'), { code: 'ai_provider_response_invalid' }));
        }
      });
    });
    req.setTimeout(READ_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('AI provider timed out.'), { code: 'ai_provider_timeout' })));
    req.on('socket', (socket) => socket.setTimeout(CONNECT_TIMEOUT_MS));
    req.on('error', (error) => {
      if (error && error.code && String(error.code).startsWith('ai_')) reject(error);
      else reject(Object.assign(new Error('AI provider request failed.'), { code: 'ai_provider_unavailable' }));
    });
    req.end();
  });
}

async function listModels(provider, apiKey, transport = requestJson) {
  const id = validateProvider(provider);
  const options = buildRequest(id, apiKey);
  const body = await transport(options);
  return normalizeProviderResponse(id, body);
}

function publicProvider(providerValue) {
  const id = validateProvider(providerValue);
  return { id, label: PROVIDERS[id].label };
}

module.exports = {
  PROVIDERS,
  validateProvider,
  validateApiKey,
  buildRequest,
  normalizeProviderResponse,
  listModels,
  publicProvider
};
