// Share the score from the game-over modal: social links, the native share
// sheet (when available) and copy-to-clipboard.

const PLATFORMS = {
  // Not wa.me: its redirect mangles emoji into "\uFFFD".
  whatsapp: ({ text, url }) => `https://api.whatsapp.com/send?text=${encodeURIComponent(`${text} ${url}`)}`,
  x: ({ text, url }) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  facebook: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  telegram: ({ text, url }) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
};

/** Canonical URL, so links shared from localhost/previews still point to the site. */
const shareUrl = () => document.querySelector('link[rel="canonical"]')?.href
  || `${location.origin}${location.pathname}`;

const shareText = (score) =>
  `Fiz ${score} pontos em Run! Flavinho! Run! \u{1F440} Consegue me superar?`;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wire up the share buttons inside `root`.
 * @returns {{ setScore(score: number): void }}
 */
export function initShare(root) {
  const status = root.querySelector('.share-status');
  const nativeBtn = root.querySelector('[data-share="native"]');
  let payload = { text: '', url: shareUrl() };
  let statusTimer = 0;

  const flash = (msg) => {
    status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  };

  nativeBtn.hidden = typeof navigator.share !== 'function';

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-share]');
    if (!btn) return;
    const kind = btn.dataset.share;
    if (kind === 'native') {
      try { await navigator.share({ title: document.title, ...payload }); } catch { /* cancelled */ }
    } else if (kind === 'copy') {
      flash(await copy(`${payload.text} ${payload.url}`) ? 'Copiado!' : 'Não foi possível copiar.');
    } else if (PLATFORMS[kind]) {
      window.open(PLATFORMS[kind](payload), '_blank', 'noopener,noreferrer');
    }
  });

  return {
    setScore(score) {
      payload = { text: shareText(score), url: shareUrl() };
      status.textContent = '';
    },
  };
}
