import { getStore } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const MAX_PHOTOS = 20;
const PHOTO_INLINE_MAX = 100 * 1024;

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
  photos: [],
  reveal: null,
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

function answerChoice(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.choice) return val.choice;
  return null;
}

function answerName(val) {
  if (val && typeof val === 'object' && val.name) return String(val.name);
  return null;
}

function tally(store, qid) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const bucket = store.answers[qid] || {};
  for (const val of Object.values(bucket)) {
    const choice = answerChoice(val);
    if (choice && counts[choice] != null) counts[choice] += 1;
  }
  return counts;
}

function normalizeStore(store) {
  if (!Array.isArray(store.photos)) store.photos = [];
  if (!store.answers || typeof store.answers !== 'object') store.answers = {};
  if (store.reveal === undefined) store.reveal = null;
  return store;
}

async function resolvePhotoSrc(blobs, photo) {
  if (!photo) return null;
  if (photo.src) return photo.src;
  if (photo.blobKey) {
    try {
      const data = await blobs.get(photo.blobKey, { type: 'text' });
      return data || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function publicPhotos(blobs, store) {
  const out = [];
  for (const p of store.photos || []) {
    const src = await resolvePhotoSrc(blobs, p);
    if (src) out.push({ id: p.id, src, createdAt: p.createdAt });
  }
  return out;
}

async function publicState(blobs, store) {
  normalizeStore(store);
  const q = store.questions.find((x) => x.id === store.activeQuestionId) || null;
  let reveal = null;
  if (
    store.reveal &&
    store.reveal.questionId &&
    store.reveal.questionId === store.activeQuestionId
  ) {
    reveal = {
      questionId: store.reveal.questionId,
      correct: store.reveal.correct,
      winners: store.reveal.winners || [],
      at: store.reveal.at,
    };
  }
  return {
    activeQuestionId: store.activeQuestionId,
    question: q ? { id: q.id, text: q.text, choices: q.choices } : null,
    tally: q ? tally(store, q.id) : { A: 0, B: 0, C: 0, D: 0 },
    totalAnswers: q ? Object.keys(store.answers[q.id] || {}).length : 0,
    questionsMeta: store.questions.map((x) => ({
      id: x.id,
      text: x.text,
      active: x.id === store.activeQuestionId,
      hasCorrect: !!x.correct,
    })),
    photos: await publicPhotos(blobs, store),
    reveal,
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
  if (raw && Array.isArray(raw.questions)) {
    return { blobs, store: normalizeStore(raw) };
  }
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

function normalizeName(name) {
  const n = String(name == null ? '' : name).trim();
  if (n.length < 1 || n.length > 20) return null;
  return n;
}

function isDataUrlImage(src) {
  return (
    typeof src === 'string' &&
    /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(src)
  );
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  const path = parsePath(event);
  const method = event.httpMethod || 'GET';

  try {
    if (method === 'GET' && (path === '/' || path === '/state')) {
      const { blobs, store } = await loadStore();
      return json(200, await publicState(blobs, store));
    }

    if (method === 'POST' && path === '/answer') {
      const body = parseBody(event);
      const { voterId, choice, questionId } = body;
      const name = normalizeName(body.name);
      if (!voterId || !['A', 'B', 'C', 'D'].includes(choice)) {
        return json(400, { error: 'voterId と choice(A-D) が必要' });
      }
      if (!name) {
        return json(400, { error: '名前は1〜20文字で入力してください' });
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
      store.answers[qid][String(voterId)] = {
        choice,
        name,
        at: new Date().toISOString(),
      };
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

    if (method === 'POST' && path === '/admin/questions/delete') {
      const { questionId } = parseBody(event);
      if (!questionId) return json(400, { error: 'questionId が必要' });
      const { blobs, store } = await loadStore();
      const idx = store.questions.findIndex((q) => q.id === questionId);
      if (idx < 0) return json(404, { error: 'question not found' });
      store.questions.splice(idx, 1);
      delete store.answers[questionId];
      if (store.reveal && store.reveal.questionId === questionId) {
        store.reveal = null;
      }
      if (store.activeQuestionId === questionId) {
        store.activeQuestionId = store.questions[0] ? store.questions[0].id : null;
      }
      await saveStore(blobs, store);
      return json(200, { ok: true, activeQuestionId: store.activeQuestionId });
    }

    if (method === 'POST' && path === '/admin/active') {
      const { questionId } = parseBody(event);
      const { blobs, store } = await loadStore();
      if (!store.questions.some((q) => q.id === questionId)) {
        return json(404, { error: 'question not found' });
      }
      store.activeQuestionId = questionId;
      if (store.reveal && store.reveal.questionId !== questionId) {
        store.reveal = null;
      }
      await saveStore(blobs, store);
      return json(200, { ok: true, activeQuestionId: questionId });
    }

    if (method === 'POST' && path === '/admin/reset-answers') {
      const { questionId } = parseBody(event);
      const { blobs, store } = await loadStore();
      const id = questionId || store.activeQuestionId;
      if (!id) return json(400, { error: 'no question' });
      store.answers[id] = {};
      if (store.reveal && store.reveal.questionId === id) store.reveal = null;
      await saveStore(blobs, store);
      return json(200, { ok: true });
    }

    if (method === 'POST' && path === '/admin/reveal') {
      const { blobs, store } = await loadStore();
      const qid = store.activeQuestionId;
      const q = store.questions.find((x) => x.id === qid);
      if (!q) return json(400, { error: '表示中の問題がありません' });
      if (!q.correct || !['A', 'B', 'C', 'D'].includes(q.correct)) {
        return json(400, { error: 'この問題に正解が設定されていません' });
      }
      const bucket = store.answers[qid] || {};
      const winners = [];
      const seen = new Set();
      for (const val of Object.values(bucket)) {
        if (answerChoice(val) !== q.correct) continue;
        const n = answerName(val);
        if (!n) continue;
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        winners.push(n);
      }
      store.reveal = {
        questionId: qid,
        correct: q.correct,
        winners,
        at: new Date().toISOString(),
      };
      await saveStore(blobs, store);
      return json(200, { ok: true, reveal: store.reveal });
    }

    if (method === 'POST' && path === '/admin/hide-reveal') {
      const { blobs, store } = await loadStore();
      store.reveal = null;
      await saveStore(blobs, store);
      return json(200, { ok: true });
    }

    if (method === 'POST' && path === '/admin/photos') {
      const body = parseBody(event);
      const src = body.src;
      if (!isDataUrlImage(src)) {
        return json(400, { error: 'JPEG/PNG/WebP の画像データURLが必要です' });
      }
      if (src.length > 1_800_000) {
        return json(400, { error: '画像が大きすぎます。圧縮してから再試行してください' });
      }
      const { blobs, store } = await loadStore();
      if ((store.photos || []).length >= MAX_PHOTOS) {
        return json(400, { error: `写真は最大${MAX_PHOTOS}枚までです` });
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      let photo;
      if (src.length > PHOTO_INLINE_MAX) {
        const blobKey = `photo:${id}`;
        await blobs.set(blobKey, src);
        photo = { id, blobKey, createdAt };
      } else {
        photo = { id, src, createdAt };
      }
      store.photos.push(photo);
      await saveStore(blobs, store);
      return json(200, { ok: true, photo: { id, createdAt } });
    }

    if (method === 'POST' && path === '/admin/photos/delete') {
      const { photoId } = parseBody(event);
      if (!photoId) return json(400, { error: 'photoId が必要' });
      const { blobs, store } = await loadStore();
      const idx = (store.photos || []).findIndex((p) => p.id === photoId);
      if (idx < 0) return json(404, { error: 'photo not found' });
      const [removed] = store.photos.splice(idx, 1);
      if (removed && removed.blobKey) {
        try {
          await blobs.delete(removed.blobKey);
        } catch {}
      }
      await saveStore(blobs, store);
      return json(200, { ok: true });
    }

    return json(404, { error: `not found: ${method} ${path}` });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || String(err) });
  }
}
