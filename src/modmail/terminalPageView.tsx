import { render2Mkup } from '@kittycrypto/website/static-ui';
import { modmailBubbleStyles } from './web/bubbles.ts';
import { modmailTerminalRuntime } from './web/runtime.ts';
import { modmailTerminalStyles } from './web/styles.ts';
import { modmailTerminalThemeBoot, modmailTerminalThemeRuntime } from './web/theme.ts';

const documentMarkup = render2Mkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta
        name="viewport"
        content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"
      />
      <meta name="color-scheme" content="dark light" />
      <meta name="theme-color" content="#f7f5fb" />
      <title>Mae · Reddit Modmail</title>
      <style dangerouslySetInnerHTML={{ __html: `${modmailTerminalStyles}\n${modmailBubbleStyles}` }} />
      <script dangerouslySetInnerHTML={{ __html: modmailTerminalThemeBoot }} />
    </head>
    <body>
      <main className="terminal-shell">
        <header className="card terminal-header">
          <div className="header-row">
            <div className="brand-copy">
              <p className="eyebrow">Mae moderation</p>
              <h1>Reddit Modmail</h1>
            </div>
            <div className="header-actions">
              <span id="mode-badge" className="mode-badge" data-mode="preview">Opening</span>
              <button className="theme-toggle" type="button" data-theme-toggle aria-label="Toggle colour theme">
                <span className="theme-toggle__icon" data-theme-label aria-hidden="true">☀️</span>
              </button>
            </div>
          </div>

          <div className="conversation-summary" aria-label="Conversation details">
            <div className="summary-item">
              <span>User</span>
              <strong id="participant">Opening…</strong>
            </div>
            <div className="summary-item">
              <span>Community</span>
              <strong id="subreddit">Opening…</strong>
            </div>
            <div className="summary-item">
              <span>Replying as</span>
              <strong id="identity">Opening…</strong>
            </div>
          </div>
          <p id="subject" className="subject">Opening conversation…</p>
        </header>

        <section className="card conversation-card" aria-label="Modmail conversation">
          <div className="conversation-toolbar">
            <strong>Conversation</strong>
            <span id="connection" className="connection-state" data-state="reconnecting">Connecting…</span>
          </div>
          <div id="messages" className="messages" aria-live="polite" aria-relevant="additions text" />
        </section>

        <footer className="card composer-card">
          <div className="composer-label">
            <span>Moderator reply</span>
            <kbd>Ctrl/⌘ + Enter</kbd>
          </div>
          <textarea
            id="composer"
            maxLength={10000}
            rows={3}
            placeholder="Reply to the Reddit user"
            aria-label="Reply to Reddit user"
          />
          <div className="composer-actions">
            <button id="send" className="action-button primary" type="button">
              <span className="button-copy"><span className="button-title">Send to Reddit</span><small>queue safely</small></span>
            </button>
            <button id="close" className="action-button" type="button">
              <span className="button-copy"><span className="button-title">Close terminal</span><small>revoke link</small></span>
            </button>
          </div>
          <div className="status-row">
            <span id="status" className="status" role="status" aria-live="polite" />
            <span className="preview-note">Synthetic preview</span>
          </div>
        </footer>
      </main>
      <script dangerouslySetInnerHTML={{ __html: `${modmailTerminalThemeRuntime}\n${modmailTerminalRuntime}` }} />
    </body>
  </html>,
);

export const modmailTerminalPage = `<!doctype html>${documentMarkup}`;
