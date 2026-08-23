export const modmailTerminalPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark light">
  <title>Mae · Reddit Modmail</title>
  <style>
    :root { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color-scheme: dark light; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; background: Canvas; color: CanvasText; }
    header { padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
    h1 { margin: 0; font-size: 1rem; }
    #meta { margin-top: 7px; opacity: .72; font-size: .78rem; white-space: pre-wrap; }
    #messages { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .message { max-width: 86%; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 10px; }
    .participant { align-self: flex-start; }
    .moderator { align-self: flex-end; }
    .internal { align-self: center; max-width: 94%; border-style: dashed; opacity: .82; }
    .who { font-weight: 700; font-size: .75rem; margin-bottom: 6px; }
    .body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.35; }
    .time { margin-top: 7px; opacity: .55; font-size: .68rem; }
    footer { border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 12px; }
    textarea { width: 100%; min-height: 86px; resize: vertical; padding: 10px; font: inherit; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
    .actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    button { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); cursor: pointer; }
    #send { font-weight: 700; }
    #status { flex: 1; min-width: 0; opacity: .72; font-size: .75rem; }
    button:disabled, textarea:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body>
  <header>
    <h1>Mae · Reddit Modmail</h1>
    <div id="meta">Opening conversation…</div>
  </header>
  <main id="messages" aria-live="polite"></main>
  <footer>
    <textarea id="composer" maxlength="10000" placeholder="Reply to the Reddit user"></textarea>
    <div class="actions">
      <button id="send" type="button">Send to Reddit</button>
      <button id="close" type="button">Close terminal</button>
      <span id="status"></span>
    </div>
  </footer>
<script>
(() => {
  'use strict';
  const base = location.pathname.replace(/\/$/, '');
  const preview = base.endsWith('/preview');
  const meta = document.getElementById('meta');
  const messages = document.getElementById('messages');
  const composer = document.getElementById('composer');
  const send = document.getElementById('send');
  const close = document.getElementById('close');
  const status = document.getElementById('status');
  let lastSignature = '';
  let moderator = null;
  let closed = false;
  let events = null;

  const setEnabled = enabled => {
    composer.disabled = !enabled;
    send.disabled = !enabled;
  };

  const roleFor = (message, participant) => {
    if (message.isInternal) return 'internal';
    const author = (message.author && message.author.name || '').toLowerCase();
    return participant && author === participant.toLowerCase() ? 'participant' : 'moderator';
  };

  const render = payload => {
    const conversation = payload.conversation;
    moderator = payload.moderator;
    if (!conversation) return;
    const participant = conversation.participant && conversation.participant.name || '[deleted]';
    meta.textContent = 'u/' + participant + ' · r/' + conversation.subreddit + '\n' + (conversation.subject || '(no subject)') + '\nReplying as ' + moderator.handle + ' via ' + moderator.platform;
    const signature = JSON.stringify(conversation.messages.map(message => [message.id, message.bodyMarkdown, message.isInternal]));
    if (signature !== lastSignature) {
      lastSignature = signature;
      messages.replaceChildren();
      for (const message of conversation.messages) {
        const box = document.createElement('article');
        const role = roleFor(message, participant);
        box.className = 'message ' + role;
        const who = document.createElement('div');
        who.className = 'who';
        const name = message.author && message.author.name || '[deleted]';
        who.textContent = message.isInternal ? 'Internal moderator note · ' + name : name;
        const body = document.createElement('div');
        body.className = 'body';
        body.textContent = message.bodyMarkdown || '';
        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = message.createdAt > 0 ? new Date(message.createdAt * 1000).toLocaleString() : '';
        box.append(who, body, time);
        messages.append(box);
      }
      messages.scrollTop = messages.scrollHeight;
    }
    if (conversation.state === 'archived') {
      closed = true;
      setEnabled(false);
      status.textContent = 'This Reddit conversation is archived.';
    } else if (!closed) {
      setEnabled(true);
    }
  };

  if (preview) {
    const now = Math.floor(Date.now() / 1000);
    render({
      moderator: { handle: '@MaeModerator', platform: 'preview' },
      conversation: {
        participant: { name: 'ExampleUser' },
        subreddit: 'catgirlcoin',
        subject: 'Example Modmail conversation · synthetic preview',
        state: 'inprogress',
        messages: [
          {
            id: 'preview-1',
            author: { name: 'ExampleUser' },
            bodyMarkdown: 'Hi! I have a question about the community rules and my account flair.',
            createdAt: now - 240,
            isInternal: false
          },
          {
            id: 'preview-2',
            author: { name: 'MaeModerator' },
            bodyMarkdown: 'Thanks for getting in touch. A moderator is reviewing this with you.',
            createdAt: now - 150,
            isInternal: false
          },
          {
            id: 'preview-3',
            author: { name: 'Mae' },
            bodyMarkdown: 'Synthetic internal note shown only to staff.',
            createdAt: now - 60,
            isInternal: true
          }
        ]
      }
    });
    closed = true;
    setEnabled(false);
    composer.placeholder = 'Preview only · replies are disabled';
    send.textContent = 'Preview only';
    close.textContent = 'Leave preview';
    status.textContent = 'Synthetic read-only preview. Nothing here can reach Reddit.';
  } else {
    events = new EventSource(base + '/stream');
    events.onmessage = event => {
      try { render(JSON.parse(event.data)); }
      catch { status.textContent = 'Could not read a conversation update.'; }
    };
    events.addEventListener('closed', () => {
      closed = true;
      setEnabled(false);
      status.textContent = 'This temporary terminal has closed.';
      events.close();
    });
    events.onerror = () => {
      if (!closed) status.textContent = 'Connection interrupted; reconnecting…';
    };

    send.addEventListener('click', async () => {
      const text = composer.value.trim();
      if (!text || closed) return;
      send.disabled = true;
      status.textContent = 'Queueing reply…';
      const requestId = crypto.randomUUID();
      try {
        const response = await fetch(base + '/reply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId, text })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        composer.value = '';
        status.textContent = 'Reply queued for Reddit.';
      } catch {
        status.textContent = 'Reply was not queued. Your text has been kept.';
      } finally {
        if (!closed) send.disabled = false;
      }
    });
  }

  close.addEventListener('click', async () => {
    if (preview) {
      if (history.length > 1) history.back();
      else window.close();
      return;
    }
    if (closed) return;
    closed = true;
    setEnabled(false);
    await fetch(base + '/close', { method: 'POST' }).catch(() => undefined);
    if (events !== null) events.close();
    status.textContent = 'Terminal access closed. You can close this window.';
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.close === 'function') {
      window.Telegram.WebApp.close();
    }
  });
})();
</script>
</body>
</html>`;
