// === SHEEPER APP ===

let authToken = '';
let projects = loadProjects();
let proj = null; // current project
let mode = 'build';
let uploads = [];
let busy = false;

// === AUTH ===
document.getElementById('tokIn').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.value.trim();
  if (!t) return;
  try {
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t })
    });
    if (r.ok) {
      authToken = t;
      show('dashV');
      renderProjects();
    } else {
      document.getElementById('authErr').style.display = 'block';
      e.target.value = '';
    }
  } catch {
    document.getElementById('authErr').style.display = 'block';
  }
});

// === NAV ===
function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toDash() {
  proj = null;
  show('dashV');
  renderProjects();
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.nav-b').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  document.getElementById('sideB').style.display = m === 'build' ? '' : 'none';
  renderWork();
}

// === API HELPER ===
async function api(path, data) {
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(data)
  });
  const raw = await r.text();
  let j = null;

  if (raw) {
    try {
      j = JSON.parse(raw);
    } catch {
      j = null;
    }
  }

  if (!r.ok) {
    const detail = j?.error || j?.message || raw.trim();
    throw new Error(detail || `HTTP ${r.status}`);
  }

  if (!j) {
    throw new Error(`Unexpected empty response from ${path}`);
  }

  return j;
}

// === PROJECTS ===
function saveP() { localStorage.setItem('sheeper_projects', JSON.stringify(projects)); }

function loadProjects() {
  try {
    const parsed = JSON.parse(localStorage.getItem('sheeper_projects') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderProjects() {
  const c = document.getElementById('pList');
  if (!projects.length) {
    c.innerHTML = '<div style="text-align:center;padding:4rem 2rem;color:var(--dim);font-family:var(--mono);font-size:0.8125rem">No projects yet. Create one to start building.</div>';
    return;
  }
  c.innerHTML = projects.map((p, i) => `
    <div class="pc">
      <div>
        <div style="font-size:0.9375rem;font-weight:600;color:var(--bright)">${esc(p.name)}</div>
        <div class="mono" style="font-size:0.6875rem;color:var(--dim);word-break:break-all">${esc(p.owner)}/${esc(p.repo)} ${p.branch ? '-> ' + esc(p.branch) : ''}</div>
      </div>
      <div class="pc-a">
        <span class="mono" style="font-size:0.6875rem;padding:0.25rem 0.625rem;border-radius:3px;border:1px solid ${p.deployed ? 'var(--acc-m)' : p.branch ? 'rgba(255,204,0,0.2)' : 'var(--bdr)'};color:${p.deployed ? 'var(--acc)' : p.branch ? 'var(--warn)' : 'var(--dim)'};background:${p.deployed ? 'var(--acc-d)' : p.branch ? 'rgba(255,204,0,0.05)' : 'transparent'}">${p.deployed ? 'DEPLOYED' : p.branch ? 'BUILDING' : 'NEW'}</span>
        <button type="button" class="btn btn-p btn-s" data-open-project-index="${i}">Open</button>
        <button type="button" class="btn btn-g btn-s" data-remove-project-index="${i}" aria-label="Remove ${esc(p.name)} from the dashboard" title="Remove">&times;</button>
      </div>
    </div>
  `).join('');

  c.querySelectorAll('[data-open-project-index]').forEach((btn) => {
    btn.addEventListener('click', () => openProj(Number(btn.dataset.openProjectIndex)));
  });

  c.querySelectorAll('[data-remove-project-index]').forEach((btn) => {
    btn.addEventListener('click', () => rmProj(Number(btn.dataset.removeProjectIndex)));
  });
}
function rmProj(i) {
  if (!confirm('Remove from list? (Repo/branch untouched.)')) return;
  projects.splice(i, 1);
  saveP();
  renderProjects();
}

function showModal() { document.getElementById('npModal').classList.add('on'); }
function hideModal() { document.getElementById('npModal').classList.remove('on'); }

async function initProject() {
  const btn = document.getElementById('cpBtn');
  btn.disabled = true;
  btn.textContent = 'Initializing...';

  const owner = document.getElementById('npO').value.trim();
  const repo = document.getElementById('npR').value.trim();
  const name = document.getElementById('npN').value.trim();

  if (!owner || !repo || !name) {
    alert('Owner, Repository, and Site Name are required.');
    btn.disabled = false;
    btn.textContent = 'Initialize';
    return;
  }

  try {
    const brief = {
      name,
      domain: document.getElementById('npD').value.trim(),
      language: document.getElementById('npL').value.trim() || 'en',
      purpose: document.getElementById('npPu').value.trim(),
      pages: document.getElementById('npPg').value.split(',').map(s => s.trim()).filter(Boolean),
      designDirection: document.getElementById('npDe').value.trim(),
      templateRepo: document.getElementById('npT').value.trim(),
      notes: document.getElementById('npNo').value.trim()
    };

    const result = await api('/api/init', { owner, repo, brief });

    // Save project
    const p = {
      name, owner, repo,
      branch: result.branch,
      mainBranch: result.mainBranch,
      plan: result.plan,
      log: result.log,
      brief: result.brief,
      deployed: false
    };
    projects.push(p);
    saveP();

    hideModal();
    openProj(projects.length - 1);

  } catch (err) {
    alert('Init failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Initialize';
  }
}

// === OPEN PROJECT ===
async function openProj(i) {
  proj = projects[i];
  proj._index = i;
  document.getElementById('hName').textContent = proj.name;
  show('workV');
  clearLog();
  log('Loading project...', 'in');

  if (proj.branch && !proj.plan) {
    // Resume: load state from git
    try {
      const s = await api('/api/status', {
        owner: proj.owner, repo: proj.repo, branch: proj.branch
      });
      proj.plan = s.plan;
      proj.log = s.log;
      proj.brief = s.brief;
      projects[proj._index] = { ...proj };
      saveP();
      log('Project resumed from git.', 'ok');
    } catch (err) {
      log('Failed to load: ' + err.message, 'er');
    }
  } else if (proj.plan) {
    log('Project loaded.', 'ok');
  }

  renderSteps();
  renderWork();
}

// === STEP LIST (sidebar) ===
function renderSteps() {
  const c = document.getElementById('sList');
  if (!proj?.plan?.steps) {
    c.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:0.75rem;padding:0.5rem">No plan yet.</div>';
    return;
  }

  const cur = proj.log?.currentStep || 0;
  c.innerHTML = proj.plan.steps.map((s, i) => {
    const done = i < cur;
    const isCur = i === cur;
    const cls = done ? 'done' : isCur ? 'cur' : 'pen';
    return `
      <div class="si ${cls}">
        <div class="sm">${done ? '✓' : i + 1}</div>
        <div>
          <div class="sn">${esc(s.name)}</div>
          <div class="sf">${(s.files || []).join(', ')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// === WORKSPACE RENDER ===
function renderWork() {
  const c = document.getElementById('wMain');

  if (mode === 'edit') {
    renderEditMode(c);
    return;
  }

  // BUILD MODE
  if (!proj?.plan) {
    c.innerHTML = '<div style="color:var(--dim);font-family:var(--mono);font-size:0.8125rem;padding:2rem">Initializing project...</div>';
    return;
  }

  const cur = proj.log?.currentStep || 0;
  const total = proj.plan.steps.length;

  // All done?
  if (cur >= total) {
    const cfB = (proj.branch || '').replace(/\//g, '-');
    const previewUrl = `https://${cfB}.${proj.repo}.pages.dev`;
    c.innerHTML = `
      <div style="text-align:center;padding:3rem 2rem">
        <div style="font-size:1.5rem;font-weight:700;color:var(--acc);margin-bottom:0.5rem">Build Complete</div>
        <div class="mono" style="font-size:0.8125rem;color:var(--dim);margin-bottom:2rem">All ${total} steps finished. Ready to deploy.</div>
        ${renderPreviewMarkup(previewUrl)}
        <div style="margin-top:2rem;display:flex;gap:0.75rem;justify-content:center">
          <button class="btn btn-a" onclick="doApprove()">✓ Deploy to Production</button>
          <button class="btn btn-d" onclick="doReject()">✕ Discard Build</button>
        </div>
      </div>`;
    return;
  }

  const step = proj.plan.steps[cur];
  c.innerHTML = `
    <div>
      <div style="font-size:1.125rem;font-weight:600;color:var(--bright)">Step ${cur + 1} of ${total}: ${esc(step.name)}</div>
      <div class="mono" style="font-size:0.75rem;color:var(--dim);margin-top:0.25rem">${esc(step.description || '')}</div>
      <div class="mono" style="font-size:0.6875rem;color:var(--dim);margin-top:0.25rem">Expected: ${(step.files || []).join(', ')}</div>
    </div>

    <div>
      <div class="mono" style="font-size:0.6875rem;color:var(--dim);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:0.375rem">Additional guidance (optional)</div>
      <textarea id="guidance" class="input" style="min-height:100px" placeholder="Any specific instructions for this step..."></textarea>
    </div>

    <div>
      <div class="dz" id="dz">
        <div class="mono" style="font-size:0.75rem;color:var(--dim)">Drop files here or <strong style="color:var(--acc)">browse</strong></div>
        <input type="file" id="fIn" multiple>
      </div>
      <div class="fc" id="fList" style="margin-top:0.5rem"></div>
    </div>

    <div style="display:flex;gap:0.75rem;align-items:center">
      <button class="btn btn-p" id="runBtn" onclick="runStep()">▶ Execute Step</button>
    </div>

    <div id="proc" style="display:none">
      <div class="ob">
        <div class="ot">Processing</div>
        <div id="procLines" aria-live="polite"></div>
      </div>
    </div>

    <div id="result" style="display:none">
      <div class="ob">
        <div class="ot">Result</div>
        <div id="resSummary" style="font-size:0.875rem;color:var(--txt);margin-bottom:1rem;line-height:1.6"></div>
        <div id="resFiles"></div>
        <div id="resPreview"></div>
      </div>
      <div style="display:flex;gap:0.75rem;margin-top:1rem" id="resActions"></div>
    </div>

    <div id="errBox" class="eb" role="alert" aria-live="assertive"></div>
  `;

  setupDropZone();
}

function renderEditMode(c) {
  c.innerHTML = `
    <div>
      <div style="font-size:1.125rem;font-weight:600;color:var(--bright)">Edit Mode</div>
      <div class="mono" style="font-size:0.75rem;color:var(--dim);margin-top:0.25rem">Make a single change to ${esc(proj?.name || 'your site')}</div>
    </div>

    <div>
      <div class="mono" style="font-size:0.6875rem;color:var(--dim);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:0.375rem">What do you want to change?</div>
      <textarea id="editReq" class="input" style="min-height:120px" placeholder="Describe your change in natural language..."></textarea>
    </div>

    <div>
      <div class="dz" id="dz">
        <div class="mono" style="font-size:0.75rem;color:var(--dim)">Drop files here or <strong style="color:var(--acc)">browse</strong></div>
        <input type="file" id="fIn" multiple>
      </div>
      <div class="fc" id="fList" style="margin-top:0.5rem"></div>
    </div>

    <div style="display:flex;gap:0.75rem">
      <button class="btn btn-p" id="editBtn" onclick="runEdit()">▶ Submit Edit</button>
    </div>

    <div id="proc" style="display:none">
      <div class="ob"><div class="ot">Processing</div><div id="procLines" aria-live="polite"></div></div>
    </div>

    <div id="result" style="display:none">
      <div class="ob">
        <div class="ot">Result</div>
        <div id="resSummary" style="font-size:0.875rem;color:var(--txt);margin-bottom:1rem"></div>
        <div id="resFiles"></div>
        <div id="resPreview"></div>
      </div>
      <div style="display:flex;gap:0.75rem;margin-top:1rem" id="resActions"></div>
    </div>

    <div id="errBox" class="eb" role="alert" aria-live="assertive"></div>
  `;

  setupDropZone();
}

// === FILE UPLOADS ===
function setupDropZone() {
  uploads = [];
  const dz = document.getElementById('dz');
  const fi = document.getElementById('fIn');
  if (!dz || !fi) return;

  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
  fi.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
}

function addFiles(fileList) {
  for (const f of fileList) {
    if (!uploads.find(u => u.name === f.name)) uploads.push(f);
  }
  renderFiles();
}

function rmFileAt(index) {
  uploads.splice(index, 1);
  renderFiles();
}

function renderFiles() {
  const c = document.getElementById('fList');
  if (!c) return;
  c.innerHTML = uploads.map((f, i) => `
    <div class="fci"><span>${esc(f.name)}</span> <button type="button" data-upload-index="${i}" aria-label="Remove ${esc(f.name)}">&times;</button></div>
  `).join('');

  c.querySelectorAll('[data-upload-index]').forEach((btn) => {
    btn.addEventListener('click', () => rmFileAt(Number(btn.dataset.uploadIndex)));
  });
}

function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function prepFiles() {
  const out = [];
  for (const f of uploads) {
    out.push({ name: f.name, type: f.type, data: await toB64(f) });
  }
  return out;
}

// === RUN BUILD STEP ===
async function runStep() {
  if (busy) return;
  busy = true;

  const btn = document.getElementById('runBtn');
  btn.disabled = true;

  const proc = document.getElementById('proc');
  const result = document.getElementById('result');
  const errBox = document.getElementById('errBox');

  proc.style.display = 'block';
  result.style.display = 'none';
  errBox.classList.remove('on');

  const lines = document.getElementById('procLines');
  lines.innerHTML = '';
  const addLine = (txt, cls = '') => {
    lines.innerHTML += `<div class="mono" style="font-size:0.75rem;color:${cls === 'ok' ? 'var(--acc)' : cls === 'er' ? 'var(--red)' : 'var(--dim)'};display:flex;align-items:center;gap:0.5rem">${cls === '' ? '<div class="spinner"></div>' : cls === 'ok' ? '✓' : '✕'} ${txt}</div>`;
  };

  try {
    addLine('Reading project context...');
    log('Executing step...', 'in');

    const files = await prepFiles();
    const guidance = document.getElementById('guidance')?.value?.trim() || '';

    addLine('Generating files with AI...');

    const res = await api('/api/step', {
      owner: proj.owner,
      repo: proj.repo,
      branch: proj.branch,
      stepIndex: proj.log?.currentStep || 0,
      userGuidance: guidance,
      files
    });

    lines.innerHTML = '';
    addLine('Step complete!', 'ok');

    // Update local state
    proj.log = res.log;
    projects[proj._index] = { ...proj };
    saveP();

    // Show result
    proc.style.display = 'none';
    result.style.display = 'block';

    document.getElementById('resSummary').textContent = res.summary;
    document.getElementById('resFiles').innerHTML = (res.files || []).map(f => `
      <div class="of"><span class="a ${f.action === 'created' ? 'cr' : 'md'}">${f.action}</span><span>${esc(f.path)}</span></div>
    `).join('');

    document.getElementById('resPreview').innerHTML = renderPreviewMarkup(res.previewUrl);

    if (res.isLastStep) {
      document.getElementById('resActions').innerHTML = `
        <button class="btn btn-a" onclick="doApprove()">✓ Deploy to Production</button>
        <button class="btn btn-d" onclick="doReject()">✕ Discard Build</button>
      `;
    } else {
      document.getElementById('resActions').innerHTML = `
        <button class="btn btn-p" onclick="nextStep()">▶ Continue to Next Step</button>
      `;
    }

    log(`Step complete: ${res.summary}`, 'ok');
    if (res.provider) log(`AI: ${res.provider}`, 'in');

    renderSteps();

  } catch (err) {
    lines.innerHTML = '';
    addLine('Error: ' + err.message, 'er');
    errBox.textContent = err.message;
    errBox.classList.add('on');
    log('Error: ' + err.message, 'er');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

function nextStep() {
  renderSteps();
  renderWork();
}

// === RUN EDIT ===
async function runEdit() {
  if (busy) return;
  busy = true;

  const btn = document.getElementById('editBtn');
  btn.disabled = true;

  const req = document.getElementById('editReq')?.value?.trim();
  if (!req) { btn.disabled = false; busy = false; alert('Describe your change.'); return; }

  const proc = document.getElementById('proc');
  const result = document.getElementById('result');
  const errBox = document.getElementById('errBox');

  proc.style.display = 'block';
  result.style.display = 'none';
  errBox.classList.remove('on');

  const lines = document.getElementById('procLines');
  lines.innerHTML = '<div class="mono" style="font-size:0.75rem;color:var(--dim);display:flex;align-items:center;gap:0.5rem"><div class="spinner"></div> Processing edit...</div>';

  try {
    log('Submitting edit...', 'in');
    const files = await prepFiles();

    const res = await api('/api/edit', {
      owner: proj.owner,
      repo: proj.repo,
      branch: proj.mainBranch || 'main',
      userRequest: req,
      files
    });

    proc.style.display = 'none';
    result.style.display = 'block';

    document.getElementById('resSummary').textContent = res.summary;
    document.getElementById('resFiles').innerHTML = (res.files || []).map(f => `
      <div class="of"><span class="a ${f.action === 'created' ? 'cr' : 'md'}">${f.action}</span><span>${esc(f.path)}</span></div>
    `).join('');

    document.getElementById('resPreview').innerHTML = renderPreviewMarkup(res.previewUrl);

    // Store edit branch for approve/reject
    proj._editBranch = res.branch;

    document.getElementById('resActions').innerHTML = `
      <button class="btn btn-a" onclick="doApproveEdit()">✓ Approve & Deploy</button>
      <button class="btn btn-d" onclick="doRejectEdit()">✕ Reject</button>
    `;

    log(`Edit applied: ${res.summary}`, 'ok');

  } catch (err) {
    lines.innerHTML = '';
    errBox.textContent = err.message;
    errBox.classList.add('on');
    log('Edit error: ' + err.message, 'er');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

// === APPROVE / REJECT ===
async function doApprove() {
  if (!confirm('Deploy to production? This merges the build branch to main.')) return;
  try {
    log('Deploying...', 'in');
    await api('/api/approve', {
      owner: proj.owner, repo: proj.repo,
      branch: proj.branch, targetBranch: proj.mainBranch || 'main'
    });
    proj.deployed = true;
    projects[proj._index] = { ...proj };
    saveP();
    log('Deployed! Site updating in ~60s.', 'ok');
    renderWork();
  } catch (err) {
    log('Deploy failed: ' + err.message, 'er');
    alert('Deploy failed: ' + err.message);
  }
}

async function doReject() {
  if (!confirm('Discard this entire build? This cannot be undone.')) return;
  try {
    await api('/api/reject', { owner: proj.owner, repo: proj.repo, branch: proj.branch });
    projects.splice(proj._index, 1);
    saveP();
    log('Build discarded.', 'in');
    toDash();
  } catch (err) {
    log('Reject failed: ' + err.message, 'er');
  }
}

async function doApproveEdit() {
  if (!proj._editBranch) return;
  try {
    log('Deploying edit...', 'in');
    await api('/api/approve', {
      owner: proj.owner, repo: proj.repo,
      branch: proj._editBranch, targetBranch: proj.mainBranch || 'main'
    });
    log('Edit deployed!', 'ok');
    proj._editBranch = null;
    renderWork();
  } catch (err) {
    log('Deploy failed: ' + err.message, 'er');
  }
}

async function doRejectEdit() {
  if (!proj._editBranch) return;
  try {
    await api('/api/reject', { owner: proj.owner, repo: proj.repo, branch: proj._editBranch });
    log('Edit discarded.', 'in');
    proj._editBranch = null;
    renderWork();
  } catch (err) {
    log('Reject failed: ' + err.message, 'er');
  }
}

// === LOG ===
function clearLog() {
  document.getElementById('logE').innerHTML = '';
}

function log(msg, cls = '') {
  const c = document.getElementById('logE');
  const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  c.innerHTML += `<div class="le ${cls}"><span class="t">[${t}]</span><span class="m">${esc(msg)}</span></div>`;
  const lp = document.getElementById('logP');
  if (lp) lp.scrollTop = lp.scrollHeight;
}

// === UTILS ===
function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPreviewMarkup(previewUrl) {
  if (!previewUrl) return '';

  return `
    <div style="margin-top:1rem;padding:0.875rem;border:1px solid var(--bdr);border-radius:4px;background:var(--bg-card);text-align:left">
      <div class="mono" style="font-size:0.625rem;font-weight:600;color:var(--dim);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.5rem">Expected Preview URL</div>
      <div class="mono" style="font-size:0.75rem;color:var(--bright);word-break:break-all">${esc(previewUrl)}</div>
      <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--dim);line-height:1.5">This URL is predicted. It only works if the target repo is already wired to Cloudflare Pages branch previews.</div>
      <a href="${esc(previewUrl)}" target="_blank" rel="noopener noreferrer" class="pl" style="margin-top:0.75rem">Open Expected Preview</a>
    </div>
  `;
}
