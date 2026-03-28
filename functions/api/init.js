// POST /api/init
// Creates a new SHEEPER project:
// 1. Creates sheeper/build-{timestamp} branch on the target repo
// 2. Commits _sheeper/brief.json with the project brief
// 3. Calls AI to generate a build plan
// 4. Commits _sheeper/plan.json and _sheeper/log.json
// 5. Returns the plan for the frontend

import {
  checkAuth, jsonResponse, errorResponse, callAI, extractJson,
  githubGet, githubPost, githubCommitFiles, githubGetFileSafe
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { owner, repo, brief } = body;

    // Validate
    if (!owner || !repo) {
      return errorResponse('owner and repo are required', 400);
    }
    if (!brief || !brief.name) {
      return errorResponse('brief.name is required', 400);
    }

    const token = env.GITHUB_TOKEN;
    const branchName = `sheeper/build-${Date.now()}`;

    // Step 1: Get main branch SHA (try main, then master)
    let mainSha;
    let mainBranch = 'main';
    try {
      const mainRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/main`, token);
      mainSha = mainRef.object.sha;
    } catch {
      try {
        const masterRef = await githubGet(`/repos/${owner}/${repo}/git/ref/heads/master`, token);
        mainSha = masterRef.object.sha;
        mainBranch = 'master';
      } catch {
        return errorResponse(`Could not find main or master branch on ${owner}/${repo}`, 400);
      }
    }

    // Step 2: Create build branch
    await githubPost(`/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: mainSha
    }, token);

    // Step 3: Check for template files in repo (README.md, decisions.md, etc.)
    const templateContext = {};
    const contextFiles = ['README.md', 'decisions.md', 'llm-authority-guide.md'];
    for (const file of contextFiles) {
      const content = await githubGetFileSafe(owner, repo, file, mainBranch, token);
      if (content) {
        templateContext[file] = content;
      }
    }

    // Step 4: Commit brief
    const briefJson = {
      name: brief.name,
      domain: brief.domain || '',
      language: brief.language || 'en',
      purpose: brief.purpose || '',
      pages: brief.pages || [],
      designDirection: brief.designDirection || '',
      templateRepo: brief.templateRepo || '',
      notes: brief.notes || '',
      createdAt: new Date().toISOString()
    };

    await githubCommitFiles(owner, repo, branchName, [
      {
        path: '_sheeper/brief.json',
        content: JSON.stringify(briefJson, null, 2)
      }
    ], 'sheeper: initialize project brief', token);

    // Step 5: Generate build plan via AI
    const templateContextStr = Object.entries(templateContext)
      .map(([path, content]) => `--- ${path} ---\n${content}`)
      .join('\n\n');

    const planPrompt = buildPlanPrompt(briefJson, templateContextStr);
    const { text: planText, provider } = await callAI(env, planPrompt.messages, {
      system: planPrompt.system,
      maxTokens: 4000,
      task: 'plan'
    });

    let plan;
    try {
      plan = extractJson(planText);
    } catch {
      // Fallback: generate a reasonable default plan
      plan = defaultPlan(briefJson);
    }

    // Ensure plan has required structure
    if (!plan.steps || !Array.isArray(plan.steps)) {
      plan = defaultPlan(briefJson);
    }

    // Add IDs to steps if missing
    plan.steps = plan.steps.map((step, i) => ({
      id: step.id || `step-${i + 1}`,
      name: step.name || `Step ${i + 1}`,
      description: step.description || '',
      files: step.files || [],
      ...step
    }));

    // Step 6: Commit plan and empty log
    const log = {
      currentStep: 0,
      completedSteps: [],
      totalFiles: [],
      lastUpdated: new Date().toISOString()
    };

    await githubCommitFiles(owner, repo, branchName, [
      {
        path: '_sheeper/plan.json',
        content: JSON.stringify(plan, null, 2)
      },
      {
        path: '_sheeper/log.json',
        content: JSON.stringify(log, null, 2)
      }
    ], 'sheeper: generate build plan', token);

    // Return
    return jsonResponse({
      branch: branchName,
      mainBranch,
      brief: briefJson,
      plan,
      log,
      provider
    });

  } catch (err) {
    console.error('Init error:', err);
    return errorResponse(err.message || 'Failed to initialize project', 500);
  }
}

// === PROMPTS ===

function buildPlanPrompt(brief, templateContext) {
  const system = `You are SHEEPER, an AI that builds websites from natural language briefs. You create structured build plans that break site generation into logical steps. Each step should produce a coherent set of files that build on previous steps. Keep steps focused — 1-4 files each. The final step should always be SEO/optimization.`;

  const content = `Create a build plan for this website project.

## Project Brief
- Name: ${brief.name}
- Domain: ${brief.domain || 'TBD'}
- Language: ${brief.language || 'en'}
- Purpose: ${brief.purpose || 'Not specified'}
- Requested Pages: ${(brief.pages || []).join(', ') || 'Not specified'}
- Design Direction: ${brief.designDirection || 'Not specified'}
- Notes: ${brief.notes || 'None'}

${templateContext ? `## Existing Project Context\n${templateContext}` : ''}

## Instructions
Create a build plan as a JSON object. The plan should have 4-8 steps that progressively build a complete static HTML website. Each step commits working files — the site should be functional after each step.

Respond ONLY with JSON (no markdown, no backticks):
{
  "overview": "Brief description of the build approach",
  "estimatedFiles": 12,
  "steps": [
    {
      "id": "step-1",
      "name": "Foundation",
      "description": "What this step creates and why",
      "files": ["index.html", "styles.css"],
      "dependsOn": []
    },
    {
      "id": "step-2",
      "name": "Core Pages",
      "description": "...",
      "files": ["about.html", "services.html"],
      "dependsOn": ["step-1"]
    }
  ]
}

Guidelines:
- Step 1 should always be foundation (index.html + CSS + shared assets)
- Group related pages together
- Last step should be SEO optimization (sitemap.xml, robots.txt, JSON-LD, meta tags review)
- Static HTML site — no frameworks, no build tools
- Self-hosted fonts for GDPR compliance
- WebP images with lazy loading
- Clean URLs (no .html in links)`;

  return {
    system,
    messages: [{ role: 'user', content }]
  };
}

function defaultPlan(brief) {
  const pages = brief.pages || ['Home', 'About', 'Contact'];
  const steps = [
    {
      id: 'step-1',
      name: 'Foundation',
      description: 'Homepage, global CSS, shared layout structure',
      files: ['index.html', 'styles.css']
    }
  ];

  // Group remaining pages into steps of 2-3
  const otherPages = pages.filter(p => p.toLowerCase() !== 'home');
  for (let i = 0; i < otherPages.length; i += 2) {
    const group = otherPages.slice(i, i + 2);
    const stepNum = steps.length + 1;
    steps.push({
      id: `step-${stepNum}`,
      name: group.join(' & '),
      description: `Create ${group.join(' and ')} pages`,
      files: group.map(p => `${p.toLowerCase().replace(/\s+/g, '-')}.html`)
    });
  }

  // Final SEO step
  steps.push({
    id: `step-${steps.length + 1}`,
    name: 'SEO & Polish',
    description: 'Sitemap, robots.txt, JSON-LD structured data, meta tags, performance optimization',
    files: ['sitemap.xml', 'robots.txt']
  });

  return {
    overview: `Build ${brief.name} as a static HTML site with ${pages.length} pages`,
    estimatedFiles: pages.length + 4,
    steps
  };
}
