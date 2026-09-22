const KEY_VOTER = 'ken-quiz-voter-id';
const KEY_NAME = 'ken-quiz-display-name';

function voterId() {
  let id = localStorage.getItem(KEY_VOTER);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
    localStorage.setItem(KEY_VOTER, id);
  }
  return id;
}

function savedName() {
  return localStorage.getItem(KEY_NAME) || '';
}

function route() {
  const h = location.hash.replace(/^#\/?/, '') || '';
  if (h.startsWith('admin')) return 'admin';
  if (h.startsWith('play')) return 'play';
  return 'host';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function renderTally(tallyObj, total, choices) {
  const keys = ['A', 'B', 'C', 'D'];
  const cls = { A: '', B: 'b', C: 'c', D: 'd' };
  return keys
    .map((k) => {
      const n = (tallyObj && tallyObj[k]) || 0;
      const p = pct(n, total);
      const label = choices && choices[k] ? `${k}. ${escapeHtml(choices[k])}` : k;
      return `<div class="tally-row"><span class="tally-label">${label}</span><div class="bar-track"><div class="bar-fill ${cls[k]}" style="width:${p}%"></div></div><span>${n}</span></div>`;
    })
    .join('');
}

function renderMarquee(photos) {
  const list = photos || [];
  if (!list.length) {
    return `<div class="marquee-wrap marquee-empty"><div class="marquee-placeholder">写真を登録するとここに流れます</div></div>`;
  }
  const imgs = list
    .map(
      (p) =>
        `<div class="marquee-item"><img src="${escapeHtml(p.src)}" alt="" loading="lazy" /></div>`
    )
    .join('');
  const track = imgs + imgs;
  return `<div class="marquee-wrap" aria-hidden="true"><div class="marquee-track">${track}</div></div>`;
}

function spawnConfetti(container) {
  const colors = ['#c9a227', '#e53935', '#fff6e8', '#f3e2a0', '#ff8a65', '#ffd54f'];
  for (let i = 0; i < 48; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = Math.random() * 0.8 + 's';
    piece.style.animationDuration = 2.2 + Math.random() * 1.8 + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(piece);
  }
}

function ensureRevealOverlay(data) {
  let overlay = document.getElementById('reveal-overlay');
  const reveal = data && data.reveal;
  if (!reveal) {
    if (overlay) overlay.remove();
    return;
  }
  const correct = reveal.correct || '?';
  const winners = reveal.winners || [];
  const choiceText =
    data.question && data.question.choices && data.question.choices[correct]
      ? data.question.choices[correct]
      : '';
  const winnersHtml = winners.length
    ? winners.map((n) => `<span class="winner-chip">${escapeHtml(n)}</span>`).join('')
    : '<p class="muted" style="color:#fff8e7">正解者はまだいません</p>';

  if (!overlay) {
    overlay = el('<div id="reveal-overlay" class="reveal-overlay"></div>');
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="reveal-card">
      <div class="reveal-label">正解発表</div>
      <div class="reveal-answer">正解は <span>${escapeHtml(correct)}</span>！</div>
      ${choiceText ? `<div class="reveal-choice">${escapeHtml(choiceText)}</div>` : ''}
      <div class="reveal-winners-label">当たった人</div>
      <div class="winner-list">${winnersHtml}</div>
    </div>
    <div class="confetti-layer" id="confetti-layer"></div>
  `;
  const layer = overlay.querySelector('#confetti-layer');
  if (layer && !layer.dataset.spawned) {
    layer.dataset.spawned = '1';
    spawnConfetti(layer);
  }
}

function compressImageFile(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像を開けませんでした'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const q = type === 'image/png' ? undefined : quality;
        resolve(canvas.toDataURL(type, q));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let state = null;
let pollTimer = null;
let lastRevealKey = '';

function connectStream(onState) {
  if (pollTimer) clearInterval(pollTimer);
  const tick = async () => {
    try {
      const data = await api('/api/state');
      state = data;
      onState(data);
    } catch (e) {}
  };
  tick();
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
      <div class="admin-q-row">
        <span class="admin-q-text">${q.active ? '▶ ' : ''}${escapeHtml((q.text || '').slice(0, 40))}${(q.text || '').length > 40 ? '…' : ''}${q.hasCorrect ? '' : ' <em class="muted">(正解なし)</em>'}</span>
        <button type="button" class="btn-ghost" data-active="${q.id}">${q.active ? '表示中' : 'これを出す'}</button>
        <button type="button" class="btn-danger-ghost" data-del="${q.id}">削除</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('button[data-active]').forEach((btn) => {
    btn.onclick = async () => {
      await api('/api/admin/active', {
        method: 'POST',
        body: JSON.stringify({ questionId: btn.dataset.active }),
      });
      if (msgEl) msgEl.textContent = '表示を切り替えました';
    };
  });
  list.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('この問題を削除しますか？')) return;
      try {
        await api('/api/admin/questions/delete', {
          method: 'POST',
          body: JSON.stringify({ questionId: btn.dataset.del }),
        });
        if (msgEl) msgEl.textContent = '問題を削除しました';
      } catch (e) {
        if (msgEl) msgEl.textContent = e.message || String(e);
      }
    };
  });
}

function paintPhotoStrip(strip, photos, msgEl) {
  photos = photos || [];
  if (!strip) return;
  if (!photos.length) {
    strip.innerHTML = '<p class="muted">まだ写真がありません</p>';
    return;
  }
  strip.innerHTML = photos
    .map(
      (p) => `
      <div class="photo-thumb">
        <img src="${escapeHtml(p.src)}" alt="" />
        <button type="button" data-photo-del="${p.id}" title="削除">×</button>
      </div>`
    )
    .join('');
  strip.querySelectorAll('button[data-photo-del]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api('/api/admin/photos/delete', {
          method: 'POST',
          body: JSON.stringify({ photoId: btn.dataset.photoDel }),
        });
        if (msgEl) msgEl.textContent = '写真を削除しました';
      } catch (e) {
        if (msgEl) msgEl.textContent = e.message || String(e);
      }
    };
  });
}

function hostView(root, data) {
  const q = data.question;
  const playUrl = `${location.origin}${location.pathname}#/play`;
  root.innerHTML = '';
  const wrap = el('<div></div>');
  wrap.innerHTML = `
    ${renderMarquee(data.photos)}
    <div class="card title-card">
      <div class="chip">還暦お祝い · なぞなぞタイム</div>
      <h1 class="page-title">KENのなぞなぞパーティー</h1>
      <p class="page-sub">スマホで答えて、みんなで盛り上がろう。</p>
    </div>
    <div class="card">
      <a class="btn btn-primary" href="#/play">回答する</a>
      <div class="qr-hint">スマホ用リンク<br/>${escapeHtml(playUrl)}</div>
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
  const tallyEl = document.getElementById('tally');
  if (!q) {
    qtext.textContent = '（まだ問題が選ばれていません）';
    qchoices.textContent = '';
  } else {
    qtext.textContent = q.text;
    qchoices.innerHTML = ['A', 'B', 'C', 'D']
      .map((k) => `<div>${k}. ${escapeHtml(q.choices[k])}</div>`)
      .join('');
  }
  tallyEl.innerHTML = renderTally(data.tally || {}, data.totalAnswers || 0, q && q.choices);
  ensureRevealOverlay(data);
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
    ensureRevealOverlay(data);
    return;
  }
  const key = `ken-answered-${q.id}`;
  const already = localStorage.getItem(key);
  const nameVal = escapeHtml(savedName());
  wrap.innerHTML = `
    <div class="card title-card">
      <div class="chip">あなたの回答</div>
      <h1 class="page-title">回答する</h1>
      <p class="page-sub">名前を入れて、4つのなかからひとつ選んでね。</p>
    </div>
    <div class="card">
      <label for="player-name">お名前（必須・1〜20文字）</label>
      <input id="player-name" maxlength="20" placeholder="例：たろう" value="${nameVal}" autocomplete="nickname" />
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
  const nameInput = document.getElementById('player-name');
  const box = document.getElementById('choices');
  const status = document.getElementById('status');
  if (already) status.textContent = `回答済み：${already}（同じ問題は上書きできます）`;

  const syncDisabled = () => {
    const ok = nameInput.value.trim().length >= 1;
    box.querySelectorAll('.btn-choice').forEach((b) => {
      b.disabled = !ok;
    });
  };

  for (const k of ['A', 'B', 'C', 'D']) {
    const b = el(
      `<button type="button" class="btn btn-choice${already === k ? ' selected' : ''}">${k}. ${escapeHtml(q.choices[k])}</button>`
    );
    b.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        status.textContent = '名前を入力してください';
        nameInput.focus();
        return;
      }
      try {
        status.textContent = '送信中…';
        await api('/api/answer', {
          method: 'POST',
          body: JSON.stringify({
            voterId: voterId(),
            choice: k,
            questionId: q.id,
            name,
          }),
        });
        localStorage.setItem(KEY_NAME, name);
        localStorage.setItem(key, k);
        status.textContent = `受け付けました → ${k}（${name}）`;
        [...box.querySelectorAll('.btn-choice')].forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      } catch (e) {
        status.textContent = e.message || String(e);
      }
    };
    box.appendChild(b);
  }
  nameInput.addEventListener('input', syncDisabled);
  syncDisabled();
  ensureRevealOverlay(data);
}

function adminView(root, data) {
  root.innerHTML = '';
  const wrap = el('<div></div>');
  wrap.innerHTML = `
    <div class="card">
      <div class="chip">管理</div>
      <h1 class="page-title" style="font-size:1.25rem;margin:0 0 12px">問題を登録</h1>
      <label>問題文</label>
      <textarea id="text" rows="3" placeholder="なぞなぞの本文"></textarea>
      <label>A</label><input id="A" />
      <label>B</label><input id="B" />
      <label>C</label><input id="C" />
      <label>D</label><input id="D" />
      <label>正解（発表に必要）</label>
      <select id="correct"><option value="">なし</option><option>A</option><option>B</option><option>C</option><option>D</option></select>
      <button type="button" class="btn btn-primary" id="save">登録する</button>
      <p class="muted" id="msg"></p>
    </div>
    <div class="card">
      <div class="question-label">表示する問題</div>
      <div id="list"></div>
      <div class="admin-actions">
        <button type="button" class="btn btn-gold" id="reveal-btn">正解を発表！</button>
        <button type="button" class="btn" id="hide-reveal-btn">発表を閉じる</button>
        <button type="button" class="btn" id="reset">いまの問題の回答をリセット</button>
      </div>
    </div>
    <div class="card">
      <div class="question-label">パーティー写真（マーキー）</div>
      <p class="muted">JPEG / PNG / WebP。自動で縮小・圧縮します（最大20枚）</p>
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple />
      <div id="photo-strip" class="photo-strip"></div>
    </div>
    <a class="btn" href="#/">ホスト画面へ</a>
  `;
  root.appendChild(wrap);
  const list = document.getElementById('list');
  const msg = document.getElementById('msg');
  const strip = document.getElementById('photo-strip');
  paintAdminList(list, data.questionsMeta, msg);
  paintPhotoStrip(strip, data.photos, msg);

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

  document.getElementById('reveal-btn').onclick = async () => {
    try {
      await api('/api/admin/reveal', { method: 'POST', body: '{}' });
      msg.textContent = '正解を発表しました';
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  };

  document.getElementById('hide-reveal-btn').onclick = async () => {
    try {
      await api('/api/admin/hide-reveal', { method: 'POST', body: '{}' });
      msg.textContent = '発表を閉じました';
      ensureRevealOverlay({ reveal: null });
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
  };

  document.getElementById('photo-input').onchange = async (ev) => {
    const files = [...(ev.target.files || [])];
    if (!files.length) return;
    msg.textContent = '写真をアップロード中…';
    try {
      for (const file of files) {
        const src = await compressImageFile(file, 1200, 0.7);
        await api('/api/admin/photos', {
          method: 'POST',
          body: JSON.stringify({ src }),
        });
      }
      msg.textContent = `${files.length}枚アップロードしました`;
    } catch (e) {
      msg.textContent = e.message || String(e);
    }
    ev.target.value = '';
  };

  ensureRevealOverlay(data);
}

function render(data) {
  const root = document.getElementById('app');
  const r = route();
  if (r === 'admin') adminView(root, data);
  else if (r === 'play') playView(root, data);
  else hostView(root, data);
}

function patchLive(data) {
  const r = route();
  ensureRevealOverlay(data);
  if (r === 'admin') {
    const list = document.getElementById('list');
    const msg = document.getElementById('msg');
    const strip = document.getElementById('photo-strip');
    if (list) paintAdminList(list, data.questionsMeta, msg);
    if (strip) paintPhotoStrip(strip, data.photos, msg);
    return;
  }
  if (r === 'host') {
    const q = data.question;
    const qtext = document.getElementById('qtext');
    const qchoices = document.getElementById('qchoices');
    const tallyEl = document.getElementById('tally');
    const label = document.querySelector('.question-label');
    if (tallyEl) {
      tallyEl.innerHTML = renderTally(data.tally || {}, data.totalAnswers || 0, q && q.choices);
    }
    const liveLabels = document.querySelectorAll('.card .question-label');
    liveLabels.forEach((node) => {
      if (node.textContent && node.textContent.indexOf('LIVE') === 0) {
        node.textContent = `LIVE RESULTS · ${data.totalAnswers || 0}人`;
      }
    });
    if (qtext && q) {
      if (qtext.textContent !== q.text) {
        render(data);
        return;
      }
    } else if (qtext && !q) {
      qtext.textContent = '（まだ問題が選ばれていません）';
      if (qchoices) qchoices.textContent = '';
    }
    void label;
    return;
  }
}

async function boot() {
  try {
    state = await api('/api/state');
  } catch {
    state = { question: null, tally: {}, totalAnswers: 0, questionsMeta: [], photos: [], reveal: null };
  }
  render(state);
  connectStream((data) => {
    const prev = state;
    state = data;
    const r = route();
    const revealKey = data.reveal
      ? `${data.reveal.questionId}:${data.reveal.at}:${(data.reveal.winners || []).join(',')}`
      : '';
    if (revealKey !== lastRevealKey) {
      lastRevealKey = revealKey;
      ensureRevealOverlay(data);
    }
    if (r === 'admin') {
      patchLive(data);
      return;
    }
    if (r === 'play') {
      if (prev && data.question && prev.question && prev.question.id === data.question.id) {
        ensureRevealOverlay(data);
        return;
      }
      render(data);
      return;
    }
    if (
      prev &&
      prev.question &&
      data.question &&
      prev.question.id === data.question.id &&
      (prev.photos || []).length === (data.photos || []).length
    ) {
      patchLive(data);
      return;
    }
    render(data);
  });
}

window.addEventListener('hashchange', () => {
  if (state) render(state);
});

boot();
