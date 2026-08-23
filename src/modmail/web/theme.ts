export const modmailTerminalThemeBoot = String.raw`
(() => {
  const key = 'mae.reddit.modmail.theme';
  try {
    const stored = localStorage.getItem(key);
    const preferred = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = stored === 'light' || stored === 'dark' ? stored : preferred;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0d0b12' : '#f7f5fb';
  } catch {
    // Cosmetic only. CSS still follows the operating-system preference.
  }
})();
`;

export const modmailTerminalThemeRuntime = String.raw`
(() => {
  const key = 'mae.reddit.modmail.theme';
  const root = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  const label = document.querySelector('[data-theme-label]');
  const meta = document.querySelector('meta[name="theme-color"]');
  let current = root.dataset.theme === 'dark' ? 'dark' : 'light';

  const apply = (theme, persist) => {
    current = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = current;
    root.style.colorScheme = current;
    if (meta) meta.content = current === 'dark' ? '#0d0b12' : '#f7f5fb';
    if (label) label.textContent = current === 'dark' ? '🌙' : '☀️';
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(current === 'dark'));
      toggle.setAttribute('aria-label', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      toggle.setAttribute('title', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    if (persist) {
      try { localStorage.setItem(key, current); } catch { /* optional preference */ }
    }
  };

  apply(current, false);
  if (toggle) toggle.addEventListener('click', () => apply(current === 'dark' ? 'light' : 'dark', true));

  try {
    const system = matchMedia('(prefers-color-scheme: dark)');
    system.addEventListener('change', event => {
      let stored = null;
      try { stored = localStorage.getItem(key); } catch { stored = null; }
      if (stored !== 'light' && stored !== 'dark') apply(event.matches ? 'dark' : 'light', false);
    });
  } catch {
    // Theme changes are cosmetic.
  }
})();
`;
