const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch() {
    return new Response('Preview session Durable Object worker', { status: 404 });
  }
};

export class PreviewSessionDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const body = await request.json();

    if (url.pathname === '/create') {
      return this.handleCreate(body);
    }
    if (url.pathname === '/get') {
      return this.handleGet();
    }
    if (url.pathname === '/update') {
      return this.handleUpdate(body);
    }

    return json({ error: 'Not found' }, 404);
  }

  async alarm() {
    const session = await this.state.storage.get('session');
    if (!session) {
      await this.state.storage.deleteAll();
      return;
    }

    if (new Date(session.expiresAt).getTime() > Date.now()) {
      await this.state.storage.setAlarm(new Date(session.expiresAt).getTime());
      return;
    }

    const prefix = `sessions/${session.sessionId}/`;
    let cursor;
    do {
      const listing = await this.env.PREVIEW_ASSETS.list({ prefix, cursor });
      if (listing.objects.length) {
        await this.env.PREVIEW_ASSETS.delete(listing.objects.map((object) => object.key));
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    await this.state.storage.deleteAll();
  }

  async handleCreate(body) {
    const current = await this.state.storage.get('session');
    if (current) {
      return json({ session: current });
    }

    const now = new Date();
    const session = {
      sessionId: body.sessionId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      previewSecret: crypto.randomUUID(),
      brief: body.brief || null,
      intake: body.intake || null,
      plan: body.plan || null,
      log: body.log || null,
      currentVersion: 0,
      files: [],
      shipped: null,
      deployed: false
    };

    await this.persist(session);
    return json({ session });
  }

  async handleGet() {
    const session = await this.getActiveSession();
    if (!session) {
      return json({ error: 'Preview session not found or expired' }, 404);
    }

    const touched = this.touchSession(session);
    await this.persist(touched);
    return json({ session: touched });
  }

  async handleUpdate(body) {
    const session = await this.getActiveSession();
    if (!session) {
      return json({ error: 'Preview session not found or expired' }, 404);
    }

    const next = this.touchSession({
      ...session,
      brief: body.brief !== undefined ? body.brief : session.brief,
      intake: body.intake !== undefined ? body.intake : session.intake,
      plan: body.plan !== undefined ? body.plan : session.plan,
      log: body.log !== undefined ? body.log : session.log,
      currentVersion: body.currentVersion !== undefined ? body.currentVersion : session.currentVersion,
      files: Array.isArray(body.files) ? body.files : session.files,
      shipped: body.shipped !== undefined ? body.shipped : session.shipped,
      deployed: body.deployed !== undefined ? body.deployed : session.deployed
    });

    await this.persist(next);
    return json({ session: next });
  }

  async getActiveSession() {
    const session = await this.state.storage.get('session');
    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.alarm();
      return null;
    }

    return session;
  }

  touchSession(session) {
    const now = new Date();
    return {
      ...session,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
    };
  }

  async persist(session) {
    await this.state.storage.put('session', session);
    await this.state.storage.setAlarm(new Date(session.expiresAt).getTime());
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
