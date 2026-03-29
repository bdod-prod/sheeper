import {
  checkAuth,
  jsonResponse,
  errorResponse,
  callAI,
  extractJson
} from './_shared.js';
import {
  MAX_CLARIFICATION_TURNS,
  buildIntakeRecord,
  latestUserMessage,
  looksDetailedEnough,
  normalizeAdvancedDetails,
  normalizeBrief,
  normalizeConversationHistory,
  normalizeList,
  sanitizeString
} from './_brief.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const history = normalizeConversationHistory(body?.history);
    const advanced = normalizeAdvancedDetails(body?.advanced);
    const currentBrief = body?.currentBrief || null;
    const clarificationTurns = clampTurns(body?.turns);

    if (!history.length) {
      return errorResponse('history is required', 400);
    }

    const decision = await analyzeIntake(env, {
      history,
      advanced,
      currentBrief,
      clarificationTurns
    });

    const shouldCompile = decision.status === 'ready' || clarificationTurns >= MAX_CLARIFICATION_TURNS;

    if (!shouldCompile) {
      return jsonResponse({
        status: 'clarify',
        assistantReply: sanitizeString(
          decision.assistantReply,
          'One thing before I build: who is this site for, and what should visitors do when they land on it?'
        ),
        summary: sanitizeString(decision.summary),
        missingTopics: normalizeList(decision.missingTopics),
        assumptions: normalizeList(decision.assumptions),
        turns: Math.min(MAX_CLARIFICATION_TURNS, clarificationTurns + 1),
        inputMode: clarificationTurns === 0 ? 'zero_question' : 'guided'
      });
    }

    const compiled = await compileBrief(env, {
      history,
      advanced,
      currentBrief,
      clarificationTurns,
      decision
    });

    if (!compiled) {
      return jsonResponse({
        status: 'clarify',
        assistantReply: 'I have most of what I need, but I want to pin down the audience and the main call to action before I build. Who is this site for, and what should they do next?',
        summary: sanitizeString(decision.summary),
        missingTopics: normalizeList(['audience', 'primary CTA']),
        assumptions: normalizeList(decision.assumptions),
        turns: Math.min(MAX_CLARIFICATION_TURNS, clarificationTurns + 1),
        inputMode: clarificationTurns === 0 ? 'zero_question' : 'guided'
      });
    }

    const intakeRecord = buildIntakeRecord({
      history,
      summary: compiled.summary,
      assumptions: compiled.assumptions,
      missingTopics: [],
      inputMode: compiled.inputMode,
      advanced
    }, compiled);

    return jsonResponse({
      status: 'ready',
      assistantReply: sanitizeString(
        decision.assistantReply,
        'I think I have enough. Here is the brief I understood before we build.'
      ),
      brief: compiled,
      summary: intakeRecord.summary,
      assumptions: intakeRecord.assumptions,
      missingTopics: [],
      turns: clarificationTurns,
      inputMode: compiled.inputMode
    });

  } catch (err) {
    console.error('Intake error:', err);
    return errorResponse(err.message || 'Failed to process intake', 500);
  }
}

async function analyzeIntake(env, { history, advanced, currentBrief, clarificationTurns }) {
  const prompt = buildIntakeDecisionPrompt({ history, advanced, currentBrief, clarificationTurns });

  try {
    const { text } = await callAI(env, prompt.messages, {
      system: prompt.system,
      maxTokens: 2200,
      task: 'intake_chat'
    });
    return extractJson(text);
  } catch (err) {
    console.error('Intake decision fallback:', err);
    if (clarificationTurns >= MAX_CLARIFICATION_TURNS || looksDetailedEnough(history)) {
      return {
        status: 'ready',
        assistantReply: 'I think I have enough. Here is the brief I understood before we build.',
        summary: latestUserMessage(history),
        assumptions: []
      };
    }

    return {
      status: 'clarify',
      assistantReply: 'One thing before I build: who is this site for, and what is the main action you want visitors to take?',
      summary: latestUserMessage(history),
      missingTopics: ['audience', 'primary CTA'],
      assumptions: []
    };
  }
}

async function compileBrief(env, { history, advanced, currentBrief, clarificationTurns, decision }) {
  const prompt = buildBriefCompilePrompt({
    history,
    advanced,
    currentBrief,
    clarificationTurns,
    decision
  });

  try {
    const { text } = await callAI(env, prompt.messages, {
      system: prompt.system,
      maxTokens: 3200,
      task: 'brief_compile'
    });

    const parsed = extractJson(text);
    return normalizeBrief(parsed, {
      advanced,
      summary: parsed?.summary || decision?.summary || latestUserMessage(history),
      assumptions: normalizeList([
        ...normalizeList(parsed?.assumptions),
        ...normalizeList(decision?.assumptions)
      ]),
      inputMode: clarificationTurns === 0 ? 'zero_question' : 'guided',
      fallbackName: currentBrief?.name || 'New Site'
    });
  } catch (err) {
    console.error('Brief compile fallback:', err);
  }

  const fallbackCandidate = normalizeBrief(decision?.candidateBrief || currentBrief || {}, {
    advanced,
    summary: decision?.summary || latestUserMessage(history),
    assumptions: normalizeList(decision?.assumptions),
    inputMode: clarificationTurns === 0 ? 'zero_question' : 'guided',
    fallbackName: currentBrief?.name || 'New Site'
  });

  if (fallbackCandidate.summary || fallbackCandidate.purpose) {
    return fallbackCandidate;
  }

  return null;
}

function buildIntakeDecisionPrompt({ history, advanced, currentBrief, clarificationTurns }) {
  const system = `You are SHEEPER's intake guide. Decide whether the conversation is already build-ready or whether SHEEPER should ask exactly one more question. Prefer moving forward. Avoid forms. Ask a question only when uncertainty would materially hurt the build.`;

  const conversation = history
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');

  const content = `Review this intake conversation for a website build.

## Clarification Budget
- Used: ${clarificationTurns}
- Max: ${MAX_CLARIFICATION_TURNS}
- If the budget is nearly exhausted, prefer READY with reasonable assumptions.

## Current Conversation
${conversation}

${currentBrief ? `## Existing Compiled Brief\n${JSON.stringify(currentBrief, null, 2)}` : ''}
## Advanced Details
${JSON.stringify(advanced, null, 2)}

Respond ONLY with JSON:
{
  "status": "clarify" | "ready",
  "assistantReply": "Either one conversational next question or a short ready signal",
  "summary": "One or two sentences describing what SHEEPER understands it is building",
  "missingTopics": ["audience"],
  "assumptions": ["Assumption SHEEPER can safely make"],
  "inputMode": "zero_question" | "guided",
  "candidateBrief": {
    "name": "Short working site name",
    "purpose": "Why the site exists",
    "audience": "Who the site is for",
    "primaryCta": "Main action",
    "pages": ["Home"],
    "mustHaveSections": ["Hero", "Services", "Contact"],
    "tone": "Confident",
    "styleKeywords": ["minimal", "editorial"],
    "designDirection": "Short visual direction",
    "notes": "Short operational notes"
  }
}

Rules:
- Ask at most one question.
- If the latest user message is already detailed enough, choose "ready".
- Prefer assumptions over asking for decorative details.
- Focus the single question on the uncertainty with the biggest impact on build quality.
- Do not ask for information already implied by the conversation.
- inputMode should be "zero_question" only when no clarification was needed.`;

  return {
    system,
    messages: [{ role: 'user', content }]
  };
}

function buildBriefCompilePrompt({ history, advanced, currentBrief, clarificationTurns, decision }) {
  const system = `You turn SHEEPER conversations into canonical website briefs. Produce a clean, opinionated brief that is ready for build planning. Infer intelligently. Do not ask questions.`;

  const conversation = history
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');

  const content = `Compile the final build brief for this project.

## Conversation
${conversation}

${currentBrief ? `## Existing Brief To Update\n${JSON.stringify(currentBrief, null, 2)}` : ''}
## Intake Decision Context
${JSON.stringify({
    summary: decision?.summary || '',
    assumptions: normalizeList(decision?.assumptions),
    missingTopics: normalizeList(decision?.missingTopics),
    candidateBrief: decision?.candidateBrief || null
  }, null, 2)}

## Advanced Details
${JSON.stringify(advanced, null, 2)}

## Required Output
Respond ONLY with JSON:
{
  "name": "Short site name",
  "summary": "Compact summary of the site SHEEPER will build",
  "purpose": "Why the site exists",
  "audience": "Primary audience",
  "primaryCta": "Main visitor action",
  "pages": ["Home", "About"],
  "mustHaveSections": ["Hero", "Services", "Contact"],
  "tone": "Tone description",
  "styleKeywords": ["minimal", "premium"],
  "designDirection": "Visual direction",
  "domain": "",
  "language": "en",
  "templateRepo": "",
  "notes": "Short notes or constraints",
  "assumptions": ["Any reasonable assumptions SHEEPER is making"],
  "inputMode": "${clarificationTurns === 0 ? 'zero_question' : 'guided'}"
}

Rules:
- Prefer a one-page site unless the conversation clearly calls for multiple pages.
- pages should reflect actual pages, not every section.
- mustHaveSections should capture important sections or content blocks for the first build.
- Keep notes short and useful.
- If the conversation already contains a strong visual direction, preserve it.
- If an existing brief is present, update it instead of discarding it.`;

  return {
    system,
    messages: [{ role: 'user', content }]
  };
}

function clampTurns(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.min(MAX_CLARIFICATION_TURNS, Math.floor(number));
}
