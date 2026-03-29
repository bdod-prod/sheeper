const GITHUB_API = 'https://api.github.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const XAI_API = 'https://api.x.ai/v1/chat/completions';

const DEFAULT_PROVIDER_ORDER = ['claude', 'openai', 'grok'];
const TASK_PROVIDER_ORDER = {
  intake_chat: ['grok', 'openai', 'claude'],
  brief_compile: ['claude', 'openai', 'grok'],
  plan: ['claude', 'openai', 'grok'],
  step: ['claude', 'openai', 'grok'],
  edit_select: ['grok', 'openai', 'claude'],
  edit: ['claude', 'openai', 'grok']
};

const DEFAULT_AI_MODELS = {
  claude: 'claude-opus-4-6',
  openai: 'gpt-5.4',
  grok: 'grok-4.20-beta-latest-non-reasoning'
};

export function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  return Boolean(token && token === env.SHEEPER_TOKEN);
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

export async function callAI(env, messages, {
  maxTokens = 16000,
  system = null,
  task = 'default'
} = {}) {
  const strategy = resolveProviderStrategy(env, task);
  const errors = [];

  for (const provider of strategy.providers) {
    if (!hasProviderCredentials(env, provider)) {
      continue;
    }

    try {
      return await callSpecificProvider(env, provider, messages, { maxTokens, system, task });
    } catch (err) {
      errors.push(`${provider}: ${err.message}`);
      console.error(`${provider} failed during ${task}:`, err.message);
    }
  }

  if (!errors.length) {
    if (strategy.strict) {
      throw new Error(`${strategy.providers[0]} is selected for ${task}, but its API key is not configured.`);
    }
    throw new Error('No AI API keys configured. Set CLAUDE_API_KEY, OPENAI_API_KEY, and/or XAI_API_KEY.');
  }

  throw new Error(`All AI providers failed for ${task}. ${errors.join(' | ')}`);
}

function resolveProviderStrategy(env, task) {
  const taskKey = task && task !== 'default'
    ? `AI_PROVIDER_${task.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    : null;

  const taskValue = normalizeProvider(taskKey ? env[taskKey] : '');
  if (taskValue && taskValue !== 'auto') {
    return { providers: [taskValue], strict: true };
  }

  const globalValue = normalizeProvider(env.AI_PROVIDER || 'auto');
  if (globalValue && globalValue !== 'auto') {
    return { providers: [globalValue], strict: true };
  }

  return {
    providers: TASK_PROVIDER_ORDER[task] || DEFAULT_PROVIDER_ORDER,
    strict: false
  };
}

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return null;
  if (normalized === 'auto') return 'auto';
  if (normalized === 'claude' || normalized === 'anthropic') return 'claude';
  if (normalized === 'openai' || normalized === 'gpt') return 'openai';
  if (normalized === 'grok' || normalized === 'xai') return 'grok';

  throw new Error(`Unsupported AI provider "${value}". Use auto, claude, openai, or grok.`);
}

function hasProviderCredentials(env, provider) {
  if (provider === 'claude') return Boolean(env.CLAUDE_API_KEY);
  if (provider === 'openai') return Boolean(env.OPENAI_API_KEY);
  if (provider === 'grok') return Boolean(env.XAI_API_KEY);
  return false;
}

async function callSpecificProvider(env, provider, messages, { maxTokens, system, task }) {
  if (!hasProviderCredentials(env, provider)) {
    throw new Error(`${provider} selected for ${task}, but its API key is not configured.`);
  }

  const model = resolveModel(env, provider);
  let text;

  if (provider === 'claude') {
    text = await callClaude(env.CLAUDE_API_KEY, model, messages, { maxTokens, system });
  } else if (provider === 'openai') {
    text = await callOpenAICompatible(OPENAI_API, env.OPENAI_API_KEY, model, messages, { maxTokens, system });
  } else if (provider === 'grok') {
    text = await callOpenAICompatible(XAI_API, env.XAI_API_KEY, model, messages, { maxTokens, system });
  } else {
    throw new Error(`Unsupported AI provider "${provider}".`);
  }

  return { text, provider, model };
}

function resolveModel(env, provider) {
  if (provider === 'claude') {
    return env.CLAUDE_MODEL || DEFAULT_AI_MODELS.claude;
  }
  if (provider === 'openai') {
    return env.OPENAI_MODEL || DEFAULT_AI_MODELS.openai;
  }
  if (provider === 'grok') {
    return env.XAI_MODEL || DEFAULT_AI_MODELS.grok;
  }

  throw new Error(`Unsupported AI provider "${provider}".`);
}

async function callClaude(apiKey, model, messages, { maxTokens, system }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages
  };

  if (system) {
    body.system = system;
  }

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API ${res.status}: ${errBody.substring(0, 300)}`);
  }

  const data = await res.json();
  return extractClaudeText(data.content);
}

async function callOpenAICompatible(endpoint, apiKey, model, messages, { maxTokens, system }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: toOpenAICompatibleMessages(messages, system)
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${endpoint} ${res.status}: ${errBody.substring(0, 300)}`);
  }

  const data = await res.json();
  return extractChatCompletionText(data);
}

function toOpenAICompatibleMessages(messages, system) {
  const openaiMessages = [];

  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }

  openaiMessages.push(...messages);
  return openaiMessages;
}

function extractClaudeText(contentBlocks) {
  return (contentBlocks || [])
    .map((block) => extractMessageText(block?.text ?? block))
    .filter(Boolean)
    .join('');
}

function extractChatCompletionText(data) {
  const message = data?.choices?.[0]?.message;
  const text = extractMessageText(message?.content);

  if (!text) {
    throw new Error('AI provider returned an empty completion.');
  }

  return text;
}

function extractMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        if (typeof part?.value === 'string') return part.value;
        if (typeof part?.text?.value === 'string') return part.text.value;
        return '';
      })
      .join('');
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (typeof content.value === 'string') return content.value;
    if (typeof content.text?.value === 'string') return content.text.value;
  }

  return '';
}

export function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }

  throw new Error('Could not extract JSON from AI response');
}

export async function githubGet(path, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GET ${path}: ${res.status} - ${body.substring(0, 200)}`);
  }

  return res.json();
}

export async function githubPost(path, body, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub POST ${path}: ${res.status} - ${errText.substring(0, 200)}`);
  }

  return res.json();
}

export async function githubPatch(path, body, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub PATCH ${path}: ${res.status} - ${errText.substring(0, 200)}`);
  }

  return res.json();
}

export async function githubDelete(path, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub DELETE ${path}: ${res.status}`);
  }

  return res.status;
}

export async function githubGetFile(owner, repo, filePath, ref, token) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub file ${filePath}: ${res.status}`);
  }

  return res.text();
}

export async function githubGetFileSafe(owner, repo, filePath, ref, token) {
  try {
    return await githubGetFile(owner, repo, filePath, ref, token);
  } catch {
    return null;
  }
}

export async function githubCommitFiles(owner, repo, branch, files, commitMessage, token) {
  const ref = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  const headSha = ref.object.sha;
  const headCommit = await githubGet(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
  const baseTreeSha = headCommit.tree.sha;

  const treeEntries = [];
  for (const file of files) {
    const encoding = file.encoding || 'utf-8';
    const blob = await githubPost(`/repos/${owner}/${repo}/git/blobs`, {
      content: file.content,
      encoding
    }, token);

    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }

  const newTree = await githubPost(`/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries
  }, token);

  const newCommit = await githubPost(`/repos/${owner}/${repo}/git/commits`, {
    message: commitMessage,
    tree: newTree.sha,
    parents: [headSha]
  }, token);

  await githubPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: newCommit.sha
  }, token);

  return newCommit.sha;
}

export async function githubGetTree(owner, repo, branch, token) {
  const ref = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  const commit = await githubGet(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, token);
  const tree = await githubGet(
    `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`,
    token
  );

  return tree.tree
    .filter((file) => file.type === 'blob')
    .map((file) => file.path);
}
