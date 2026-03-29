import {
  checkAuth,
  jsonResponse,
  errorResponse
} from '../_shared.js';
import {
  buildIntakeRecord,
  normalizeBrief
} from '../_brief.js';
import {
  createPreviewSession,
  previewCookieHeader
} from '../_preview.js';
import {
  generatePlan,
  loadTemplateContext
} from '../_plan.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();

    const brief = normalizeBrief(body?.brief || {}, {
      advanced: body?.intake?.advanced || body?.brief,
      sourceMaterial: body?.intake?.sourceMaterial,
      summary: body?.intake?.summary || body?.brief?.summary || body?.brief?.purpose,
      assumptions: body?.intake?.assumptions || body?.brief?.assumptions,
      inputMode: body?.brief?.inputMode || body?.intake?.inputMode,
      fallbackName: body?.brief?.name || 'New Site'
    });

    const intakeRecord = buildIntakeRecord(body?.intake || {}, brief);
    const templateContext = await loadTemplateContext(brief, env.GITHUB_TOKEN);
    const { plan, provider } = await generatePlan(env, brief, templateContext);

    const log = {
      currentStep: 0,
      completedSteps: [],
      totalFiles: [],
      lastUpdated: new Date().toISOString()
    };

    const session = await createPreviewSession(env, request.url, {
      brief,
      intake: intakeRecord,
      plan,
      log
    });

    return jsonResponse({
      sessionId: session.sessionId,
      previewUrl: session.previewUrl,
      expiresAt: session.expiresAt,
      brief,
      intake: intakeRecord,
      plan,
      log,
      storage: 'preview',
      provider
    }, 200, {
      'Set-Cookie': previewCookieHeader(request.url, session.sessionId, session.previewSecret)
    });
  } catch (err) {
    console.error('Preview start error:', err);
    return errorResponse(err.message || 'Failed to start preview session', 500);
  }
}
