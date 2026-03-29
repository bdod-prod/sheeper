import {
  callAI,
  extractJson
} from './_shared.js';
import { formatSourceMaterialForPrompt } from './_brief.js';

export async function runStepGeneration(env, {
  brief,
  plan,
  currentStep,
  stepIndex,
  existingFiles,
  existingContents,
  completedSummary,
  templateContext,
  sourceMaterial,
  uploadedFiles,
  userGuidance
}) {
  const uploaded = parseUploadedFiles(uploadedFiles);
  const prompt = buildStepPrompt({
    brief,
    plan,
    currentStep,
    stepIndex,
    existingFiles,
    existingContents,
    completedSummary,
    templateContext,
    sourceMaterial,
    uploadedContent: uploaded.promptText,
    userGuidance
  });

  const { text, provider } = await callAI(env, prompt.messages, {
    system: prompt.system,
    maxTokens: 16000,
    task: 'step'
  });

  const result = extractJson(text);
  if (!result.files || !result.files.length) {
    throw new Error('AI generated no files. Try adding more guidance.');
  }

  return {
    summary: result.summary || `Completed ${currentStep.name}`,
    files: normalizeGeneratedFiles(result.files),
    notes: result.notes || '',
    uploadedAssets: uploaded.imageAssets,
    provider
  };
}

export async function runEditGeneration(env, {
  siteLabel,
  siteFiles,
  existingContents,
  contextContents,
  userRequest,
  uploadedFiles,
  sourceMaterial
}) {
  const uploaded = parseUploadedFiles(uploadedFiles);

  const { text: planText } = await callAI(env, [{
    role: 'user',
    content: buildEditSelectPrompt({
      siteLabel,
      siteFiles,
      contextContents,
      userRequest,
      sourceMaterial
    })
  }], { maxTokens: 2000, task: 'edit_select' });

  let filesToRead = [];
  try {
    filesToRead = extractJson(planText).files_to_read || [];
  } catch {}

  const selectedContents = {};
  for (const filePath of filesToRead.slice(0, 8)) {
    if (existingContents[filePath]) {
      selectedContents[filePath] = existingContents[filePath];
    }
  }

  const { text: changeText, provider } = await callAI(env, [{
    role: 'user',
    content: buildEditPrompt({
      siteFiles,
      existingContents: selectedContents,
      userRequest,
      uploadedContent: uploaded.promptText,
      sourceMaterial
    })
  }], { maxTokens: 16000, task: 'edit' });

  const changes = extractJson(changeText);
  if (!changes.files?.length) {
    throw new Error('AI generated no changes. Be more specific.');
  }

  return {
    summary: changes.summary || 'Changes applied.',
    files: normalizeGeneratedFiles(changes.files),
    uploadedAssets: uploaded.imageAssets,
    provider
  };
}

export function buildStepPrompt({
  brief,
  plan,
  currentStep,
  stepIndex,
  existingFiles,
  existingContents,
  completedSummary,
  templateContext,
  sourceMaterial,
  uploadedContent,
  userGuidance
}) {
  const system = `You are SHEEPER, a website builder AI. You generate production-ready static HTML files. You follow these rules strictly:
- Clean, semantic HTML5
- Self-hosted fonts (Google Fonts via CSS import is acceptable for MVP)
- WebP images with lazy loading, width/height attributes
- Clean internal links (no .html extensions - use trailing slash or bare paths)
- Responsive design (mobile-first)
- JSON-LD structured data where appropriate
- Canonical URLs on all pages
- Consistent header/footer across all pages
- Accessible markup (ARIA labels, alt text, semantic elements)
- Fast: minimal JS, no frameworks, inline critical CSS where practical
- Every file you generate must be COMPLETE - no placeholders, no "add content here"`;

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
- Source Strategy: ${brief.sourceMode || 'modernize'}
- Source Inputs: ${brief.sourceInputs || 'None'}

### Build Plan Overview
${plan.overview || 'Progressive static site build'}

### Step Details
**${currentStep.name}**: ${currentStep.description}
Expected files: ${(currentStep.files || []).join(', ')}

${completedSummary ? `### Previously Completed\n${completedSummary}` : '### This is the first step'}

### Current Repository Files
${existingFiles.length ? existingFiles.join('\n') : '(empty project state)'}

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

function buildEditSelectPrompt({
  siteLabel,
  siteFiles,
  contextContents,
  userRequest,
  sourceMaterial
}) {
  const contextText = Object.entries(contextContents || {})
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');
  const sourceContext = formatSourceMaterialForPrompt(sourceMaterial);

  return `You are an AI editor for the ${siteLabel} website. Determine which files to read.

## Repository Files
${siteFiles.join('\n')}

${contextText ? `## Context\n${contextText}` : ''}

${sourceContext ? `## Source Material\n${sourceContext}` : ''}

## User Request
"${userRequest}"

Respond ONLY with JSON: { "files_to_read": ["path/file.html"], "reasoning": "why" }
Select MINIMUM files (1-5).`;
}

function buildEditPrompt({
  siteFiles,
  existingContents,
  userRequest,
  uploadedContent,
  sourceMaterial
}) {
  const existingFilesText = Object.entries(existingContents)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');
  const sourceContext = formatSourceMaterialForPrompt(sourceMaterial);

  return `You are SHEEPER, an AI site editor. Make the requested changes precisely.

## Repository Files
${siteFiles.join('\n')}

## Existing Files
${existingFilesText}

${sourceContext ? `## Source Material\n${sourceContext}` : ''}

## User Request
"${userRequest}"

${uploadedContent ? `## Uploaded Content\n${uploadedContent}` : ''}

Rules: Return COMPLETE files (not diffs). Change ONLY what's requested. Maintain consistency.

Response (JSON only, no backticks):
{
  "summary": "What was changed",
  "files": [{ "path": "file.html", "action": "modified", "content": "full content" }]
}`;
}

export function parseUploadedFiles(uploadedFiles = []) {
  const promptParts = [];
  const imageAssets = [];

  for (const file of uploadedFiles || []) {
    if (file.type && file.type.startsWith('image/')) {
      promptParts.push(`[Uploaded image: ${file.name}]`);
      imageAssets.push({
        path: `images/${file.name}`,
        content: file.data,
        encoding: 'base64',
        contentType: file.type,
        binary: true
      });
      continue;
    }

    try {
      const text = decodeBase64ToText(file.data);
      promptParts.push(`--- Uploaded: ${file.name} ---\n${text}`);
    } catch {
      promptParts.push(`[Uploaded binary: ${file.name}]`);
    }
  }

  return {
    promptText: promptParts.join('\n\n'),
    imageAssets
  };
}

export function normalizeGeneratedFiles(files = []) {
  return files
    .map((file) => ({
      path: String(file?.path || '').trim(),
      action: String(file?.action || 'modified').trim() || 'modified',
      content: typeof file?.content === 'string' ? file.content : ''
    }))
    .filter((file) => file.path && file.content);
}

export function decodeBase64ToText(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}
