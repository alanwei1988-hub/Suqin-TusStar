function humanizeToolName(toolName) {
  return String(toolName || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function fallbackStatusText(toolName) {
  const normalizedToolName = String(toolName || '').trim();
  const humanized = humanizeToolName(normalizedToolName);

  if (!humanized) {
    return '处理中';
  }

  if (/\bcontract\b/.test(humanized) && /\b(read|get|list|search|query|find|fetch|validate)\b/.test(humanized)) {
    return '查询合同信息';
  }

  if (/\bcontract\b/.test(humanized) && /\b(create|add|insert|save|write|update|edit|modify|generate)\b/.test(humanized)) {
    return '处理合同信息';
  }

  if (/^(read|get|list|search|query|find|fetch|validate)\b/.test(humanized)) {
    return '查询信息';
  }

  if (/^(create|add|insert|save|write|update|edit|modify|generate)\b/.test(humanized)) {
    return '处理信息';
  }

  if (/^(send|upload|export|download|share)\b/.test(humanized)) {
    return '传输文件或数据';
  }

  if (/\b(file|attachment|document|invoice)\b/.test(humanized)) {
    return '处理文件资料';
  }

  return '调用系统工具处理';
}

function createToolDisplayInfo(toolName, overrides = {}) {
  const displayName = typeof overrides.displayName === 'string' && overrides.displayName.trim().length > 0
    ? overrides.displayName.trim()
    : humanizeToolName(toolName) || String(toolName || '').trim();
  const statusText = typeof overrides.statusText === 'string' && overrides.statusText.trim().length > 0
    ? overrides.statusText.trim()
    : fallbackStatusText(toolName);

  return {
    displayName,
    statusText,
  };
}

module.exports = {
  createToolDisplayInfo,
  fallbackStatusText,
  humanizeToolName,
};
