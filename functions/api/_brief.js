export const MAX_CLARIFICATION_TURNS = 5;
export const SOURCE_TEXT_LIMIT = 16000;
export const SOURCE_FILE_LIMIT = 3;

const SOURCE_MODES = new Set(['preserve', 'modernize', 'rebuild']);

export function sanitizeString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim();
  return text || fallback;
}

export function normalizeList(value) {
  const source = Array.isArray(value)
    ? value
    : sanitizeString(value)
      ? String(value).split(/[\n,]+/)
      : [];

  const seen = new Set();
  const items = [];

  for (const entry of source) {
    const text = sanitizeString(entry);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    items.push(text);
  }

  return items;
}

export function normalizeConversationHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeString(message?.content)
    }))
    .filter((message) => message.content);
}

export function normalizeAdvancedDetails(advanced = {}) {
  return {
    domain: sanitizeString(advanced?.domain),
    language: sanitizeString(advanced?.language, 'en'),
    templateRepo: sanitizeString(advanced?.templateRepo)
  };
}

export function normalizeSourceMaterial(source = {}) {
  const url = sanitizeString(source?.url);
  return {
    url,
    mode: normalizeSourceMode(source?.mode),
    text: truncateText(source?.text),
    files: normalizeSourceFiles(source?.files),
    urlTitle: url ? sanitizeString(source?.urlTitle) : '',
    urlText: url ? truncateText(source?.urlText) : ''
  };
}

export function normalizeBrief(input = {}, options = {}) {
  const {
    advanced = {},
    sourceMaterial = {},
    summary = '',
    assumptions = [],
    inputMode = 'guided',
    fallbackName = 'New Site'
  } = options;

  const advancedDetails = normalizeAdvancedDetails(advanced);
  const normalizedSource = normalizeSourceMaterial(sourceMaterial);
  const rawPages = normalizeList(input?.pages);
  const rawSections = normalizeList(input?.mustHaveSections || input?.sections);
  const styleKeywords = normalizeList(input?.styleKeywords);
  const assumptionList = normalizeList([
    ...normalizeList(input?.assumptions),
    ...normalizeList(assumptions)
  ]);

  const normalizedSummary = firstNonEmpty(
    sanitizeString(input?.summary),
    sanitizeString(summary),
    sanitizeString(input?.purpose)
  );

  const tone = sanitizeString(input?.tone);
  const designDirection = sanitizeString(
    input?.designDirection,
    buildDesignDirection(tone, styleKeywords)
  );

  const notes = joinParts([
    input?.notes,
    input?.constraints,
    input?.references
  ]);

  const pages = rawPages.length ? rawPages : ['Home'];
  const mustHaveSections = rawSections.length
    ? rawSections
    : normalizeList(rawPages.length > 1 ? rawPages.slice(0, 4) : ['Hero', 'Core story', 'Contact']);

  return {
    name: firstNonEmpty(sanitizeString(input?.name), fallbackName, 'New Site'),
    summary: normalizedSummary,
    domain: firstNonEmpty(sanitizeString(input?.domain), advancedDetails.domain),
    language: firstNonEmpty(sanitizeString(input?.language), advancedDetails.language, 'en'),
    purpose: firstNonEmpty(sanitizeString(input?.purpose), normalizedSummary),
    pages,
    mustHaveSections,
    designDirection,
    templateRepo: firstNonEmpty(sanitizeString(input?.templateRepo), advancedDetails.templateRepo),
    notes,
    audience: sanitizeString(input?.audience),
    primaryCta: firstNonEmpty(sanitizeString(input?.primaryCta), sanitizeString(input?.primaryCTA)),
    tone,
    styleKeywords,
    assumptions: assumptionList,
    sourceMode: firstNonEmpty(sanitizeString(input?.sourceMode), normalizedSource.mode),
    sourceInputs: describeSourceMaterial(normalizedSource),
    inputMode: inputMode === 'zero_question' ? 'zero_question' : 'guided',
    createdAt: sanitizeString(input?.createdAt, new Date().toISOString())
  };
}

export function buildIntakeRecord(payload = {}, brief = null) {
  const normalizedSource = normalizeSourceMaterial(payload?.sourceMaterial);
  const normalizedBrief = brief ? normalizeBrief(brief, {
    advanced: payload?.advanced,
    sourceMaterial: normalizedSource,
    summary: payload?.summary,
    assumptions: payload?.assumptions,
    inputMode: brief?.inputMode,
    fallbackName: brief?.name || 'New Site'
  }) : null;

  const assumptionSource = normalizeList(
    payload?.assumptions || normalizedBrief?.assumptions || []
  );

  return {
    history: normalizeConversationHistory(payload?.history),
    summary: firstNonEmpty(
      sanitizeString(payload?.summary),
      sanitizeString(normalizedBrief?.summary),
      sanitizeString(normalizedBrief?.purpose)
    ),
    assumptions: assumptionSource,
    missingTopics: normalizeList(payload?.missingTopics),
    inputMode: normalizedBrief?.inputMode || (payload?.inputMode === 'zero_question' ? 'zero_question' : 'guided'),
    advanced: normalizeAdvancedDetails(payload?.advanced || normalizedBrief || {}),
    sourceMaterial: normalizedSource,
    capturedAt: new Date().toISOString()
  };
}

export function latestUserMessage(history = []) {
  const normalized = normalizeConversationHistory(history);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index].role === 'user') {
      return normalized[index].content;
    }
  }
  return '';
}

export function looksDetailedEnough(history = []) {
  const latest = latestUserMessage(history).toLowerCase();
  if (!latest) return false;

  const signalWords = [
    'hero',
    'services',
    'contact',
    'landing',
    'one-page',
    'one page',
    'portfolio',
    'pricing',
    'about',
    'tone',
    'minimal',
    'modern',
    'dark',
    'cta',
    'section'
  ];

  const signalCount = signalWords.filter((word) => latest.includes(word)).length;
  return latest.length >= 180 || signalCount >= 3;
}

export function hasSourceMaterial(source = {}) {
  const normalized = normalizeSourceMaterial(source);
  return Boolean(
    normalized.url ||
    normalized.text ||
    normalized.urlText ||
    normalized.files.length
  );
}

export function describeSourceMaterial(source = {}) {
  const normalized = normalizeSourceMaterial(source);
  const parts = [];

  if (normalized.url) {
    parts.push(`URL: ${normalized.url}`);
  }
  if (normalized.urlTitle) {
    parts.push(`URL title: ${normalized.urlTitle}`);
  }
  if (normalized.text) {
    parts.push('Pasted source text provided');
  }
  if (normalized.files.length) {
    parts.push(`Source files: ${normalized.files.map((file) => file.name).join(', ')}`);
  }

  return parts.join(' | ');
}

export function formatSourceMaterialForPrompt(source = {}) {
  const normalized = normalizeSourceMaterial(source);
  if (!hasSourceMaterial(normalized)) {
    return '';
  }

  const sections = [
    `Source strategy: ${normalized.mode}`
  ];

  if (normalized.url) {
    sections.push(`Source URL: ${normalized.url}`);
  }
  if (normalized.urlTitle) {
    sections.push(`Source title: ${normalized.urlTitle}`);
  }
  if (normalized.urlText) {
    sections.push(`Source URL content:\n${normalized.urlText}`);
  }
  if (normalized.text) {
    sections.push(`Pasted source text:\n${normalized.text}`);
  }
  if (normalized.files.length) {
    sections.push(normalized.files.map((file) => `--- Source file: ${file.name} ---\n${file.content}`).join('\n\n'));
  }

  return sections.join('\n\n');
}

function buildDesignDirection(tone, styleKeywords) {
  const pieces = [];
  if (tone) pieces.push(`Tone: ${tone}`);
  if (styleKeywords.length) pieces.push(`Style keywords: ${styleKeywords.join(', ')}`);
  return pieces.join(' | ');
}

function joinParts(parts) {
  return parts
    .map((part) => sanitizeString(part))
    .filter(Boolean)
    .join('\n\n');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = sanitizeString(value);
    if (text) return text;
  }
  return '';
}

function normalizeSourceMode(value) {
  const normalized = sanitizeString(value, 'modernize').toLowerCase();
  return SOURCE_MODES.has(normalized) ? normalized : 'modernize';
}

function normalizeSourceFiles(files = []) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .slice(0, SOURCE_FILE_LIMIT)
    .map((file) => ({
      name: sanitizeString(file?.name, 'source.txt'),
      content: truncateText(file?.content)
    }))
    .filter((file) => file.content);
}

function truncateText(value) {
  const text = sanitizeString(value);
  if (!text) {
    return '';
  }
  return text.slice(0, SOURCE_TEXT_LIMIT);
}
