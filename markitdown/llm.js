const QWEN_OPENAI_COMPAT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_DOCUMENT_MARKDOWN_PROMPT = 'qwenvl markdown';
const QWEN_API_KEY_ENV = 'DASHSCOPE_API_KEY';

function normalizeMarkItDownLlmClient(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isQwenCompatibleLlmClient(value = '') {
  const normalized = normalizeMarkItDownLlmClient(value);
  return normalized === 'qwen' || normalized === 'dashscope';
}

function getDefaultBaseURLForLlmClient(value = '') {
  return isQwenCompatibleLlmClient(value)
    ? QWEN_OPENAI_COMPAT_BASE_URL
    : '';
}

function getDefaultPromptForLlmClient(value = '') {
  return isQwenCompatibleLlmClient(value)
    ? QWEN_DOCUMENT_MARKDOWN_PROMPT
    : '';
}

function getDefaultApiKeyEnvForLlmClient(value = '') {
  return isQwenCompatibleLlmClient(value)
    ? QWEN_API_KEY_ENV
    : '';
}

module.exports = {
  QWEN_API_KEY_ENV,
  QWEN_DOCUMENT_MARKDOWN_PROMPT,
  QWEN_OPENAI_COMPAT_BASE_URL,
  getDefaultApiKeyEnvForLlmClient,
  getDefaultBaseURLForLlmClient,
  getDefaultPromptForLlmClient,
  isQwenCompatibleLlmClient,
  normalizeMarkItDownLlmClient,
};
