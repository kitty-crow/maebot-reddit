export const modmailTerminalStyles = String.raw`
:root {
  --font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --content: 980px;
  --radius: 22px;
  --radius-small: 13px;
  --touch: 46px;
  color-scheme: light;

  --page: #f7f5fb;
  --surface: rgb(255 255 255 / 92%);
  --surface-strong: #ffffff;
  --surface-soft: #f1edf8;
  --text: #211c2d;
  --muted: #746d81;
  --border: rgb(49 35 70 / 12%);
  --accent: #7550c3;
  --accent-strong: #5f3cac;
  --accent-soft: rgb(117 80 195 / 11%);
  --participant: #ffffff;
  --moderator: linear-gradient(145deg, rgb(117 80 195 / 16%), rgb(78 118 205 / 10%));
  --internal: rgb(196 145 46 / 10%);
  --internal-border: rgb(166 113 20 / 24%);
  --success: #237b58;
  --danger: #b23a55;
  --shadow: 0 18px 55px rgb(56 39 81 / 12%);
  --shadow-soft: 0 8px 24px rgb(56 39 81 / 8%);
  --glow-a: rgb(117 80 195 / 15%);
  --glow-b: rgb(75 145 205 / 10%);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0b12;
  --surface: rgb(24 20 32 / 92%);
  --surface-strong: #1a1622;
  --surface-soft: #131019;
  --text: #f3eff9;
  --muted: #aaa0b8;
  --border: rgb(255 255 255 / 9%);
  --accent: #c3a4ff;
  --accent-strong: #d8c4ff;
  --accent-soft: rgb(195 164 255 / 11%);
  --participant: rgb(255 255 255 / 4%);
  --moderator: linear-gradient(145deg, rgb(168 126 255 / 18%), rgb(79 126 224 / 12%));
  --internal: rgb(221 171 65 / 8%);
  --internal-border: rgb(240 190 80 / 20%);
  --success: #6bd7a4;
  --danger: #ff91a8;
  --shadow: 0 20px 60px rgb(0 0 0 / 28%);
  --shadow-soft: 0 8px 28px rgb(0 0 0 / 20%);
  --glow-a: rgb(121 76 196 / 20%);
  --glow-b: rgb(55 115 185 / 14%);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --page: #0d0b12;
    --surface: rgb(24 20 32 / 92%);
    --surface-strong: #1a1622;
    --surface-soft: #131019;
    --text: #f3eff9;
    --muted: #aaa0b8;
    --border: rgb(255 255 255 / 9%);
    --accent: #c3a4ff;
    --accent-strong: #d8c4ff;
    --accent-soft: rgb(195 164 255 / 11%);
    --participant: rgb(255 255 255 / 4%);
    --moderator: linear-gradient(145deg, rgb(168 126 255 / 18%), rgb(79 126 224 / 12%));
    --internal: rgb(221 171 65 / 8%);
    --internal-border: rgb(240 190 80 / 20%);
    --success: #6bd7a4;
    --danger: #ff91a8;
    --shadow: 0 20px 60px rgb(0 0 0 / 28%);
    --shadow-soft: 0 8px 28px rgb(0 0 0 / 20%);
    --glow-a: rgb(121 76 196 / 20%);
    --glow-b: rgb(55 115 185 / 14%);
  }
}

* {
  box-sizing: border-box;
}

html {
  min-width: 100%;
  min-height: 100%;
  background: var(--page);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  margin: 0;
  min-width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 10% -10%, var(--glow-a), transparent 35rem),
    radial-gradient(circle at 105% 15%, var(--glow-b), transparent 32rem),
    var(--page);
  color: var(--text);
  font-family: var(--font);
  line-height: 1.5;
  text-rendering: optimizeLegibility;
}

button,
textarea {
  font: inherit;
}

button {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

button:focus-visible,
textarea:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 34%, transparent);
  outline-offset: 2px;
}

button:disabled,
textarea:disabled {
  cursor: not-allowed;
  opacity: .52;
}

.terminal-shell {
  width: min(calc(100% - 28px), var(--content));
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  padding:
    max(14px, env(safe-area-inset-top))
    max(0px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(0px, env(safe-area-inset-left));
  display: grid;
  grid-template-rows: auto minmax(280px, 1fr) auto;
  gap: 12px;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.terminal-header {
  padding: 18px 20px;
}

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.brand-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--accent-strong);
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(1.42rem, 2.8vw, 2rem);
  line-height: 1.08;
  letter-spacing: -.025em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.mode-badge,
.connection-state {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--muted);
  font-size: .72rem;
  font-weight: 750;
  white-space: nowrap;
}

.mode-badge::before,
.connection-state::before {
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: currentColor;
  content: "";
  opacity: .75;
}

.mode-badge[data-mode="preview"] {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.mode-badge[data-mode="live"],
.connection-state[data-state="connected"] {
  color: var(--success);
}

.connection-state[data-state="reconnecting"] {
  color: var(--danger);
}

.theme-toggle {
  width: var(--touch);
  height: var(--touch);
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
  transition: transform .16s ease, background .16s ease, border-color .16s ease;
}

.theme-toggle:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: var(--accent-soft);
}

.theme-toggle__icon {
  font-size: 1rem;
  line-height: 1;
}

.conversation-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}

.summary-item {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
  background: var(--surface-soft);
}

.summary-item span {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: .68rem;
  font-weight: 750;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.summary-item strong {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-size: .88rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject {
  margin: 12px 0 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: .94rem;
  font-weight: 650;
}

.conversation-card {
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.conversation-toolbar {
  min-height: 48px;
  padding: 9px 14px 9px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.conversation-toolbar strong {
  font-size: .85rem;
  letter-spacing: .01em;
}

.messages {
  min-height: 250px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  scroll-behavior: smooth;
}

.message {
  width: fit-content;
  max-width: min(82%, 720px);
  padding: 11px 13px 10px;
  border: 1px solid var(--border);
  border-radius: 17px;
  box-shadow: var(--shadow-soft);
}

.message.participant {
  align-self: flex-start;
  border-bottom-left-radius: 5px;
  background: var(--participant);
}

.message.moderator {
  align-self: flex-end;
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
  border-bottom-right-radius: 5px;
  background: var(--moderator);
}

.message.internal {
  align-self: center;
  width: min(92%, 760px);
  max-width: none;
  border-style: dashed;
  border-color: var(--internal-border);
  border-radius: var(--radius-small);
  background: var(--internal);
  box-shadow: none;
}

.message-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}

.who {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: .76rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-label {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: .64rem;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: .94rem;
  line-height: 1.48;
}

.time {
  margin-top: 6px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: .64rem;
}

.empty-state {
  margin: auto;
  padding: 28px 18px;
  color: var(--muted);
  text-align: center;
}

.composer-card {
  padding: 14px;
}

.composer-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 2px 7px;
  color: var(--muted);
  font-size: .76rem;
  font-weight: 700;
}

.composer-label kbd {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--surface-soft);
  color: var(--muted);
  font-family: var(--mono);
  font-size: .64rem;
  font-weight: 600;
}

textarea {
  width: 100%;
  min-height: 92px;
  max-height: 240px;
  resize: none;
  padding: 12px 13px;
  border: 1px solid var(--border);
  border-radius: 15px;
  outline: none;
  background: var(--surface-strong);
  color: var(--text);
  font-size: 16px;
  line-height: 1.45;
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 3%);
}

textarea::placeholder {
  color: var(--muted);
}

textarea:focus {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
}

.composer-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, .48fr);
  gap: 9px;
  margin-top: 9px;
}

.action-button {
  min-height: var(--touch);
  padding: 9px 13px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface-soft);
  color: var(--text);
  cursor: pointer;
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease;
}

.action-button:not(:disabled):hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  box-shadow: var(--shadow-soft);
}

.action-button.primary {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 20%, var(--surface-strong)), color-mix(in srgb, var(--accent) 8%, var(--surface-soft)));
  color: var(--accent-strong);
  font-weight: 800;
}

.action-button .button-copy {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 7px;
}

.action-button small {
  color: var(--muted);
  font-size: .68rem;
  font-weight: 600;
}

.status-row {
  min-height: 22px;
  margin-top: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.status {
  min-width: 0;
  color: var(--muted);
  font-size: .74rem;
  overflow-wrap: anywhere;
}

.preview-note {
  display: none;
  flex: 0 0 auto;
  color: var(--accent-strong);
  font-size: .7rem;
  font-weight: 750;
}

body.preview .preview-note {
  display: inline;
}

@media (max-width: 720px) {
  .terminal-shell {
    width: min(calc(100% - 16px), var(--content));
    gap: 8px;
    padding-top: max(8px, env(safe-area-inset-top));
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }

  .terminal-header {
    padding: 15px;
    border-radius: 18px;
  }

  .conversation-card,
  .composer-card {
    border-radius: 18px;
  }

  .conversation-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-item:last-child {
    grid-column: 1 / -1;
  }

  .messages {
    padding: 13px;
  }

  .message {
    max-width: 88%;
  }
}

@media (max-width: 520px) {
  :root {
    --radius: 17px;
  }

  .terminal-shell {
    width: min(calc(100% - 10px), var(--content));
    grid-template-rows: auto minmax(220px, 1fr) auto;
    gap: 6px;
  }

  .header-row {
    align-items: center;
  }

  .eyebrow {
    font-size: .65rem;
  }

  h1 {
    font-size: 1.3rem;
  }

  .mode-badge {
    display: none;
  }

  .theme-toggle {
    width: 44px;
    height: 44px;
  }

  .conversation-summary {
    margin-top: 12px;
    gap: 6px;
  }

  .summary-item {
    padding: 8px 10px;
  }

  .subject {
    margin-top: 9px;
    font-size: .86rem;
  }

  .conversation-toolbar {
    min-height: 43px;
    padding: 7px 10px 7px 13px;
  }

  .connection-state {
    min-height: 27px;
    padding: 4px 8px;
    font-size: .67rem;
  }

  .messages {
    min-height: 200px;
    padding: 10px;
    gap: 8px;
  }

  .message {
    max-width: 92%;
    padding: 9px 10px 8px;
    border-radius: 14px;
  }

  .message.internal {
    width: 96%;
  }

  .body {
    font-size: .9rem;
  }

  .composer-card {
    padding: 10px;
  }

  .composer-label kbd {
    display: none;
  }

  textarea {
    min-height: 78px;
    padding: 10px 11px;
    border-radius: 12px;
  }

  .composer-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin-top: 7px;
  }

  .action-button {
    min-width: 0;
    padding-inline: 8px;
  }

  .action-button small {
    display: none;
  }

  .status-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
    margin-top: 7px;
  }
}

@media (max-width: 350px) {
  .conversation-summary {
    grid-template-columns: 1fr;
  }

  .summary-item:last-child {
    grid-column: auto;
  }

  .composer-actions {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: .001ms !important;
    animation-duration: .001ms !important;
  }
}
`;
