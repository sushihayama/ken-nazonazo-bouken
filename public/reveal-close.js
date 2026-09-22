(() => {
  let busy = false;

  function addCloseButton() {
    const card = document.querySelector('#reveal-overlay .reveal-card');
    if (!card || card.querySelector('#reveal-close')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'reveal-close';
    button.className = 'btn reveal-close';
    button.textContent = '閉じる';
    button.setAttribute('aria-label', '正解発表を閉じる');
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      button.textContent = '閉じています…';
      const overlay = document.getElementById('reveal-overlay');
      if (overlay) overlay.remove();
      try {
        const res = await fetch('/api/admin/hide-reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '発表を閉じられませんでした');
        }
      } catch (error) {
        busy = false;
        alert(error.message || String(error));
        location.reload();
      }
    });
    card.appendChild(button);
  }

  const observer = new MutationObserver(addCloseButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addCloseButton();
})();
