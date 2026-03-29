const PROJECTS_KEY = 'sheeper_projects';
const STARTER_DRAFT_KEY = 'sheeper_starter_draft';
const MAX_INTAKE_TURNS = 5;
const STARTER_SOURCE_TEXT_LIMIT = 16000;
const STARTER_SOURCE_FILE_LIMIT = 3;
const STARTER_EXAMPLES = [
  {
    label: 'Portfolio, tonight',
    prompt: 'Build a one-page portfolio for a multidisciplinary creative. Dark theme, single-scroll layout, work samples in a tight grid, short about section, and a hire-me contact CTA at the bottom. Keep it fast, sharp, and free of decorative fluff.'
  },
  {
    label: 'Freelance studio',
    prompt: 'Create a premium one-page site for a freelance product engineering studio. Confident tone, minimal typography, sections for hero, services, selected work, process, and contact. Make it feel serious, modern, and ready to send to clients tonight.'
  },
  {
    label: 'Product launch',
    prompt: 'Build a focused landing page for a new SaaS launch. Strong hero, product benefits, feature breakdown, social proof, pricing teaser, and waitlist CTA. Clean, fast, and conversion-first without looking generic.'
  },
  {
    label: 'Side hustle page',
    prompt: 'Make a one-page site for a side hustle that sells a digital product. Warm but direct tone, simple structure, sections for problem, offer, what is included, FAQ, and buy CTA. It should feel trustworthy and launch-ready in one pass.'
  },
  {
    label: 'Surprise me',
    prompt: 'Create something unexpected but usable: a one-page website for a niche business with a bold visual direction, strong headline, memorable sections, and a clear CTA. Avoid safe startup cliches and make it feel intentionally designed.'
  }
];
let authToken = '';
let projects = loadProjects();
let starterDraft = loadStarterDraft();
let proj = null;
let mode = 'build';
let uploads = [];
let busy = false;

initApp();

async function initApp() {
  const tokenInput = byId('tokIn');
  if (tokenInput) {
    tokenInput.addEventListener('keydown', handleAuthKeydown);
    tokenInput.addEventListener('input', () => setAuthError(''));
  }
  bindStarterInputs();
  renderDashboard();
  await bootstrapAuth();
}

async function handleAuthKeydown(event) {
  if (event.key !== 'Enter') return;
  const token = event.target.value.trim();
  if (!token) return;
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error('Invalid token');
    authToken = '';
    event.target.value = '';
    setAuthError('');
    show('dashV');
    renderDashboard();
  } catch {
    setAuthError('Invalid token. Try again.');
    event.target.value = '';
  }
}

async function bootstrapAuth() {
  try {
    const response = await fetch('/api/auth', {
      method: 'GET',
      credentials: 'same-origin'
    });
    if (!response.ok) {
      show('authV');
      return;
    }
    authToken = '';
    setAuthError('');
    show('dashV');
    renderDashboard();
  } catch {
    show('authV');
  }
}

async function logout() {
  try {
    await fetch('/api/auth', {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  } catch {}

  authToken = '';
  proj = null;
  mode = 'build';
  clearLog();
  setAuthError('');
  show('authV');
  const tokenInput = byId('tokIn');
  if (tokenInput) {
    tokenInput.value = '';
    tokenInput.focus();
  }
}

function bindStarterInputs() {
  ['starterDomain', 'starterLanguage', 'starterTemplateRepo'].forEach((id) => {
    const element = byId(id);
    if (!element) return;
    element.addEventListener('input', () => {
      syncStarterFromInputs();
      setStarterError('');
      renderStarter();
      renderProjects();
    });
  });

  const composer = byId('starterComposer');
  if (composer) {
    composer.addEventListener('input', () => {
      syncStarterFromInputs();
      setStarterError('');
      renderStarter();
    });
    composer.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submitStarterMessage();
      }
    });
  }

  ['starterSourceUrl', 'starterSourceMode', 'starterSourceText'].forEach((id) => {
    const element = byId(id);
    if (!element) return;
    const eventName = element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventName, () => {
      syncStarterFromInputs();
      setStarterError('');
      renderStarter();
    });
  });

  const sourceInput = byId('starterSourceInput');
  if (sourceInput) {
    sourceInput.addEventListener('change', async (event) => {
      await handleStarterSourceFiles(event.target.files);
      event.target.value = '';
    });
  }

  const details = byId('advDetails');
  if (details) {
    details.addEventListener('toggle', () => {
      starterDraft.advancedOpen = details.open;
      saveStarterDraft();
      renderStarter();
    });
  }
}

function byId(id) { return document.getElementById(id); }
function valueOf(id) { return byId(id)?.value?.trim() || ''; }
function setValue(id, value) { const element = byId(id); if (element) element.value = value || ''; }

function defaultStarterDraft() {
  return {
    composer: '',
    history: [],
    compiledBrief: null,
    summary: '',
    assumptions: [],
    missingTopics: [],
    status: 'idle',
    turns: 0,
    followUpMode: false,
    advancedOpen: false,
    advanced: { domain: '', language: 'en', templateRepo: '' },
    sourceMaterial: {
      url: '',
      mode: 'modernize',
      text: '',
      files: [],
      urlTitle: '',
      urlText: ''
    }
  };
}

function loadStarterDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(STARTER_DRAFT_KEY) || '{}');
    return mergeStarterDraft(stored);
  } catch {
    return defaultStarterDraft();
  }
}

function mergeStarterDraft(stored = {}) {
  const base = defaultStarterDraft();
  return {
    ...base,
    ...stored,
    history: Array.isArray(stored.history) ? stored.history.filter(isMessage) : [],
    assumptions: Array.isArray(stored.assumptions) ? stored.assumptions.filter(Boolean) : [],
    missingTopics: Array.isArray(stored.missingTopics) ? stored.missingTopics.filter(Boolean) : [],
    compiledBrief: stored.compiledBrief && typeof stored.compiledBrief === 'object' ? stored.compiledBrief : null,
    advanced: { ...base.advanced, ...(stored.advanced || {}) },
    sourceMaterial: normalizeStarterSourceMaterial(stored.sourceMaterial)
  };
}

function saveStarterDraft() {
  localStorage.setItem(STARTER_DRAFT_KEY, JSON.stringify(starterDraft));
}

function loadProjects() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveProjects() {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function show(id) {
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  byId(id)?.classList.add('active');
}

function toDash() {
  proj = null;
  mode = 'build';
  show('dashV');
  renderDashboard();
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll('.nav-b').forEach((button) => button.classList.toggle('on', button.dataset.m === nextMode));
  const sideBar = byId('sideB');
  if (sideBar) sideBar.style.display = nextMode === 'build' ? '' : 'none';
  renderWork();
}

async function api(path, data) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(data)
  });
  const raw = await response.text();
  let json = null;
  if (raw) {
    try { json = JSON.parse(raw); } catch { json = null; }
  }
  if (!response.ok) {
    const detail = json?.error || json?.message || raw.trim();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  if (!json) throw new Error(`Unexpected empty response from ${path}`);
  return json;
}

function syncStarterFromInputs() {
  starterDraft.composer = valueOf('starterComposer');
  starterDraft.advanced = {
    domain: valueOf('starterDomain'),
    language: valueOf('starterLanguage') || 'en',
    templateRepo: valueOf('starterTemplateRepo')
  };
  const nextUrl = valueOf('starterSourceUrl');
  starterDraft.sourceMaterial = {
    ...starterDraft.sourceMaterial,
    url: nextUrl,
    mode: valueOf('starterSourceMode') || 'modernize',
    text: truncateStarterText(valueOf('starterSourceText')),
    urlTitle: nextUrl === starterDraft.sourceMaterial.url ? starterDraft.sourceMaterial.urlTitle : '',
    urlText: nextUrl === starterDraft.sourceMaterial.url ? starterDraft.sourceMaterial.urlText : ''
  };
  const details = byId('advDetails');
  starterDraft.advancedOpen = Boolean(details?.open);
  saveStarterDraft();
}

function applyStarterDraftToInputs() {
  setValue('starterComposer', starterDraft.composer);
  setValue('starterDomain', starterDraft.advanced.domain);
  setValue('starterLanguage', starterDraft.advanced.language || 'en');
  setValue('starterTemplateRepo', starterDraft.advanced.templateRepo);
  setValue('starterSourceUrl', starterDraft.sourceMaterial.url);
  setValue('starterSourceMode', starterDraft.sourceMaterial.mode || 'modernize');
  setValue('starterSourceText', starterDraft.sourceMaterial.text);
  const details = byId('advDetails');
  if (details) details.open = Boolean(starterDraft.advancedOpen);
}

function renderDashboard() {
  applyStarterDraftToInputs();
  renderStarter();
  renderProjects();
}

function renderStarter() {
  const thread = byId('starterThread');
  const briefSlot = byId('starterBriefSlot');
  const meta = byId('starterMeta');
  const examples = byId('starterExamples');
  const sourceFiles = byId('starterSourceFiles');
  const sendButton = byId('starterSendBtn');
  const resetButton = byId('starterResetBtn');
  const composer = byId('starterComposer');

  if (thread) {
    thread.innerHTML = starterDraft.history.length ? starterDraft.history.map(renderMessageBubble).join('') : renderStarterEmptyState();
    thread.scrollTop = thread.scrollHeight;
  }

  if (briefSlot) {
    briefSlot.innerHTML = starterDraft.compiledBrief && starterDraft.status === 'ready' && !starterDraft.followUpMode ? renderBriefCard(starterDraft.compiledBrief) : '';
  }

  if (examples) {
    examples.innerHTML = renderStarterExampleChips();
    examples.querySelectorAll('[data-starter-example]').forEach((button) => {
      button.addEventListener('click', () => applyStarterExample(Number(button.dataset.starterExample)));
    });
  }

  if (sourceFiles) {
    sourceFiles.innerHTML = renderStarterSourceFiles();
    sourceFiles.querySelectorAll('[data-remove-source-index]').forEach((button) => {
      button.addEventListener('click', () => removeStarterSourceFile(Number(button.dataset.removeSourceIndex)));
    });
  }

  if (meta) meta.textContent = starterMetaText();
  if (sendButton) {
    sendButton.disabled = busy;
    sendButton.textContent = starterSendButtonLabel();
  }
  if (resetButton) resetButton.disabled = busy || !starterHasWork();
  if (composer) {
    composer.disabled = busy;
    composer.placeholder = starterDraft.followUpMode
      ? 'Tell me what you want to adjust before we build...'
      : 'Create a premium one-page site for a boutique AI strategy studio. Dark background, restrained typography, sections for services, process, and contact. Make it feel serious, fast, and modern.';
  }
}

function renderStarterEmptyState() {
  return `
    <div class="thread-empty">
      <div>
        <div class="eyebrow">Conversational Intake</div>
        <h2>Talk like you already have a builder in the room.</h2>
      </div>
      <div class="starter-thesis">
        A strong first message can skip questions entirely. You can also point at raw material: an old site, a profile URL, a README, or pasted copy. If something critical is still missing, SHEEPER will ask one strategic question at a time instead of dropping you into a form.
      </div>
      <div class="example-list">
        <div class="example-item">
          <strong>Zero-question example</strong>
          Create a premium one-page website for a boutique AI strategy studio. Dark background, restrained typography, sections for services, process, and contact. Make it feel serious, minimal, and modern.
        </div>
        <div class="example-item">
          <strong>Guided example</strong>
          I need a site for my business. Help me figure out what it should look like and what the page should say.
        </div>
      </div>
    </div>
  `;
}

function renderStarterExampleChips() {
  return STARTER_EXAMPLES.map((example, index) => `
    <button type="button" class="starter-chip" data-starter-example="${index}" ${busy ? 'disabled' : ''}>${esc(example.label)}</button>
  `).join('');
}

function applyStarterExample(index) {
  const example = STARTER_EXAMPLES[index];
  if (!example) return;

  starterDraft.composer = example.prompt;
  saveStarterDraft();
  renderStarter();
  byId('starterComposer')?.focus();
}

function renderStarterSourceFiles() {
  if (!starterDraft.sourceMaterial.files.length) {
    return '<div class="helper-copy">Optional: attach up to three text-friendly files such as a README, notes, copy doc, or exported brief.</div>';
  }

  return starterDraft.sourceMaterial.files.map((file, index) => `
    <div class="fci">
      <span>${esc(file.name)}</span>
      <button type="button" data-remove-source-index="${index}" aria-label="Remove ${esc(file.name)} from source material">x</button>
    </div>
  `).join('');
}

async function handleStarterSourceFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  if (!files.every(isTextFriendlySourceFile)) {
    setStarterError('Use text-friendly files only for source material: md, txt, html, json, yml, or similar.');
    return;
  }

  const remaining = Math.max(0, STARTER_SOURCE_FILE_LIMIT - starterDraft.sourceMaterial.files.length);
  if (!remaining) {
    setStarterError(`Source file limit reached. Keep it to ${STARTER_SOURCE_FILE_LIMIT} files.`);
    return;
  }

  const accepted = files.slice(0, remaining);

  try {
    const parsed = await Promise.all(accepted.map(async (file) => ({
      name: file.name,
      content: truncateStarterText(await file.text())
    })));

    starterDraft.sourceMaterial.files = normalizeStarterSourceFiles([
      ...starterDraft.sourceMaterial.files,
      ...parsed
    ]);
    saveStarterDraft();
    setStarterError('');
    renderStarter();
  } catch {
    setStarterError('One of the source files could not be read. Try plain text, Markdown, HTML, JSON, or YAML.');
  }
}

function removeStarterSourceFile(index) {
  starterDraft.sourceMaterial.files.splice(index, 1);
  saveStarterDraft();
  renderStarter();
}

function normalizeStarterSourceMaterial(sourceMaterial = {}) {
  const url = String(sourceMaterial?.url || '').trim();
  return {
    url,
    mode: normalizeStarterSourceMode(sourceMaterial?.mode),
    text: truncateStarterText(sourceMaterial?.text),
    files: normalizeStarterSourceFiles(sourceMaterial?.files),
    urlTitle: url ? String(sourceMaterial?.urlTitle || '').trim() : '',
    urlText: url ? truncateStarterText(sourceMaterial?.urlText) : ''
  };
}

function normalizeStarterSourceFiles(files = []) {
  return (Array.isArray(files) ? files : [])
    .slice(0, STARTER_SOURCE_FILE_LIMIT)
    .map((file) => ({
      name: String(file?.name || 'source.txt').trim() || 'source.txt',
      content: truncateStarterText(file?.content)
    }))
    .filter((file) => file.content);
}

function normalizeStarterSourceMode(value) {
  const normalized = String(value || 'modernize').trim().toLowerCase();
  return ['preserve', 'modernize', 'rebuild'].includes(normalized) ? normalized : 'modernize';
}

function truncateStarterText(value) {
  return String(value || '').trim().slice(0, STARTER_SOURCE_TEXT_LIMIT);
}

function hasStarterSourceMaterial() {
  const source = normalizeStarterSourceMaterial(starterDraft.sourceMaterial);
  return Boolean(source.url || source.text || source.urlText || source.files.length);
}

function buildStarterSourceChannelSummary() {
  const source = normalizeStarterSourceMaterial(starterDraft.sourceMaterial);
  const channels = [];
  if (source.url) channels.push('URL');
  if (source.text) channels.push('pasted text');
  if (source.files.length) channels.push(`${source.files.length} file${source.files.length === 1 ? '' : 's'}`);
  return channels.join(', ') || 'source material';
}

function defaultSourcePrompt() {
  const source = normalizeStarterSourceMaterial(starterDraft.sourceMaterial);
  if (source.url) {
    return 'Use the source URL as raw material and build a much better version of this site.';
  }
  if (source.text || source.files.length) {
    return 'Use the provided source material as raw material and build the site from it.';
  }
  return '';
}

function buildSourceSummary(brief) {
  const summary = String(brief?.sourceInputs || '').trim();
  if (!summary) return 'No source material attached';
  const prefix = brief?.sourceMode ? `${brief.sourceMode}: ` : '';
  return `${prefix}${summary}`;
}

function isTextFriendlySourceFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return Boolean(
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.txt') ||
    name.endsWith('.html') ||
    name.endsWith('.htm') ||
    name.endsWith('.json') ||
    name.endsWith('.xml') ||
    name.endsWith('.yml') ||
    name.endsWith('.yaml') ||
    name.endsWith('.csv')
  );
}

function renderMessageBubble(message) {
  return `
    <div class="bubble ${message.role === 'assistant' ? 'assistant' : 'user'}">
      <span class="bubble-role">${message.role === 'assistant' ? 'SHEEPER' : 'You'}</span>
      <div class="bubble-text">${esc(message.content)}</div>
    </div>
  `;
}

function renderBriefCard(brief) {
  const summary = brief.summary || brief.purpose || 'Ready to build.';
  return `
    <div class="brief-card">
      <div class="brief-title">
        <div>
          <div class="eyebrow" style="margin-bottom:0.35rem;color:var(--acc);">I Understood This</div>
          <h3>${esc(brief.name || 'New Site')}</h3>
        </div>
        <span class="chip">${esc(brief.inputMode === 'zero_question' ? 'Zero-question path' : 'Guided path')}</span>
      </div>
      <div class="brief-summary">${esc(summary)}</div>
      <div class="brief-grid">
        <div class="brief-block"><span class="label">Audience</span><div>${esc(brief.audience || 'Not specified')}</div></div>
        <div class="brief-block"><span class="label">Primary CTA</span><div>${esc(brief.primaryCta || 'Not specified')}</div></div>
        <div class="brief-block"><span class="label">Pages</span><div class="mini-list">${renderChipList(brief.pages, 'Home')}</div></div>
        <div class="brief-block"><span class="label">Sections</span><div class="mini-list">${renderChipList(brief.mustHaveSections, 'To be inferred')}</div></div>
        <div class="brief-block"><span class="label">Visual Direction</span><div>${esc(buildVisualSummary(brief))}</div></div>
        <div class="brief-block"><span class="label">Source Material</span><div>${esc(buildSourceSummary(brief))}</div></div>
        <div class="brief-block"><span class="label">Assumptions</span><div class="assumption-list">${renderChipList(brief.assumptions, 'No major assumptions')}</div></div>
      </div>
      <div class="brief-actions">
        <div class="helper-copy">Review this brief before preview creation. SHEEPER only starts building when you click Build Preview.</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-g" onclick="reopenBriefConversation()" ${busy ? 'disabled' : ''}>Add Detail</button>
          <button type="button" class="btn btn-g" onclick="resetStarterFlow(false)" ${busy ? 'disabled' : ''}>Start Over</button>
          <button type="button" class="btn btn-p" onclick="buildStarterProject()" ${busy ? 'disabled' : ''}>Build Preview</button>
        </div>
      </div>
    </div>
  `;
}

function renderChipList(items, fallback) {
  if (!Array.isArray(items) || !items.length) return `<span>${esc(fallback)}</span>`;
  return items.map((item) => `<span class="chip">${esc(item)}</span>`).join('');
}

function buildVisualSummary(brief) {
  const pieces = [];
  if (brief.tone) pieces.push(brief.tone);
  if (Array.isArray(brief.styleKeywords) && brief.styleKeywords.length) pieces.push(brief.styleKeywords.join(', '));
  if (brief.designDirection) pieces.push(brief.designDirection);
  return pieces.filter(Boolean).join(' | ') || 'To be inferred';
}

function starterMetaText() {
  const sourceHint = hasStarterSourceMaterial()
    ? ` Source material attached via ${buildStarterSourceChannelSummary()}.`
    : '';
  if (starterDraft.followUpMode) {
    return `Add the detail you want changed and SHEEPER will refresh the brief before building.${sourceHint}`;
  }
  if (starterDraft.status === 'ready' && starterDraft.compiledBrief) {
    return `Brief ready. Review it, build the preview, or add detail if you want to tune it first.${sourceHint}`;
  }
  if (starterDraft.status === 'clarify') {
    const topics = starterDraft.missingTopics.length ? ` Open questions: ${starterDraft.missingTopics.join(', ')}.` : '';
    return `Clarification ${Math.min(starterDraft.turns, MAX_INTAKE_TURNS)} of ${MAX_INTAKE_TURNS}.${topics}${sourceHint}`;
  }
  if (starterDraft.history.length) {
    return `Conversation underway. Keep talking naturally and SHEEPER will decide when the brief is ready.${sourceHint}`;
  }
  return `Start from a full-brief chip or type your own. A strong opening prompt can skip questions entirely.${sourceHint}`;
}

function starterSendButtonLabel() {
  if (busy) return 'Working...';
  if (starterDraft.followUpMode) return 'Refresh Brief';
  if (!starterDraft.history.length) return 'Give Me Your Best Shot';
  return 'Send Reply';
}

function starterHasWork() {
  return Boolean(
    starterDraft.history.length || starterDraft.composer || starterDraft.compiledBrief || starterDraft.summary ||
    starterDraft.advanced.domain || starterDraft.advanced.templateRepo ||
    hasStarterSourceMaterial()
  );
}

async function submitStarterMessage() {
  if (busy) return;
  syncStarterFromInputs();
  setStarterError('');

  let message = starterDraft.composer.trim();
  if (!message && hasStarterSourceMaterial()) {
    message = defaultSourcePrompt();
  }
  if (!message) {
    setStarterError('Tell SHEEPER what you want to build, or add source material and let SHEEPER build from that.');
    return;
  }

  const currentBrief = starterDraft.followUpMode ? starterDraft.compiledBrief : null;
  busy = true;
  starterDraft.history.push({ role: 'user', content: message });
  starterDraft.composer = '';
  starterDraft.followUpMode = false;
  starterDraft.status = 'thinking';
  saveStarterDraft();
  renderStarter();

  try {
    const result = await api('/api/intake', {
      history: starterDraft.history,
      turns: starterDraft.turns,
      advanced: starterDraft.advanced,
      currentBrief,
      sourceMaterial: starterDraft.sourceMaterial
    });

    if (result.assistantReply) starterDraft.history.push({ role: 'assistant', content: result.assistantReply });
    starterDraft.summary = result.summary || starterDraft.summary || '';
    starterDraft.assumptions = Array.isArray(result.assumptions) ? result.assumptions : [];
    starterDraft.missingTopics = Array.isArray(result.missingTopics) ? result.missingTopics : [];
    starterDraft.turns = Number.isFinite(Number(result.turns)) ? Number(result.turns) : starterDraft.turns;
    if (result.sourceMaterial) starterDraft.sourceMaterial = normalizeStarterSourceMaterial(result.sourceMaterial);

    if (result.status === 'ready' && result.brief) {
      starterDraft.compiledBrief = result.brief;
      starterDraft.status = 'ready';
    } else {
      starterDraft.status = 'clarify';
    }
  } catch (error) {
    starterDraft.status = starterDraft.compiledBrief ? 'ready' : 'idle';
    setStarterError(error.message);
  } finally {
    busy = false;
    saveStarterDraft();
    renderStarter();
  }
}

function reopenBriefConversation() {
  if (!starterDraft.compiledBrief) return;
  starterDraft.followUpMode = true;
  saveStarterDraft();
  renderStarter();
  byId('starterComposer')?.focus();
}

function resetStarterFlow(preserveTarget = true) {
  syncStarterFromInputs();
  const preserved = preserveTarget ? {
    advanced: { ...starterDraft.advanced },
    advancedOpen: starterDraft.advancedOpen,
    sourceMaterial: normalizeStarterSourceMaterial(starterDraft.sourceMaterial)
  } : null;

  starterDraft = defaultStarterDraft();
  if (preserved) {
    starterDraft.advanced = preserved.advanced;
    starterDraft.advancedOpen = preserved.advancedOpen;
    starterDraft.sourceMaterial = preserved.sourceMaterial;
  }

  saveStarterDraft();
  setStarterError('');
  renderDashboard();
}

async function buildStarterProject() {
  if (busy) return;
  syncStarterFromInputs();
  setStarterError('');

  if (!starterDraft.compiledBrief) {
    setStarterError('Generate and review the brief first, then build.');
    return;
  }

  busy = true;
  renderStarter();

  try {
    const result = await api('/api/preview/start', {
      brief: starterDraft.compiledBrief,
      intake: {
        history: starterDraft.history,
        summary: starterDraft.summary,
        assumptions: starterDraft.assumptions,
        missingTopics: starterDraft.missingTopics,
        inputMode: starterDraft.compiledBrief.inputMode,
        advanced: starterDraft.advanced,
        sourceMaterial: starterDraft.sourceMaterial
      }
    });

    projects.unshift({
      storage: 'preview',
      sessionId: result.sessionId,
      name: result.brief?.name || starterDraft.compiledBrief.name || 'Preview session',
      previewUrl: result.previewUrl,
      expiresAt: result.expiresAt,
      plan: result.plan,
      log: result.log,
      brief: result.brief,
      intake: result.intake || null,
      siteFiles: [],
      shipped: null,
      deployed: false
    });
    saveProjects();

    starterDraft = defaultStarterDraft();
    saveStarterDraft();
    busy = false;
    await openProj(0);
  } catch (error) {
    busy = false;
    setStarterError(`Build initialization failed: ${error.message}`);
    renderStarter();
  }
}

function renderProjects() {
  const container = byId('pList');
  if (!container) return;
  if (!projects.length) {
    container.innerHTML = '<div class="empty-projects">No active previews yet. Start with a plain-language brief and SHEEPER will build a protected preview before you decide whether to save it anywhere.</div>';
    return;
  }

  container.innerHTML = projects.map((project, index) => {
    const status = project.deployed
      ? 'DEPLOYED'
      : project.branch
        ? 'READY TO MERGE'
        : project.storage === 'preview'
          ? 'PREVIEW'
          : 'NEW';
    const meta = project.storage === 'preview'
      ? previewProjectMeta(project)
      : `${project.owner}/${project.repo}${project.branch ? ` -> ${project.branch}` : ''}`;
    return `
      <div class="pc">
        <div>
          <div class="pc-title">${esc(projectDisplayName(project))}</div>
          <div class="pc-meta">${esc(meta)}</div>
        </div>
        <div class="pc-a">
          <span class="chip">${esc(status)}</span>
          <button type="button" class="btn btn-p btn-s" data-open-project-index="${index}">Open</button>
          <button type="button" class="btn btn-g btn-s" data-remove-project-index="${index}" aria-label="Remove ${esc(projectDisplayName(project))} from the dashboard">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-open-project-index]').forEach((button) => {
    button.addEventListener('click', () => openProj(Number(button.dataset.openProjectIndex)));
  });
  container.querySelectorAll('[data-remove-project-index]').forEach((button) => {
    button.addEventListener('click', () => removeProject(Number(button.dataset.removeProjectIndex)));
  });
}

function projectDisplayName(project) {
  return project.name || (project.owner && project.repo ? `${project.owner}/${project.repo}` : 'Preview session');
}

function previewProjectMeta(project) {
  const pieces = [];
  if (project.sessionId) pieces.push(`session ${project.sessionId.slice(0, 8)}`);
  if (project.expiresAt) pieces.push(`expires ${new Date(project.expiresAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  if (project.shipped?.owner && project.shipped?.repo) pieces.push(`saved to ${project.shipped.owner}/${project.shipped.repo}`);
  return pieces.join(' | ');
}

function removeProject(index) {
  if (!confirm('Remove this project from the dashboard? Preview sessions and shipped branches stay untouched.')) return;
  projects.splice(index, 1);
  saveProjects();
  renderProjects();
}

async function openProj(index) {
  proj = { ...projects[index], _index: index };
  mode = 'build';
  byId('hName').textContent = projectDisplayName(proj);
  show('workV');
  clearLog();
  log('Loading project...', 'in');

  if (proj.storage === 'preview' || proj.sessionId) {
    try {
      const status = await api('/api/preview/status', { sessionId: proj.sessionId });
      proj.storage = 'preview';
      proj.previewUrl = status.previewUrl;
      proj.expiresAt = status.expiresAt;
      proj.plan = status.plan;
      proj.log = status.log;
      proj.brief = status.brief;
      proj.intake = status.intake || null;
      proj.siteFiles = status.siteFiles || [];
      proj.shipped = status.shipped || null;
      proj.deployed = Boolean(status.deployed);
      if (status.shipped) {
        proj.owner = status.shipped.owner;
        proj.repo = status.shipped.repo;
        proj.branch = status.shipped.branch;
        proj.mainBranch = status.shipped.mainBranch;
      }
      projects[proj._index] = { ...proj };
      saveProjects();
      renderPersistedLog();
      log('Preview session resumed.', 'ok');
    } catch (error) {
      if (/expired/i.test(error.message)) {
        projects.splice(index, 1);
        saveProjects();
        setStarterError('That preview session expired. Start a new one and SHEEPER will rebuild quickly.');
        toDash();
        return;
      }
      log(`Failed to load: ${error.message}`, 'er');
    }
  } else if (proj.branch && !proj.plan) {
    try {
      const status = await api('/api/status', { owner: proj.owner, repo: proj.repo, branch: proj.branch });
      proj.plan = status.plan;
      proj.log = status.log;
      proj.brief = status.brief;
      proj.intake = status.intake || null;
      projects[proj._index] = { ...proj };
      saveProjects();
      renderPersistedLog();
      log('Project resumed from git.', 'ok');
    } catch (error) {
      log(`Failed to load: ${error.message}`, 'er');
    }
  } else if (proj.plan) {
    log('Project loaded.', 'ok');
  }

  setMode('build');
  renderSteps();
  renderWork();
}

function renderSteps() {
  const container = byId('sList');
  if (!container) return;
  if (!proj?.plan?.steps?.length) {
    container.innerHTML = '<div class="helper-copy">No plan yet.</div>';
    return;
  }

  const current = proj.log?.currentStep || 0;
  container.innerHTML = proj.plan.steps.map((step, index) => {
    const done = index < current;
    const isCurrent = index === current;
    const stateClass = done ? 'done' : isCurrent ? 'cur' : 'pen';
    return `
      <div class="si ${stateClass}">
        <div class="sm">${done ? 'OK' : index + 1}</div>
        <div>
          <div class="sn">${esc(step.name)}</div>
          <div class="sf">${esc((step.files || []).join(', '))}</div>
        </div>
      </div>
    `;
  }).join('');
}

function setupDropZone() {
  uploads = [];
  const zone = byId('dz');
  const input = byId('fIn');
  renderFiles();
  if (!zone || !input) return;

  zone.addEventListener('click', (event) => {
    if (event.target === input) return;
    input.click();
  });

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('on');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('on');
  });

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('on');
    addFiles(event.dataTransfer?.files || []);
  });

  input.addEventListener('change', (event) => {
    addFiles(event.target.files || []);
    input.value = '';
  });
}

function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!uploads.find((upload) => upload.name === file.name && upload.size === file.size)) {
      uploads.push(file);
    }
  }
  renderFiles();
}

function removeFileAt(index) {
  uploads.splice(index, 1);
  renderFiles();
}

function renderFiles() {
  const container = byId('fList');
  if (!container) return;
  container.innerHTML = uploads.map((file, index) => `
    <div class="fci"><span>${esc(file.name)}</span><button type="button" data-upload-index="${index}" aria-label="Remove ${esc(file.name)}">x</button></div>
  `).join('');
  container.querySelectorAll('[data-upload-index]').forEach((button) => {
    button.addEventListener('click', () => removeFileAt(Number(button.dataset.uploadIndex)));
  });
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareUploads() {
  const prepared = [];
  for (const file of uploads) {
    prepared.push({
      name: file.name,
      type: file.type,
      data: await toBase64(file)
    });
  }
  return prepared;
}

function renderWork() {
  const container = byId('wMain');
  if (!container) return;
  if (!proj) {
    container.innerHTML = '<div class="helper-copy">No project selected.</div>';
    return;
  }
  if (mode === 'edit') {
    renderEditMode(container);
    return;
  }
  if (!proj.plan) {
    container.innerHTML = '<div class="helper-copy">Initializing project...</div>';
    return;
  }

  const currentStep = proj.log?.currentStep || 0;
  const totalSteps = proj.plan.steps.length;
  const previewPanel = isPreviewProject(proj) ? renderLivePreviewPanel(proj) : '';
  const currentStepFailure = getCurrentStepFailure(proj, currentStep);

  if (currentStep >= totalSteps) {
    if (isPreviewProject(proj)) {
      container.innerHTML = `
        ${previewPanel}
        <div class="ob">
          <div class="ot">Build Complete</div>
          <div style="font-size:1.05rem;font-weight:600;color:var(--bright);margin-bottom:0.45rem;">The preview is ready.</div>
          <div class="helper-copy" style="margin-bottom:1rem;">Edit it further if you want, or save this exact state to GitHub on a staging branch.</div>
          ${renderShipPanel(proj)}
        </div>
      `;
      return;
    }

    const branchSlug = (proj.branch || '').replace(/\//g, '-');
    const previewUrl = `https://${branchSlug}.${proj.repo}.pages.dev`;
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 2rem;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--acc);margin-bottom:0.5rem;">Build complete</div>
        <div class="helper-copy" style="margin-bottom:1.5rem;">All ${totalSteps} steps are done. You can approve this build or discard it.</div>
        ${renderPreviewMarkup(previewUrl, false)}
        <div style="margin-top:2rem;display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-a" onclick="doApprove()">Approve Build</button>
          <button type="button" class="btn btn-d" onclick="doReject()">Discard Build</button>
        </div>
      </div>
    `;
    return;
  }

  const step = proj.plan.steps[currentStep];
  container.innerHTML = `
    ${previewPanel}
    ${isPreviewProject(proj) ? renderShipPanel(proj) : ''}
    <div>
      <div style="font-size:1.125rem;font-weight:600;color:var(--bright);">Step ${currentStep + 1} of ${totalSteps}: ${esc(step.name)}</div>
      <div class="helper-copy" style="margin-top:0.35rem;">${esc(step.description || '')}</div>
      <div class="helper-copy" style="margin-top:0.35rem;">Expected files: ${esc((step.files || []).join(', ') || 'Not specified')}</div>
    </div>

    <div>
      <div class="fl" style="margin-bottom:0.38rem;">Additional Guidance (Optional)</div>
      <textarea id="guidance" class="input" placeholder="Any specific instruction for this step..."></textarea>
    </div>

    ${currentStepFailure ? `
      <div class="ob" style="border-color:rgba(255,77,79,0.22);background:rgba(255,77,79,0.06);">
        <div class="ot" style="color:var(--red);">Step Needs Retry</div>
        <div style="font-size:1rem;font-weight:600;color:var(--bright);margin-bottom:0.35rem;">The last attempt on this step failed.</div>
        <div class="helper-copy">Adjust the guidance or files if you want, then retry the same step. Latest error: ${esc(currentStepFailure.message)}</div>
      </div>
    ` : ''}

    <div>
      <div class="dz" id="dz">
        <div class="mono" style="font-size:0.75rem;color:var(--dim);">Drop files here or <strong style="color:var(--acc);">browse</strong></div>
        <input type="file" id="fIn" multiple>
      </div>
      <div class="fc" id="fList" style="margin-top:0.5rem;"></div>
    </div>

    <div style="display:flex;gap:0.75rem;align-items:center;">
      <button type="button" class="btn btn-p" id="runBtn" onclick="runStep()">${currentStepFailure ? 'Retry Step' : 'Execute Step'}</button>
    </div>

    <div id="proc" style="display:none;"><div class="ob"><div class="ot">Processing</div><div id="procLines" aria-live="polite"></div></div></div>
    <div id="result" style="display:none;">
      <div class="ob">
        <div class="ot">Result</div>
        <div id="resSummary" style="font-size:0.875rem;color:var(--txt);margin-bottom:1rem;line-height:1.6;"></div>
        <div id="resFiles"></div>
        <div id="resPreview"></div>
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;" id="resActions"></div>
    </div>
    <div id="errBox" class="eb" role="alert" aria-live="assertive"></div>
  `;

  setupDropZone();
}

function renderEditMode(container) {
  if (isPreviewProject(proj) && proj.shipped?.branch) {
    container.innerHTML = `
      ${renderLivePreviewPanel(proj)}
      <div class="ob">
        <div class="ot">GitHub Review</div>
        <div style="font-size:1.05rem;font-weight:600;color:var(--bright);margin-bottom:0.45rem;">This preview is now saved on a staging branch.</div>
        <div class="helper-copy" style="margin-bottom:1rem;">For the alpha, preview editing pauses once you save to GitHub. Review the branch and either merge it or discard it.</div>
        ${renderShipPanel(proj)}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${isPreviewProject(proj) ? renderLivePreviewPanel(proj) : ''}
    ${isPreviewProject(proj) ? renderShipPanel(proj) : ''}
    <div>
      <div style="font-size:1.125rem;font-weight:600;color:var(--bright);">Edit Mode</div>
      <div class="helper-copy" style="margin-top:0.35rem;">Make one targeted change to ${esc(projectDisplayName(proj))}.</div>
    </div>
    <div>
      <div class="fl" style="margin-bottom:0.38rem;">What should change?</div>
      <textarea id="editReq" class="input" style="min-height:120px;" placeholder="Describe the change in natural language..."></textarea>
    </div>
    <div>
      <div class="dz" id="dz">
        <div class="mono" style="font-size:0.75rem;color:var(--dim);">Drop files here or <strong style="color:var(--acc);">browse</strong></div>
        <input type="file" id="fIn" multiple>
      </div>
      <div class="fc" id="fList" style="margin-top:0.5rem;"></div>
    </div>
    <div style="display:flex;gap:0.75rem;"><button type="button" class="btn btn-p" id="editBtn" onclick="runEdit()">Submit Edit</button></div>
    <div id="proc" style="display:none;"><div class="ob"><div class="ot">Processing</div><div id="procLines" aria-live="polite"></div></div></div>
    <div id="result" style="display:none;">
      <div class="ob">
        <div class="ot">Result</div>
        <div id="resSummary" style="font-size:0.875rem;color:var(--txt);margin-bottom:1rem;"></div>
        <div id="resFiles"></div>
        <div id="resPreview"></div>
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;" id="resActions"></div>
    </div>
    <div id="errBox" class="eb" role="alert" aria-live="assertive"></div>
  `;
  setupDropZone();
}

function renderLivePreviewPanel(project) {
  if (!project.previewUrl) return '';
  return `
    <div class="ob">
      <div class="ot">Protected Live Preview</div>
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <div style="font-size:1.05rem;font-weight:600;color:var(--bright);margin-bottom:0.35rem;">Preview-first workspace</div>
          <div class="helper-copy">This preview is protected to the current browser session. ${project.expiresAt ? `It will stay resumable until ${esc(new Date(project.expiresAt).toLocaleString('en-GB'))}.` : ''}</div>
        </div>
        <a href="${esc(project.previewUrl)}" target="_blank" rel="noopener noreferrer" class="pl">Open Live Preview</a>
      </div>
      <div style="margin-top:1rem;border:1px solid var(--bdr);border-radius:8px;overflow:hidden;background:#0b0b0d;">
        <iframe src="${esc(project.previewUrl)}" title="Live preview" style="display:block;width:100%;height:380px;border:none;background:#fff;"></iframe>
      </div>
    </div>
  `;
}

function renderShipPanel(project) {
  if (!isPreviewProject(project)) return '';

  if (project.shipped?.branch) {
    return `
      <div class="ob">
        <div class="ot">Saved To GitHub</div>
        <div style="font-size:1rem;font-weight:600;color:var(--bright);margin-bottom:0.35rem;">${esc(project.shipped.owner)}/${esc(project.shipped.repo)}</div>
        <div class="helper-copy" style="margin-bottom:1rem;">Preview snapshot saved on ${esc(project.shipped.branch)}. Approve to merge it into ${esc(project.shipped.mainBranch || 'main')} or discard the branch.</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-a" onclick="doApprove()">Approve And Merge</button>
          <button type="button" class="btn btn-d" onclick="doReject()">Discard Branch</button>
        </div>
      </div>
    `;
  }

  if (!(project.siteFiles?.length || (project.log?.completedSteps || []).length)) {
    return `
      <div class="ob">
        <div class="ot">Save To GitHub</div>
        <div class="helper-copy">Run the first build step to create a real preview. GitHub only enters the picture once there is something worth saving.</div>
      </div>
    `;
  }

  return `
    <div class="ob">
      <div class="ot">Save To GitHub</div>
      <div class="helper-copy" style="margin-bottom:1rem;">When you like the preview, save this exact state to an existing repo on a SHEEPER staging branch.</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.75rem;">
        <div class="fg">
          <label class="fl" for="shipOwner">GitHub Owner</label>
          <input type="text" id="shipOwner" class="input" placeholder="bdod-prod" value="${esc(project.shipOwner || project.owner || '')}" oninput="cacheShipDraft()" spellcheck="false" autocomplete="off">
        </div>
        <div class="fg">
          <label class="fl" for="shipRepo">Repository</label>
          <input type="text" id="shipRepo" class="input" placeholder="sheeper-sandbox" value="${esc(project.shipRepo || project.repo || '')}" oninput="cacheShipDraft()" spellcheck="false" autocomplete="off">
        </div>
      </div>
      <div id="shipErr" class="eb${project.shipError ? ' on' : ''}" role="alert" aria-live="assertive" style="margin-top:0.9rem;">${esc(project.shipError || '')}</div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">
        <button type="button" class="btn btn-p" onclick="shipPreviewToGitHub()" ${busy ? 'disabled' : ''}>Save Preview To GitHub</button>
      </div>
    </div>
  `;
}

function cacheShipDraft() {
  if (!proj) return;
  proj.shipOwner = valueOf('shipOwner');
  proj.shipRepo = valueOf('shipRepo');
  proj.shipError = '';
  projects[proj._index] = { ...proj };
  saveProjects();
}

async function runStep() {
  if (busy || !proj) return;
  if (isPreviewProject(proj) && proj.shipped?.branch) {
    alert('This preview is already saved to GitHub. For alpha, review the staging branch instead of continuing to build here.');
    return;
  }

  busy = true;
  const button = byId('runBtn');
  if (button) button.disabled = true;
  const proc = byId('proc');
  const result = byId('result');
  const errBox = byId('errBox');
  const lines = byId('procLines');
  if (proc) proc.style.display = 'block';
  if (result) result.style.display = 'none';
  hideErrorBox(errBox);
  if (lines) lines.innerHTML = '';

  const addLine = (text, state = 'in') => {
    if (!lines) return;
    const tone = state === 'ok' ? 'var(--acc)' : state === 'er' ? 'var(--red)' : 'var(--dim)';
    const icon = state === 'ok' ? 'OK' : state === 'er' ? 'ERR' : '<span class="spinner"></span>';
    lines.innerHTML += `<div class="mono" style="font-size:0.75rem;color:${tone};display:flex;align-items:center;gap:0.5rem;">${icon} ${esc(text)}</div>`;
  };

  try {
    addLine('Reading project context...');
    log('Executing step...', 'in');
    const files = await prepareUploads();
    const guidance = valueOf('guidance');
    addLine('Generating files with AI...');

    const response = isPreviewProject(proj)
      ? await api('/api/preview/step', {
          sessionId: proj.sessionId,
          stepIndex: proj.log?.currentStep || 0,
          userGuidance: guidance,
          files
        })
      : await api('/api/step', {
          owner: proj.owner,
          repo: proj.repo,
          branch: proj.branch,
          stepIndex: proj.log?.currentStep || 0,
          userGuidance: guidance,
          files
        });

    proj.log = response.log;
    if (response.previewUrl) proj.previewUrl = response.previewUrl;
    if (response.expiresAt) proj.expiresAt = response.expiresAt;
    if (response.siteFiles) proj.siteFiles = response.siteFiles;
    projects[proj._index] = { ...proj };
    saveProjects();
    renderPersistedLog();

    if (proc) proc.style.display = 'none';
    if (result) result.style.display = 'block';
    byId('resSummary').textContent = response.summary;
    byId('resFiles').innerHTML = (response.files || []).map((file) => `
      <div class="of"><span class="a ${file.action === 'created' ? 'cr' : 'md'}">${esc(file.action)}</span><span>${esc(file.path)}</span></div>
    `).join('');
    byId('resPreview').innerHTML = renderPreviewMarkup(response.previewUrl, isPreviewProject(proj));
    byId('resActions').innerHTML = response.isLastStep && !isPreviewProject(proj)
      ? '<button type="button" class="btn btn-a" onclick="doApprove()">Approve Build</button><button type="button" class="btn btn-d" onclick="doReject()">Discard Build</button>'
      : '<button type="button" class="btn btn-p" onclick="renderWork()">Continue</button>';

    renderSteps();
  } catch (error) {
    showErrorBox(errBox, error.message);
    addLine(error.message, 'er');
    if (isPreviewProject(proj)) {
      await refreshPreviewProjectState();
      renderSteps();
      renderWork();
    }
    log(`Error: ${error.message}`, 'er');
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

async function runEdit() {
  if (busy || !proj) return;
  if (isPreviewProject(proj) && proj.shipped?.branch) {
    alert('This preview is already saved to GitHub. For alpha, review the staging branch instead of editing the preview further.');
    return;
  }

  busy = true;
  const button = byId('editBtn');
  if (button) button.disabled = true;
  const request = valueOf('editReq');
  if (!request) {
    busy = false;
    if (button) button.disabled = false;
    alert('Describe your change first.');
    return;
  }

  const proc = byId('proc');
  const result = byId('result');
  const errBox = byId('errBox');
  const lines = byId('procLines');
  if (proc) proc.style.display = 'block';
  if (result) result.style.display = 'none';
  hideErrorBox(errBox);
  if (lines) lines.innerHTML = '<div class="mono" style="font-size:0.75rem;color:var(--dim);display:flex;align-items:center;gap:0.5rem;"><span class="spinner"></span> Processing edit...</div>';

  try {
    log('Submitting edit...', 'in');
    const files = await prepareUploads();
    const response = isPreviewProject(proj)
      ? await api('/api/preview/edit', {
          sessionId: proj.sessionId,
          userRequest: request,
          files
        })
      : await api('/api/edit', {
          owner: proj.owner,
          repo: proj.repo,
          branch: proj.mainBranch || 'main',
          userRequest: request,
          files
        });

    if (!isPreviewProject(proj)) {
      proj._editBranch = response.branch;
    }
    if (response.previewUrl) proj.previewUrl = response.previewUrl;
    if (response.expiresAt) proj.expiresAt = response.expiresAt;
    if (response.siteFiles) proj.siteFiles = response.siteFiles;
    if (response.log) proj.log = response.log;
    projects[proj._index] = { ...proj };
    saveProjects();
    renderPersistedLog();

    if (proc) proc.style.display = 'none';
    if (result) result.style.display = 'block';
    byId('resSummary').textContent = response.summary;
    byId('resFiles').innerHTML = (response.files || []).map((file) => `
      <div class="of"><span class="a ${file.action === 'created' ? 'cr' : 'md'}">${esc(file.action)}</span><span>${esc(file.path)}</span></div>
    `).join('');
    byId('resPreview').innerHTML = renderPreviewMarkup(response.previewUrl, isPreviewProject(proj));
    byId('resActions').innerHTML = isPreviewProject(proj)
      ? '<button type="button" class="btn btn-p" onclick="renderWork()">Continue</button>'
      : '<button type="button" class="btn btn-a" onclick="doApproveEdit()">Approve Edit</button><button type="button" class="btn btn-d" onclick="doRejectEdit()">Reject Edit</button>';
  } catch (error) {
    showErrorBox(errBox, error.message);
    if (isPreviewProject(proj)) {
      await refreshPreviewProjectState();
      renderWork();
    }
    log(`Edit error: ${error.message}`, 'er');
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

async function shipPreviewToGitHub() {
  if (!proj || !isPreviewProject(proj) || busy) return;

  cacheShipDraft();
  if (!proj.shipOwner || !proj.shipRepo) {
    proj.shipError = 'Set the target GitHub owner and repo before saving the preview.';
    projects[proj._index] = { ...proj };
    saveProjects();
    renderWork();
    return;
  }

  busy = true;
  proj.shipError = '';
  projects[proj._index] = { ...proj };
  saveProjects();
  renderWork();

  try {
    const response = await api('/api/ship/github', {
      sessionId: proj.sessionId,
      owner: proj.shipOwner,
      repo: proj.shipRepo
    });

    proj.owner = response.owner;
    proj.repo = response.repo;
    proj.branch = response.branch;
    proj.mainBranch = response.mainBranch;
    proj.shipped = response.shipped;
    if (response.log) proj.log = response.log;
    projects[proj._index] = { ...proj };
    saveProjects();
    renderPersistedLog();
    renderWork();
  } catch (error) {
    proj.shipError = error.message;
    await refreshPreviewProjectState();
    projects[proj._index] = { ...proj };
    saveProjects();
    renderWork();
  } finally {
    busy = false;
  }
}

async function doApprove() {
  if (!proj || !proj.branch) return;
  if (!confirm('Approve this build and merge it into the main branch?')) return;
  try {
    log('Approving build...', 'in');
    const response = await api('/api/approve', {
      owner: proj.owner,
      repo: proj.repo,
      branch: proj.branch,
      targetBranch: proj.mainBranch || 'main',
      sessionId: proj.sessionId || null
    });
    proj.deployed = true;
    if (response.log) proj.log = response.log;
    if (response.shipped) proj.shipped = response.shipped;
    if (proj.shipped) proj.shipped.approvedAt = new Date().toISOString();
    projects[proj._index] = { ...proj };
    saveProjects();
    renderPersistedLog();
    log('Build approved. Give the deployment a moment to update.', 'ok');
    renderWork();
  } catch (error) {
    if (isPreviewProject(proj)) await refreshPreviewProjectState();
    log(`Approve failed: ${error.message}`, 'er');
    alert(`Approve failed: ${error.message}`);
  }
}

async function doReject() {
  if (!proj || !proj.branch) return;
  if (!confirm('Discard this build branch?')) return;
  try {
    const response = await api('/api/reject', {
      owner: proj.owner,
      repo: proj.repo,
      branch: proj.branch,
      sessionId: proj.sessionId || null
    });
    if (response.log) proj.log = response.log;

    if (isPreviewProject(proj)) {
      proj.branch = null;
      proj.mainBranch = null;
      proj.shipped = null;
      proj.shipError = '';
      projects[proj._index] = { ...proj };
      saveProjects();
      renderPersistedLog();
      log('GitHub staging branch discarded. Preview session is still available for 24 hours.', 'in');
      renderWork();
      return;
    }

    projects.splice(proj._index, 1);
    saveProjects();
    log('Build discarded.', 'in');
    toDash();
  } catch (error) {
    if (isPreviewProject(proj)) await refreshPreviewProjectState();
    log(`Reject failed: ${error.message}`, 'er');
  }
}

async function doApproveEdit() {
  if (!proj?._editBranch) return;
  try {
    log('Approving edit...', 'in');
    await api('/api/approve', {
      owner: proj.owner,
      repo: proj.repo,
      branch: proj._editBranch,
      targetBranch: proj.mainBranch || 'main'
    });
    proj.deployed = true;
    proj._editBranch = null;
    projects[proj._index] = { ...proj };
    saveProjects();
    log('Edit approved.', 'ok');
    renderWork();
  } catch (error) {
    log(`Approve failed: ${error.message}`, 'er');
  }
}

async function doRejectEdit() {
  if (!proj?._editBranch) return;
  try {
    await api('/api/reject', { owner: proj.owner, repo: proj.repo, branch: proj._editBranch });
    proj._editBranch = null;
    log('Edit discarded.', 'in');
    renderWork();
  } catch (error) {
    log(`Reject failed: ${error.message}`, 'er');
  }
}

function isPreviewProject(project) {
  return Boolean(project?.storage === 'preview' || project?.sessionId);
}

async function refreshPreviewProjectState() {
  if (!proj?.sessionId) return false;
  try {
    const status = await api('/api/preview/status', { sessionId: proj.sessionId });
    proj.storage = 'preview';
    proj.previewUrl = status.previewUrl;
    proj.expiresAt = status.expiresAt;
    proj.plan = status.plan;
    proj.log = status.log;
    proj.brief = status.brief;
    proj.intake = status.intake || null;
    proj.siteFiles = status.siteFiles || [];
    proj.shipped = status.shipped || null;
    proj.deployed = Boolean(status.deployed);
    if (status.shipped) {
      proj.owner = status.shipped.owner;
      proj.repo = status.shipped.repo;
      proj.branch = status.shipped.branch;
      proj.mainBranch = status.shipped.mainBranch;
    }
    projects[proj._index] = { ...proj };
    saveProjects();
    renderPersistedLog();
    return true;
  } catch {
    return false;
  }
}

function clearLog() {
  const container = byId('logE');
  if (container) container.innerHTML = '';
}

function renderPersistedLog() {
  const container = byId('logE');
  if (!container) return;

  const events = Array.isArray(proj?.log?.events) ? proj.log.events : [];
  container.innerHTML = events.map((event) => {
    const state = event?.level === 'error' ? 'er' : event?.level === 'warn' ? 'in' : '';
    return `<div class="le ${state}"><span class="t">[${formatLogTime(event?.timestamp)}]</span><span class="m">${esc(event?.message || event?.type || 'Log event')}</span></div>`;
  }).join('');

  const wrapper = byId('logP');
  if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
}

function getCurrentStepFailure(project, stepIndex) {
  const events = Array.isArray(project?.log?.events) ? project.log.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'step.completed' && Number(event?.data?.stepIndex) === Number(stepIndex)) {
      return null;
    }
    if (event?.type === 'step.failed' && Number(event?.data?.stepIndex) === Number(stepIndex)) {
      return event;
    }
  }
  return null;
}

function log(message, state = '') {
  const container = byId('logE');
  if (!container) return;
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  container.innerHTML += `<div class="le ${state}"><span class="t">[${time}]</span><span class="m">${esc(message)}</span></div>`;
  const wrapper = byId('logP');
  if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
}

function formatLogTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderPreviewMarkup(previewUrl, isLive = false) {
  if (!previewUrl) return '';
  if (isLive) {
    return `
      <div style="margin-top:1rem;padding:0.875rem;border:1px solid var(--bdr);border-radius:4px;background:var(--bg-card);text-align:left;">
        <div class="mono" style="font-size:0.625rem;font-weight:600;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.5rem;">Protected Live Preview</div>
        <div class="mono" style="font-size:0.75rem;color:var(--bright);word-break:break-all;">${esc(previewUrl)}</div>
        <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--dim);line-height:1.5;">This preview is live inside the current browser session. It stays protected and resumable for up to 24 hours.</div>
        <a href="${esc(previewUrl)}" target="_blank" rel="noopener noreferrer" class="pl" style="margin-top:0.75rem;">Open Live Preview</a>
      </div>
    `;
  }
  return `
    <div style="margin-top:1rem;padding:0.875rem;border:1px solid var(--bdr);border-radius:4px;background:var(--bg-card);text-align:left;">
      <div class="mono" style="font-size:0.625rem;font-weight:600;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.5rem;">Expected Preview URL</div>
      <div class="mono" style="font-size:0.75rem;color:var(--bright);word-break:break-all;">${esc(previewUrl)}</div>
      <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--dim);line-height:1.5;">This is a predicted preview URL. It only works if the target repo is already wired to Cloudflare Pages branch previews.</div>
      <a href="${esc(previewUrl)}" target="_blank" rel="noopener noreferrer" class="pl" style="margin-top:0.75rem;">Open Expected Preview</a>
    </div>
  `;
}

function setAuthError(message) {
  const element = byId('authErr');
  if (!element) return;
  if (!message) {
    element.classList.remove('on');
    element.textContent = 'Invalid token. Try again.';
    return;
  }
  element.textContent = message;
  element.classList.add('on');
}

function setStarterError(message) {
  const element = byId('starterErr');
  if (!element) return;
  if (!message) {
    element.classList.remove('on');
    element.textContent = '';
    return;
  }
  element.textContent = message;
  element.classList.add('on');
}

function showErrorBox(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.add('on');
}

function hideErrorBox(element) {
  if (!element) return;
  element.textContent = '';
  element.classList.remove('on');
}

function isMessage(message) {
  return message && (message.role === 'assistant' || message.role === 'user') && typeof message.content === 'string';
}

function esc(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.resetStarterFlow = resetStarterFlow;
window.submitStarterMessage = submitStarterMessage;
window.reopenBriefConversation = reopenBriefConversation;
window.buildStarterProject = buildStarterProject;
window.setMode = setMode;
window.toDash = toDash;
window.logout = logout;
window.renderWork = renderWork;
window.runStep = runStep;
window.runEdit = runEdit;
window.cacheShipDraft = cacheShipDraft;
window.shipPreviewToGitHub = shipPreviewToGitHub;
window.doApprove = doApprove;
window.doReject = doReject;
window.doApproveEdit = doApproveEdit;
window.doRejectEdit = doRejectEdit;



