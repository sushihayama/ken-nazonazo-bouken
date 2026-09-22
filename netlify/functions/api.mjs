import { getStore } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const SEED = {
  activeQuestionId: 'f0ee3f40-dcf0-4784-bd1f-230a26ed68aa',
  questions: [
    {
      id: 'f0ee3f40-dcf0-4784-bd1f-230a26ed68aa',
      text: 'ケンが釣り場でいつも一緒の仲間は？',
      choices: { A: 'いぬ', B: 'ねこ', C: 'かもめ', D: 'ロボット' },
      correct: 'B',
      createdAt: '2026-09-22T00:00:00Z',
    },
    {
      id: '16cd1360-52d4-4706-bd10-ace9eae7c101',
      text: '還暦は何歳のお祝い？',
      choices: { A: '50歳', B: '60歳', C: '70歳', D: '77歳' },
      correct: 'B',
      createdAt: '2026-09-22T00:00:01Z',
    },
  ],
  answers: {
    'f0ee3f40-dcf0-4784-bd1f-230a26ed68aa': {},
    '16cd1360-52d4-4706-bd10-ace9eae7c101': {},
  },
};

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function tally(store, qid) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const bucket = store.answers[qid] || {};
  for (const choice of Object.values(bucket)) {
    if (counts[choice] != null) counts[choice] += 1;
  }
  return counts;
}

function publicState(store) {
  const q = store.questions.find((x) => x.id === store.activeQuestionId) || null;
  return {
    activeQuestionId: store.activeQuestionId,
    question: q ? { id: q.id, text: q.text, choices: q.choices } : null,
    tally: q ? tally(store, q.id) : { A: 0, B: 0, C: 0, D: 0 },
    totalAnswers: q ? Object.keys(store.answers[q.id] || {}).length : 0,
    questionsMeta: store.questions.map((x) => ({
      id: x.id,
      text: x.text,
      active: x.id === store.activeQuestionId,
    })),
  };
}

function blobsStore() {
  const opts = { name: 'ken-quiz', consistency: 'strong' };
  if (process.env.NETLIFY_BLOBS_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    opts.siteID = process.env.NETLIFY_BLOBS_SITE_ID;
    opts.token = process.env.NETLIFY_BLOBS_TOKEN;
  }
  return getStore(opts);
}

async function loadStore() {
  const blobs = blobsStore();
  const raw = await blobs.get('store', { type: 'json' });
  if (raw && Array.isArray(raw.questions)) return { blobs, store: raw };
  const seeded = JSON.parse(JSON.stringify(SEED));
  await blobs.setJSON('store', seeded);
  return { blobs, store: seeded };
}

async function saveStore(blobs, store) {
  await blobs.setJSON('store', store);
}

function parsePath(event) {
  let p = event.path || '';
  p = p.replace(/^\/\.netlify\/functions\/api\/?/, '/');
  p = p.replace(/^\/api\/?/, '/');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  const path = parsePath(event);
  const method = event.httpMethod || 'GET';

  try {
    if (method === 'GET' && (path === '/' || path === '/state')) {
      const { store } = await loadStore();
      return json(200, publicState(store));
    }

    if (method === 'POST' && path === '/answer') {
      const body = parseBody(event);
      const { voterId, choice, questionId } = body;
      if (!voterId || !['A', 'B', 'C', 'D'].includes(choice)) {
        return json(400, { error: 'voterId と choice(A-D) が必要' });
      }
      const { blobs, store } = await loadStore();
      const qid = questionId || store.activeQuestionId;
      if (!qid || !store.questions.some((q) => q.id === qid)) {
        return json(400, { error: '表示中の問題がありません' });
      }
      if (qid !== store.activeQuestionId) {
        return json(409, { error: '問題が切り替わりました。再読み込みしてください' });
      }
      store.answers[qid] = store.answers[qid] || {};
      store.answers[qid][String(voterId)] = choice;
      await saveStore(blobs, store);
      return json(200, { ok: true, tally: tally(store, qid) });
    }

    if (method === 'GET' && path === '/admin/questions') {
      const { store } = await loadStore();
      return json(200, {
        activeQuestionId: store.activeQuestionId,
        questions: store.questions,
      });
    }

    if (method === 'POST' && path === '/admin/questions') {
      const body = parseBody(event);
      const { text, choices, correct } = body;
      if (!text || !choices || !choices.A || !choices.B || !choices.C || !choices.D) {
        return json(400, { error: 'text と choices A-D が必要' });
      }
      const { blobs, store } = await loadStore();
      const q = {
        id: randomUUID(),
        text: String(text).trim(),
        choices: {
          A: String(choices.A).trim(),
          B: String(choices.B).trim(),
          C: String(choices.C).trim(),
          D: String(choices.D).trim(),
        },
        correct: ['A', 'B', 'C', 'D'].includes(correct) ? correct : null,
        createdAt: new Date().toISOString(),
      };
      store.questions.push(q);
      store.answers[q.id] = {};
      if (!store.activeQuestionId) store.activeQuestionId = q.id;
      await saveStore(blobs, store);
      return json(200, { ok: true, question: q });
    }

    if (method === 'POST' && path === '/admin/active') {
      const { questionId } = parseBody(event);
      const { blobs, store } = await loadStore();
      if (!store.questions.some((q) => q.id === questionId)) {
        return json(404, { error: 'question not found' });
      }
      store.activeQuestionId = questionId;
      await saveStore(blobs, store);
      return json(200, { ok: true, activeQuestionId: questionId });
    }

    if (method === 'POST' && path === '/admin/reset-answers') {
      const { questionId } = parseBody(event);
      const { blobs, store } = await loadStore();
      const id = questionId || store.activeQuestionId;
      if (!id) return json(400, { error: 'no question' });
      store.answers[id] = {};
      await saveStore(blobs, store);
      return json(200, { ok: true });
    }

    return json(404, { error: `not found: ${method} ${path}` });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || String(err) });
  }
}
