// _shared.js — SHEEPER shared utilities
// Underscore prefix = Cloudflare Pages won't expose as a route

const GITHUB_API = 'https://api.github.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

// === AUTH ===

export function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || token !== env.SHEEPER_TOKEN) {
    return false;
  }
  return true;
}

// === JSON RESPONSE ===

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

// === AI CALLS (Claude primary, OpenAI fallback) ===

export async function callAI(env, messages, { maxTokens = 16000, system = null } = {}) {
  // Try Claude first
  if (env.CLAUDE_API_KEY) {
    try {
      const result = await callClaude(env.CLAUDE_API_KEY, messages, { maxTokens, system });
      return { text: result, provider: 'claude' };
    } catch (err) {
      console.error('Claude failed, trying OpenAI fallback:', err.message);
    }
  }

  // Fallback to OpenAI
  if (env.OPENAI_API_KEY) {
    try {
      const result = await callOpenAI(env.OPENAI_API_KEY, messages, { maxTokens, system });
      return { text: result, provider: 'openai' };
    } catch (err) {
      throw new Error(`Both AI providers failed. Last error: ${err.message}`);
    }
  }

  throw new Error('No AI API keys configured. Set CLAUDE_API_KEY and/or OPENAI_API_KEY.');
}

async function callClaude(apiKey, messages, { maxTokens, system }) {
  const body = {
    model: 'claude-sonnet-4-20250514',
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
  return data.content.map(c => c.text || '').join('');
}

async function callOpenAI(apiKey, messages, { maxTokens, system }) {
  // Convert to OpenAI format: add system message at front
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  openaiMessages.push(...messages);

  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages: openaiMessages
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errBody.substring(0, 300)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// === JSON EXTRACTION ===

export function extractJson(text) {
  // Direct parse
  try { return JSON.parse(text); } catch {}

  // Strip markdown fences
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}

  // Find first { ... } block (greedy)
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  // Find first [ ... ] block
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }

  throw new Error('Could not extract JSON from AI response');
}

// === GITHUB API HELPERS ===

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
    throw new Error(`GitHub GET ${path}: ${res.status} — ${body.substring(0, 200)}`);
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
    throw new Error(`GitHub POST ${path}: ${res.status} — ${errText.substring(0, 200)}`);
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
    throw new Error(`GitHub PATCH ${path}: ${res.status} — ${errText.substring(0, 200)}`);
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

// === COMMIT MULTIPLE FILES TO A BRANCH ===

export async function githubCommitFiles(owner, repo, branch, files, commitMessage, token) {
  // 1. Get branch HEAD
  const ref = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  const headSha = ref.object.sha;

  // 2. Get commit tree
  const headCommit = await githubGet(`/repos/${owner}/${repo}/git/commits/${headSha}`, token);
  const baseTreeSha = headCommit.tree.sha;

  // 3. Create blobs for each file
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

  // 4. Create new tree
  const newTree = await githubPost(`/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries
  }, token);

  // 5. Create commit
  const newCommit = await githubPost(`/repos/${owner}/${repo}/git/commits`, {
    message: commitMessage,
    tree: newTree.sha,
    parents: [headSha]
  }, token);

  // 6. Update branch ref
  await githubPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: newCommit.sha
  }, token);

  return newCommit.sha;
}

// === GET REPO FILE TREE ===

export async function githubGetTree(owner, repo, branch, token) {
  const ref = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  const commit = await githubGet(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, token);
  const tree = await githubGet(
    `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`,
    token
  );

  return tree.tree
    .filter(f => f.type === 'blob')
    .map(f => f.path);
}
