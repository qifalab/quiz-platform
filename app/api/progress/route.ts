import { env } from 'cloudflare:workers';

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ progress: [] });
  const userId = new URL(request.url).searchParams.get('user') || 'guest';
  const rows = await env.DB.prepare('SELECT question_id,selected,correct,updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all();
  return Response.json(rows.results || []);
}

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: 'Database unavailable' }, { status: 503 });
  const body = await request.json() as { questionId?: string; selected?: string[]; correct?: boolean; userId?: string };
  if (!body.questionId) return Response.json({ error: 'questionId is required' }, { status: 400 });
  await env.DB.prepare('INSERT INTO progress (user_id,question_id,selected,correct,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET selected=excluded.selected,correct=excluded.correct,updated_at=excluded.updated_at').bind(body.userId || 'guest', body.questionId, JSON.stringify(body.selected || []), body.correct ? 1 : 0, Date.now()).run();
  return Response.json({ saved: true });
}
