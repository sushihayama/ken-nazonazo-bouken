const KEY_VOTER = 'ken-quiz-voter-id';

function voterId() {
  let id = localStorage.getItem(KEY_VOTER);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
    localStorage.setItem(KEY_VOTER, id);
  }
  return id;
}

function route() {
  const h = location.hash.replace(/^#\/?/, '') || '';
  if (h.startsWith('admin')) return 'admin';
  if (h.startsWith('play')) return 'play';
  return 'host';
}

function kenBadge() {
  return `<div class="badge" aria-hidden="true">還<small>KEN</small></div>`;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function renderTally(tally, total, choices) {
  const keys = ['A', 'B', 'C', 'D'];
  const cls = { A: '', B: 'b', C: 'c', D: 'd' };
  return keys
    .map((k) => {
      const n = tally[k] || 0;
      const p = pct(n, total);
      const label = choices && choices[k] ? `${k}. ${escapeHtml(choices[k])}` : k;
      return `<div class="tally-row"><span class="tally-label">${label}</span><div class="bar-track"><div class="bar-fill ${cls[k]}" style="width:${p}%"></div></div><span>${n}</span></div>`;
    })
    .join('');
}

let state = null;
let pollTimer = null;

function connectStream(onState) {
  if (pollTimer) clearInterval(pollTimer);
  const tick = async () => {
    try {
      const data = await api('/api/state');
      state = data;
      onState(data);
    } catch (e) {}
  };
  pollTimer = setInterval(tick, 1500);
}

function paintAdminList(list, meta, msgEl) {
  meta = meta || [];
  if (!meta.length) {
    list.innerHTML = '<p class="muted">まだ問題がありません</p>';
    return;
  }
  list.innerHTML = meta
    .map(
      (q) => `
      <div class="row" style="margin:8px 0;justify-content:space-between">
        <span style="flex:1;margin-right:8px">${q.active ? '▶ ' : ''}${escapeHtml(q.text.slice(0, 40))}${q.text.length > 40 ? '…' : ''}</span>
        <button type="button" class="btn-ghost" data-id="${q.id}">${q.active ? '表示中' : 'これを出す'}</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.onclick = async () => {
      await api('/api/admin/active', {
        method: 'POST',
        body: JSON.stringify({ questionId: btn.dataset.id }),
      });
      if (msgEl) msgEl.textContent = '表示を切り替えました';
    };
  });
}

function hostView(root, data) {
  const q = data.question;
  const playUrl = `${location.origin}${location.pathname}#/play`;
  root.innerHTML = '';
  const wrap = el('<div></div>');
  wrap.innerHTML = `
    <div class="card hero">
      ${kenBadge()}
      <div class="hero-text">
        <div class="chip">還暦お祝い · なぞなぞタイム</div>
        <h1>KENのなぞなぞパーティー</h1>
        <p>釣り好きのケンと、ついてきた猫。<br/>スマホで答えて、みんなで盛り上がろう。</p>
      </div>
    </div>
    <div class="card">
      <a class="btn btn-primary" href="#/play">回答する</a>
      <div class="qr-hint">スマホ用リンク<br/>${playUrl}</div>
    </div>
    <div class="card">
      <div class="question-label">QUESTION</div>
      <div class="question-text" id="qtext"></div>
      <div id="qchoices" class="muted" style="margin-top:12px"></div>
    </div>
    <div class="card">
      <div class="question-label">LIVE RESULTS · ${data.totalAnswers || 0}人</div>
      <div id="tally"></div>
    </div>
    <div class="admin-link-wrap"><a class="btn-ghost" href="#/admin">問題を登録</a></div>
    <p class="footer-note">Happy 60th · Congratulations</p>
  `;
  root.appendChild(wrap);
  const qtext = document.getElementById('qtext');
  const qchoices = document.getElementById('qchoices');
  const tally = document.getElementById('tally');
  if (!q) {
    qtext.textContent = '（まだ問題が選ばれていません）';
    qchoices.textContent = '';
  } else {
    qtext.textContent = q.text;
    qchoices.innerHTML = ['A', 'B', 'C', 'D'].map((k) => `<div>${k}. ${q.choices[k]}</div>`).join('');
  }
  tally.innerHTML = renderTally(data.tally || {}, data.totalAnswers || 0, q && q.choices);
}

function playView(root, data) {
  const q = data.question;
  root.innerHTML = '';
  const wrap = el('<div></div>');
  if (!q) {
    wrap.innerHTML = `
      <div class="card"><p>いま答えられる問題がありません。<br/>ホストが問題を選ぶまで、少し待ってね。</p>
      <a class="btn" href="#/">もどる</a></div>`;
    root.appendChild(wrap);
    return;
  }
  const key = `ken-answered-${q.id}`;
  const already = localStorage.getItem(key);
  wrap.innerHTML = `
    <div class="card hero">
      ${kenBadge()}
      <div class="hero-text">
        <div class="chip">あなたの回答</div>
        <h1>回答する</h1>
        <p>4つのなかから、ひとつ選んでね。</p>
      </div>
    </div>
    <div class="card">
      <div class="question-label">QUESTION</div>
      <div class="question-text">${escapeHtml(q.text)}</div>
    </div>
    <div class="card" id="choices"></div>
    <div class="card muted" id="status"></div>
    <a class="btn" href="#/">ホスト画面へ</a>
  `;
  root.appendChild(wrap);
  const box = document.getElementById('choices');
  const status = document.getElementById('status');
  if (already) status.textContent = `回答済み：${already}（同じ問題は上書きできます）`;
  for (const k of ['A', 'B', 'C', 'D']) {
    const b = el(
      `<button type="button" class="btn btn-choice${already === k ? ' selected' : ''}">${k}. ${escapeHtml(q.choices[k])}</button>`
    );
    b.onclick = async () => {
      try {
        status.textContent = '送信中…';
        await api('/api/answer', {
          method: 'POST',
          body: JSON.stringify({ voterId: voterId(), choice: k, questionId: q.id }),
        });
        localStorage.setItem(key, k);
        status.textContent = `受け付けました → ${k}`;
        [...box.querySelectorAll('.btn-choice')].forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      } catch (e) {
        status.textContent = e.message || String(e);
      }
    };
    box.appendChild(b);
  }
}

function adminView(root, data) {
  root.innerHTML = '';
  const wrap = el('<div></div>');
  wrap.innerHTML = `
    <div class="card">
      <div class="chip">管理</div>
      <h1 style="font-family:'Shippori Mincho',serif;color:var(--red-deep);font-size:1.25rem;margin:0 0 12px">問題を登録</h1>
      <label>問題文</label>
      <textarea id="text" rows="3" placeholder="なぞなぞの本文"></textarea>
      <label>A</label><input id="A" />
      <label>B</label><input id="B" />
      <label>C</label><input id="C" />
      <label>D</label><input id="D" />
      <label>正解（任意）</label>
      <select id="correct"><option value="">なし</option><option>A</option><option>B</option><option>C</option><option>D</option></select>
      <button type="button" class="btn btn-primary" id="save">登録する</button>
      <p class="muted" id="msg"></p>
    </div>
    <div class="card">
      <div class="question-label">表示する問題</div>
      <div id="list"></div>
      <button type="button" class="btn" id="reset" style="margin-top:10px">いまの問題の回答をリセット</button>
    </div>
    <a class="btn" href="#/">ホスト画面へ</a>
  `;
  root.appendChild(wrap);
  const list = document.getElementById('list');
  const msg = document.getElementById('msg');
  paintAdminList(list, data.questionsMeta, msg);

  document.getElementById('save').onclick = async () => {
    try {
      await api('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify({
          text: document.getElementById('text').value,
          choices: {
            A: document.getElementById('A').value,
            B: document.getElementById('B').value,
            C: document.getElementById('C').value,
            D: document.getElementById('D').value,
          },
          correct: document.getElementById('correct').value || null,
        }),
      });
      msg.textContent = '登録しました';
      document.getElementById('text').value = '';
      ['A', 'B', 'C', 'D'].forEach((k) => (document.getElementById(k).value = ''));
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  };

  document.getElementById('reset').onclick = async () => {
    await api('/api/admin/reset-answers', { method: 'POST', body: '{}' });
    msg.textContent = '回答をリセットしました';
  };
}

function render(data) {
  const root = document.getElementById('app');
  const r = route();
  if (r === 'admin') adminView(root, data);
  else if (r === 'play') playView(root, data);
  else hostView(root, data);
}

async function boot() {
  try {
    state = await api('/api/state');
  } catch {
    state = { question: null, tally: {}, totalAnswers: 0, questionsMeta: [] };
  }
  render(state);
  connectStream((data) => {
    const prev = state;
    state = data;
    const r = route();
    if (r === 'admin') {
      const list = document.getElementById('list');
      const msg = document.getElementById('msg');
      if (list) paintAdminList(list, data.questionsMeta, msg);
      return;
    }
    if (r === 'play' && prev && data.question && prev.question && prev.question.id === data.question.id) {
      return;
    }
    render(data);
  });
}

window.addEventListener('hashchange', () => {
  if (state) render(state);
});

boot();
