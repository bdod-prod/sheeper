import {
  callAI,
  extractJson,
  githubGetFileSafe
} from './_shared.js';
import { normalizeList } from './_brief.js';

export async function loadTemplateContext(brief, token) {
  if (!brief?.templateRepo || !token) {
    return '';
  }

  const [owner, repo] = String(brief.templateRepo).split('/');
  if (!owner || !repo) {
    return '';
  }

  const templateContext = {};
  for (const file of ['README.md', 'decisions.md', 'llm-authority-guide.md']) {
    const content = await githubGetFileSafe(owner, repo, file, 'main', token);
    if (content) {
      templateContext[file] = content;
    }
  }

  return Object.entries(templateContext)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');
}

export async function generatePlan(env, brief, templateContext = '') {
  const planPrompt = buildPlanPrompt(brief, templateContext);

  try {
    const { text, provider } = await callAI(env, planPrompt.messages, {
      system: planPrompt.system,
      maxTokens: 4000,
      task: 'plan'
    });

    let plan;
    try {
      plan = extractJson(text);
    } catch {
      plan = defaultPlan(brief);
    }

    if (!plan.steps || !Array.isArray(plan.steps)) {
      plan = defaultPlan(brief);
    }

    plan.steps = plan.steps.map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      name: step.name || `Step ${index + 1}`,
      description: step.description || '',
      files: Array.isArray(step.files) ? step.files : [],
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      ...step
    }));

    return { plan, provider };
  } catch {
    return {
      plan: defaultPlan(brief),
      provider: null
    };
  }
}

export function buildPlanPrompt(brief, templateContext) {
  const system = `You are SHEEPER, an AI website builder that turns canonical briefs into staged build plans. Each step should leave the site in a coherent, reviewable state. Keep the plan practical for a static HTML site and avoid unnecessary fragmentation.`;

  const content = `Create a build plan for this website project.

## Canonical Brief
- Name: ${brief.name}
- Summary: ${brief.summary || 'Not specified'}
- Purpose: ${brief.purpose || 'Not specified'}
- Audience: ${brief.audience || 'Not specified'}
- Primary CTA: ${brief.primaryCta || 'Not specified'}
- Input Mode: ${brief.inputMode || 'guided'}
- Domain: ${brief.domain || 'TBD'}
- Language: ${brief.language || 'en'}
- Pages: ${(brief.pages || []).join(', ') || 'Home'}
- Must-Have Sections: ${(brief.mustHaveSections || []).join(', ') || 'Not specified'}
- Tone: ${brief.tone || 'Not specified'}
- Style Keywords: ${(brief.styleKeywords || []).join(', ') || 'Not specified'}
- Design Direction: ${brief.designDirection || 'Not specified'}
- Notes: ${brief.notes || 'None'}
- Assumptions: ${(brief.assumptions || []).join(' | ') || 'None'}
- Source Strategy: ${brief.sourceMode || 'modernize'}
- Source Inputs: ${brief.sourceInputs || 'None'}

${templateContext ? `## Existing Project Context\n${templateContext}` : ''}

## Instructions
Create a build plan as JSON. The plan should have 3-7 steps that progressively build a strong first version of the site. For one-page sites, expand index.html over multiple steps rather than inventing unnecessary extra pages. For multi-page sites, group pages logically.

Respond ONLY with JSON:
{
  "overview": "Short description of the build approach",
  "estimatedFiles": 8,
  "steps": [
    {
      "id": "step-1",
      "name": "Foundation",
      "description": "What this step creates and why",
      "files": ["index.html", "styles.css"],
      "dependsOn": []
    }
  ]
}

Guidelines:
- Step 1 should establish the visual system and the core homepage shell.
- Every step should keep the repo in a functional state.
- Use static HTML, CSS, and minimal JS only.
- The final step should be polish and SEO.
- Prefer meaningful consolidation over lots of tiny steps.
- If the brief implies a single-page site, keep the main build centered on index.html.
- Include supporting assets only when they materially help the build.`;

  return {
    system,
    messages: [{ role: 'user', content }]
  };
}

export function defaultPlan(brief) {
  const pages = normalizeList(brief.pages).length ? normalizeList(brief.pages) : ['Home'];
  const sections = normalizeList(brief.mustHaveSections);
  const singlePage = pages.length <= 1;

  const steps = [
    {
      id: 'step-1',
      name: 'Foundation',
      description: 'Establish the homepage shell, design system, and shared visual language.',
      files: ['index.html', 'styles.css'],
      dependsOn: []
    }
  ];

  if (singlePage) {
    steps.push({
      id: 'step-2',
      name: 'Core sections',
      description: `Build the primary one-page experience around ${formatList(sections, 'the main content sections')}.`,
      files: ['index.html'],
      dependsOn: ['step-1']
    });
  } else {
    const supportingPages = pages
      .filter((page) => page.toLowerCase() !== 'home')
      .slice(0, 4)
      .map((page) => `${slugify(page)}.html`);

    steps.push({
      id: 'step-2',
      name: 'Core pages',
      description: 'Create the main page flow and the first round of supporting pages.',
      files: ['index.html', ...supportingPages.slice(0, 2)],
      dependsOn: ['step-1']
    });

    if (supportingPages.length > 2) {
      steps.push({
        id: 'step-3',
        name: 'Supporting pages',
        description: 'Add the remaining supporting pages and connect navigation cleanly.',
        files: supportingPages.slice(2),
        dependsOn: ['step-2']
      });
    }
  }

  steps.push({
    id: `step-${steps.length + 1}`,
    name: 'Polish and SEO',
    description: 'Tighten metadata, polish copy hierarchy, and add SEO essentials.',
    files: ['index.html', 'sitemap.xml', 'robots.txt'],
    dependsOn: [steps[steps.length - 1].id]
  });

  return {
    overview: `Build ${brief.name} as a ${singlePage ? 'focused one-page' : 'multi-page'} static website.`,
    estimatedFiles: singlePage ? 4 : Math.max(6, pages.length + 3),
    steps
  };
}

function formatList(items, fallback) {
  if (!items.length) return fallback;
  return items.join(', ');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}
