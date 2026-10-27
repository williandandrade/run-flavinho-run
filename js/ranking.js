// Ranking: reads the static data/ranking.json, submits scores to the
// Cloudflare Worker and shows locally pending submissions until the
// scheduled GitHub Action publishes them. User data is only ever rendered
// with textContent (never innerHTML).

// Set this to your deployed Worker URL (no trailing slash), e.g.
// 'https://run-flavinho-ranking.<your-subdomain>.workers.dev'
export const WORKER_URL = 'https://run-flavinho-ranking.run-flavinho-ranking.workers.dev';

const MAX_NAME = 50;
const TOP = 100;
const PENDING_KEY = 'rfr_pending';
const MINE_KEY = 'rfr_mine';
const PENDING_MAX_AGE = 6 * 60 * 60 * 1000; // drop stale pending entries after 6h

const readStore = (key) => {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
};
const writeStore = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};
const entryKey = (e) => `${e.name}|${e.score}`;

export const cleanName = (s) => String(s).replace(/[\u0000-\u001F\u007F]/g, '').trim();

export async function fetchRanking() {
  const res = await fetch(`data/ranking.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Merge pending local submissions into the official list, pruning published ones. */
export function mergePending(official) {
  const published = new Set(official.map(entryKey));
  const now = Date.now();
  const pending = readStore(PENDING_KEY)
    .filter((p) => !published.has(entryKey(p)) && now - p.ts < PENDING_MAX_AGE);
  writeStore(PENDING_KEY, pending);
  return official
    .map((e) => ({ ...e, pending: false }))
    .concat(pending.map((p) => ({ ...p, pending: true })))
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, TOP);
}

export async function submitScore(name, score) {
  if (!WORKER_URL) return { ok: false, message: 'Ranking indisponível no momento.' };
  try {
    const res = await fetch(`${WORKER_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score }),
    });
    if (res.status === 202) {
      const entry = { name, score, ts: Date.now() };
      writeStore(PENDING_KEY, readStore(PENDING_KEY).concat(entry));
      writeStore(MINE_KEY, readStore(MINE_KEY).concat({ name, score }).slice(-50));
      return { ok: true, message: 'Pontuação enviada!' };
    }
    if (res.status === 429) return { ok: false, message: 'Muitas tentativas. Aguarde um minuto.' };
    return { ok: false, message: 'Não foi possível enviar. Tente novamente.' };
  } catch {
    return { ok: false, message: 'Sem conexão com o servidor do ranking.' };
  }
}

function renderList(listEl, entries) {
  const mine = new Set(readStore(MINE_KEY).map(entryKey));
  listEl.replaceChildren();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nenhuma pontuação ainda.';
    listEl.append(li);
    return;
  }
  entries.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.pending || mine.has(entryKey(e))) li.classList.add('mine');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = `${i + 1}.`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    if (e.pending) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = ' pendente';
      name.append(tag);
    }
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = String(e.score);
    li.append(pos, name, score);
    listEl.append(li);
  });
}

/**
 * Wire up the game-over / ranking modal.
 * @param {{ onReplay(): void, onClose(): void }} handlers
 */
export function initRankingModal({ onReplay, onClose }) {
  const $ = (id) => document.getElementById(id);
  const modal = $('modal');
  const title = $('modal-title');
  const finalScore = $('final-score');
  const form = $('submit-form');
  const input = $('name');
  const counter = $('name-count');
  const submitBtn = $('btn-submit');
  const status = $('submit-status');
  const list = $('ranking-list');
  const replayBtn = $('btn-replay');
  const closeBtn = $('btn-close');
  let currentScore = 0;

  const updateCounter = () => {
    counter.textContent = `${cleanName(input.value).length}/${MAX_NAME}`;
  };
  input.addEventListener('input', updateCounter);

  async function refresh() {
    try {
      renderList(list, mergePending(await fetchRanking()));
    } catch {
      renderList(list, mergePending([]));
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Não foi possível carregar o ranking.';
      list.prepend(li);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name) { status.textContent = 'Digite seu nome.'; return; }
    if (name.length > MAX_NAME) { status.textContent = `Máximo de ${MAX_NAME} caracteres.`; return; }
    submitBtn.disabled = true;
    status.textContent = 'Enviando...';
    const res = await submitScore(name, currentScore);
    status.textContent = res.message;
    if (res.ok) {
      input.disabled = true;
      await refresh();
    } else {
      submitBtn.disabled = false;
    }
  });

  replayBtn.addEventListener('click', () => { close(); onReplay(); });
  closeBtn.addEventListener('click', () => { close(); onClose(); });

  function open({ score = 0, readOnly = false } = {}) {
    currentScore = Math.floor(score);
    title.textContent = readOnly ? 'RANKING FINAL' : 'PEGO!';
    finalScore.textContent = `PONTOS: ${String(currentScore).padStart(6, '0')}`;
    finalScore.hidden = readOnly;
    form.hidden = readOnly || currentScore <= 0;
    replayBtn.hidden = readOnly;
    closeBtn.hidden = !readOnly;
    input.disabled = false;
    submitBtn.disabled = false;
    status.textContent = '';
    updateCounter();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    (readOnly ? closeBtn : replayBtn).focus({ preventScroll: true });
    refresh();
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /** Switch an open modal to read-only (countdown expired while it was open). */
  function lockReadOnly() {
    if (modal.hidden) return;
    form.hidden = true;
    replayBtn.hidden = true;
    closeBtn.hidden = false;
  }

  return { open, close, lockReadOnly, isOpen: () => !modal.hidden };
}
