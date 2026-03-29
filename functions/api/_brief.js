export const MAX_CLARIFICATION_TURNS = 5;

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

export function normalizeBrief(input = {}, options = {}) {
  const {
    advanced = {},
    summary = '',
    assumptions = [],
    inputMode = 'guided',
    fallbackName = 'New Site'
  } = options;

  const advancedDetails = normalizeAdvancedDetails(advanced);
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
    inputMode: inputMode === 'zero_question' ? 'zero_question' : 'guided',
    createdAt: sanitizeString(input?.createdAt, new Date().toISOString())
  };
}

export function buildIntakeRecord(payload = {}, brief = null) {
  const normalizedBrief = brief ? normalizeBrief(brief, {
    advanced: payload?.advanced,
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
