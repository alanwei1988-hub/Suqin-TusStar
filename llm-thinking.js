function toProviderOptionsName(providerName = '') {
  const normalized = String(providerName || '').trim();

  if (!normalized) {
    return 'openaiCompatible';
  }

  return normalized
    .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, char => char.toLowerCase());
}

function normalizeThinkingConfig(config, { defaultEnabled } = {}) {
  const normalizedConfig = typeof config === 'boolean'
    ? { enabled: config }
    : (config && typeof config === 'object' && !Array.isArray(config) ? config : {});
  const normalized = {};

  if (typeof normalizedConfig.enabled === 'boolean') {
    normalized.enabled = normalizedConfig.enabled;
  } else if (typeof defaultEnabled === 'boolean') {
    normalized.enabled = defaultEnabled;
  }

  if (typeof normalizedConfig.reasoningEffort === 'string' && normalizedConfig.reasoningEffort.trim().length > 0) {
    normalized.reasoningEffort = normalizedConfig.reasoningEffort.trim();
  }

  if (typeof normalizedConfig.textVerbosity === 'string' && normalizedConfig.textVerbosity.trim().length > 0) {
    normalized.textVerbosity = normalizedConfig.textVerbosity.trim();
  }

  if (Number.isFinite(normalizedConfig.budgetTokens)) {
    normalized.budgetTokens = Math.max(0, Math.trunc(normalizedConfig.budgetTokens));
  }

  if (normalizedConfig.extraBody && typeof normalizedConfig.extraBody === 'object' && !Array.isArray(normalizedConfig.extraBody)) {
    normalized.extraBody = { ...normalizedConfig.extraBody };
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildThinkingExtraBody(thinkingConfig, { includeStandardized = true } = {}) {
  if (!thinkingConfig || typeof thinkingConfig !== 'object') {
    return null;
  }

  const extraBody = {};

  if (typeof thinkingConfig.enabled === 'boolean') {
    extraBody.enable_thinking = thinkingConfig.enabled;
  }

  if (includeStandardized && typeof thinkingConfig.reasoningEffort === 'string' && thinkingConfig.reasoningEffort.trim().length > 0) {
    extraBody.reasoning_effort = thinkingConfig.reasoningEffort.trim();
  }

  if (includeStandardized && typeof thinkingConfig.textVerbosity === 'string' && thinkingConfig.textVerbosity.trim().length > 0) {
    extraBody.verbosity = thinkingConfig.textVerbosity.trim();
  }

  if (Number.isFinite(thinkingConfig.budgetTokens)) {
    extraBody.budget_tokens = Math.max(0, Math.trunc(thinkingConfig.budgetTokens));
  }

  if (thinkingConfig.extraBody && typeof thinkingConfig.extraBody === 'object' && !Array.isArray(thinkingConfig.extraBody)) {
    Object.assign(extraBody, thinkingConfig.extraBody);
  }

  return Object.keys(extraBody).length > 0 ? extraBody : null;
}

function buildOpenAICompatibleProviderOptions(providerName, thinkingConfig) {
  if (!thinkingConfig || typeof thinkingConfig !== 'object') {
    return undefined;
  }

  const providerSpecificOptions = {};

  if (typeof thinkingConfig.reasoningEffort === 'string' && thinkingConfig.reasoningEffort.trim().length > 0) {
    providerSpecificOptions.reasoningEffort = thinkingConfig.reasoningEffort.trim();
  }

  if (typeof thinkingConfig.textVerbosity === 'string' && thinkingConfig.textVerbosity.trim().length > 0) {
    providerSpecificOptions.textVerbosity = thinkingConfig.textVerbosity.trim();
  }

  const extraBody = buildThinkingExtraBody(thinkingConfig, { includeStandardized: false });
  if (extraBody) {
    Object.assign(providerSpecificOptions, extraBody);
  }

  if (Object.keys(providerSpecificOptions).length === 0) {
    return undefined;
  }

  return {
    [toProviderOptionsName(providerName)]: providerSpecificOptions,
  };
}

module.exports = {
  buildOpenAICompatibleProviderOptions,
  buildThinkingExtraBody,
  normalizeThinkingConfig,
  toProviderOptionsName,
};
