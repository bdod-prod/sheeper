// POST /api/step
// Executes a build step:
// 1. Reads brief, plan, log, and existing files from the branch
// 2. Calls AI with full context to generate files for this step
// 3. Commits generated files to the branch
// 4. Updates _sheeper/log.json
// 5. Returns summary + preview URL

import {
  checkAuth, jsonResponse, errorResponse, callAI, extractJson,
  githubGetFile, githubGetFileSafe, githubGetTree, githubCommitFiles
} from './_shared.js';
import { formatSourceMaterialForPrompt } from './_brief.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const { owner, repo, branch, stepIndex, userGuidance, files: uploadedFiles } = body;

    if (!owner || !repo || !branch) {
      return errorResponse('owner, repo, and branch are required', 400);
    }

    const token = env.GITHUB_TOKEN;

    // Step 1: Read project state
    const [briefRaw, planRaw, logRaw, intakeRaw] = await Promise.all([
      githubGetFile(owner, repo, '_sheeper/brief.json', branch, token),
      githubGetFile(owner, repo, '_sheeper/plan.json', branch, token),
      githubGetFile(owner, repo, '_sheeper/log.json', branch, token),
      githubGetFileSafe(owner, repo, '_sheeper/intake.json', branch, token)
    ]);

    const brief = JSON.parse(briefRaw);
    const plan = JSON.parse(planRaw);
    const log = JSON.parse(logRaw);
    const intake = intakeRaw ? JSON.parse(intakeRaw) : null;

    // Determine which step to execute
    const targetStep = stepIndex !== undefined ? stepIndex : log.currentStep;
    if (targetStep >= plan.steps.length) {
      return errorResponse('All steps are already completed', 400);
    }

    const currentStepDef = plan.steps[targetStep];

    // Step 2: Get current file tree
    const fileTree = await githubGetTree(owner, repo, branch, token);
    const siteFiles = fileTree.filter(f => !f.startsWith('_sheeper/'));

    // Step 3: Read existing files that are relevant to this step
    // Read all existing HTML/CSS files for context (up to 10)
    const existingContents = {};
    const filesToRead = siteFiles
      .filter(f => f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.js'))
      .slice(0, 10);

    for (const filePath of filesToRead) {
      const content = await githubGetFileSafe(owner, repo, filePath, branch, token);
      if (content) {
        existingContents[filePath] = content;
      }
    }

    // Step 4: Read template context if available from a different repo
    let templateContext = '';
    if (brief.templateRepo) {
      const [tOwner, tRepo] = brief.templateRepo.split('/');
      if (tOwner && tRepo) {
        for (const tFile of ['README.md', 'decisions.md']) {
          const content = await githubGetFileSafe(tOwner, tRepo, tFile, 'main', token);
          if (content) {
            templateContext += `--- Template: ${tFile} ---\n${content}\n\n`;
          }
        }
      }
    }

    // Step 5: Prepare uploaded file content
    const uploadedContent = (uploadedFiles || []).map(f => {
      if (f.type && f.type.startsWith('image/')) {
        return `[Uploaded image: ${f.name}]`;
      }
      try {
        const text = atob(f.data);
        return `--- Uploaded: ${f.name} ---\n${text}`;
      } catch {
        return `[Uploaded binary: ${f.name}]`;
      }
    }).join('\n\n');

    // Step 6: Build completed steps summary
    const completedSummary = log.completedSteps
      .map(s => `✅ ${s.name}: ${s.summary} (files: ${s.files.join(', ')})`)
      .join('\n');

    // Step 7: Call AI to generate files
    const prompt = buildStepPrompt({
      brief,
      plan,
      currentStep: currentStepDef,
      stepIndex: targetStep,
      existingFiles: siteFiles,
      existingContents,
      completedSummary,
      templateContext,
      sourceMaterial: intake?.sourceMaterial,
      uploadedContent,
      userGuidance
    });

    const { text: aiResponse, provider } = await callAI(env, prompt.messages, {
      system: prompt.system,
      maxTokens: 16000,
      task: 'step'
    });

    let result;
    try {
      result = extractJson(aiResponse);
    } catch {
      throw new Error('AI returned invalid response. Please try this step again.');
    }

    if (!result.files || !result.files.length) {
      throw new Error('AI generated no files. Try adding more guidance.');
    }

    // Step 8: Commit generated files
    const commitFiles = result.files.map(f => ({
      path: f.path,
      content: f.content
    }));

    // Also commit uploaded images as base64
    if (uploadedFiles && uploadedFiles.length) {
      for (const f of uploadedFiles) {
        if (f.type && f.type.startsWith('image/')) {
          commitFiles.push({
            path: `images/${f.name}`,
            content: f.data,
            encoding: 'base64'
          });
        }
      }
    }

    // Update log
    const updatedLog = {
      currentStep: targetStep + 1,
      completedSteps: [
        ...log.completedSteps,
        {
          id: currentStepDef.id,
          name: currentStepDef.name,
          summary: result.summary || `Completed ${currentStepDef.name}`,
          files: result.files.map(f => f.path),
          provider,
          completedAt: new Date().toISOString()
        }
      ],
      totalFiles: [
        ...new Set([
          ...log.totalFiles,
          ...result.files.map(f => f.path)
        ])
      ],
      lastUpdated: new Date().toISOString()
    };

    commitFiles.push({
      path: '_sheeper/log.json',
      content: JSON.stringify(updatedLog, null, 2)
    });

    await githubCommitFiles(
      owner, repo, branch, commitFiles,
      `sheeper: ${currentStepDef.name}`,
      token
    );

    // Step 9: Build preview URL
    const cfBranch = branch.replace(/\//g, '-');
    const previewUrl = brief.domain
      ? `https://${cfBranch}.${brief.domain.replace('https://', '').replace('http://', '')}`
      : `https://${cfBranch}.${repo}.pages.dev`;

    return jsonResponse({
      step: currentStepDef,
      stepIndex: targetStep,
      summary: result.summary || `Completed: ${currentStepDef.name}`,
      files: result.files.map(f => ({
        path: f.path,
        action: f.action || 'created'
      })),
      log: updatedLog,
      previewUrl,
      isLastStep: targetStep + 1 >= plan.steps.length,
      provider
    });

  } catch (err) {
    console.error('Step error:', err);
    return errorResponse(err.message || 'Failed to execute build step', 500);
  }
}

// === PROMPT BUILDER ===

function buildStepPrompt({
  brief, plan, currentStep, stepIndex, existingFiles,
  existingContents, completedSummary, templateContext,
  sourceMaterial, uploadedContent, userGuidance
}) {
  const system = `You are SHEEPER, a website builder AI. You generate production-ready static HTML files. You follow these rules strictly:
- Clean, semantic HTML5
- Self-hosted fonts (Google Fonts via CSS import is acceptable for MVP)
- WebP images with lazy loading, width/height attributes
- Clean internal links (no .html extensions — use trailing slash or bare paths)
- Responsive design (mobile-first)
- JSON-LD structured data where appropriate
- Canonical URLs on all pages
- Consistent header/footer across all pages
- Accessible markup (ARIA labels, alt text, semantic elements)
- Fast: minimal JS, no frameworks, inline critical CSS where practical
- Every file you generate must be COMPLETE — no placeholders, no "add content here"`;

  const existingFilesStr = Object.entries(existingContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');
  const sourceContext = formatSourceMaterialForPrompt(sourceMaterial);

  const content = `## Current Build Step: ${currentStep.name} (Step ${stepIndex + 1} of ${plan.steps.length})

### Project Brief
- Site Name: ${brief.name}
- Summary: ${brief.summary || brief.purpose || 'Not specified'}
- Domain: ${brief.domain || 'TBD'}
- Language: ${brief.language || 'en'}
- Purpose: ${brief.purpose || 'Not specified'}
- Audience: ${brief.audience || 'Not specified'}
- Primary CTA: ${brief.primaryCta || 'Not specified'}
- Pages: ${(brief.pages || []).join(', ') || 'Home'}
- Must-Have Sections: ${(brief.mustHaveSections || []).join(', ') || 'Not specified'}
- Tone: ${brief.tone || 'Not specified'}
- Style Keywords: ${(brief.styleKeywords || []).join(', ') || 'Not specified'}
- Design Direction: ${brief.designDirection || 'Modern, clean, professional'}
- Notes: ${brief.notes || 'None'}
- Assumptions: ${(brief.assumptions || []).join(' | ') || 'None'}

### Build Plan Overview
${plan.overview || 'Progressive static site build'}

### Step Details
**${currentStep.name}**: ${currentStep.description}
Expected files: ${(currentStep.files || []).join(', ')}

${completedSummary ? `### Previously Completed\n${completedSummary}` : '### This is the first step'}

### Current Repository Files
${existingFiles.length ? existingFiles.join('\n') : '(empty repository)'}

${existingFilesStr ? `### Existing File Contents\n${existingFilesStr}` : ''}

${templateContext ? `### Template Reference\n${templateContext}` : ''}

${sourceContext ? `### Source Material\n${sourceContext}` : ''}

${uploadedContent ? `### Uploaded Content\n${uploadedContent}` : ''}

${userGuidance ? `### Additional Guidance from User\n${userGuidance}` : ''}

## Instructions
Generate the files for this build step. Each file must be COMPLETE and production-ready.
${stepIndex === 0 ? 'This is the foundation step. Create a strong base that all future steps will build on. Include the full CSS design system.' : 'Build on the existing files. Maintain consistent styling, header, footer, and navigation.'}
${existingFilesStr ? 'Reference the existing files for style consistency.' : ''}

## Response Format
Respond ONLY with a JSON object (no markdown fences, no extra text):
{
  "summary": "Human-readable description of what was built in this step",
  "files": [
    {
      "path": "relative/path/to/file.html",
      "action": "created",
      "content": "complete file content"
    }
  ],
  "notes": "Any notes about decisions made or things to consider in future steps"
}`;

  return {
    system,
    messages: [{ role: 'user', content }]
  };
}
