export const modmailTerminalRuntime = String.raw`
(() => {
  'use strict';
  const base = location.pathname.replace(/\/$/, '');
  const preview = base.endsWith('/preview');
  const $ = id => document.getElementById(id);
  const participantEl = $('participant');
  const subredditEl = $('subreddit');
  const identityEl = $('identity');
  const subjectEl = $('subject');
  const modeBadge = $('mode-badge');
  const connection = $('connection');
  const messages = $('messages');
  const composer = $('composer');
  const send = $('send');
  const close = $('close');
  const status = $('status');
  const media = window.__maeModmailMedia || null;
  let lastSignature = '';
  let closed = false;
  let events = null;

  const platformLabel = platform => platform === 'discord'
    ? 'Discord'
    : platform === 'telegram'
      ? 'Telegram'
      : platform === 'preview'
        ? 'Preview'
        : 'Reddit';

  const setConnection = (text, state) => {
    connection.textContent = text;
    connection.dataset.state = state;
  };

  const resizeComposer = () => {
    composer.style.height = 'auto';
    composer.style.height = Math.min(Math.max(composer.scrollHeight, 52), 150) + 'px';
  };

  const hasDraftMedia = () => media !== null && media.hasFiles();

  const refreshSend = () => {
    send.disabled = preview || closed || composer.disabled || (composer.value.trim().length === 0 && !hasDraftMedia());
  };

  const setEnabled = enabled => {
    composer.disabled = !enabled;
    if (media !== null) media.setDisabled(!enabled);
    refreshSend();
  };

  composer.addEventListener('input', () => {
    resizeComposer();
    refreshSend();
  });
  document.addEventListener('mae-modmail-media-change', refreshSend);

  const renderMessages = conversation => {
    const signature = JSON.stringify(conversation.messages.map(message => [
      message.id,
      message.bodyMarkdown,
      message.createdAt,
      message.side,
      message.sender,
      message.origin,
      Array.isArray(message.attachments) ? message.attachments.map(item => [item.id, item.url]) : []
    ]));
    if (signature === lastSignature) return;

    const first = lastSignature.length === 0;
    const fromBottom = Math.max(0, messages.scrollHeight - messages.scrollTop - messages.clientHeight);
    lastSignature = signature;
    messages.replaceChildren();

    if (conversation.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No messages in this conversation yet.';
      messages.append(empty);
      return;
    }

    for (const message of conversation.messages) {
      const wrapper = document.createElement('article');
      wrapper.className = 'message-wrapper ' + message.side;

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble ' + message.side;

      const who = document.createElement('div');
      who.className = 'nickname-strip';
      who.textContent = message.side === 'internal'
        ? 'Internal · ' + message.sender + ' · ' + message.origin
        : message.sender + ' · ' + message.origin;

      const body = document.createElement('div');
      body.className = 'message-text';
      body.textContent = message.bodyMarkdown || '';
      bubble.append(who);
      if (message.bodyMarkdown) bubble.append(body);
      if (media !== null) media.renderMessageAttachments(bubble, message.attachments || []);

      const time = document.createElement('div');
      time.className = 'timestamp';
      time.textContent = message.createdAt > 0 ? new Date(message.createdAt * 1000).toLocaleString() : '';

      wrapper.append(bubble, time);
      messages.append(wrapper);
      requestAnimationFrame(() => wrapper.classList.add('show'));
    }

    requestAnimationFrame(() => {
      if (first || fromBottom < 140) messages.scrollTop = messages.scrollHeight;
      else messages.scrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight - fromBottom);
    });
  };

  const render = payload => {
    const conversation = payload.conversation;
    const moderator = payload.moderator;
    if (!conversation || !moderator) return;
    participantEl.textContent = conversation.participant ? 'u/' + conversation.participant : '[deleted]';
    subredditEl.textContent = 'r/' + conversation.subreddit;
    identityEl.textContent = moderator.handle + ' · ' + platformLabel(moderator.platform);
    subjectEl.textContent = conversation.subject || '(no subject)';
    renderMessages(conversation);

    if (conversation.state === 'archived') {
      closed = true;
      setEnabled(false);
      setConnection('Archived', 'closed');
      status.textContent = 'This Reddit conversation is archived.';
    } else if (!preview && !closed) {
      setEnabled(true);
      setConnection('Connected', 'connected');
    }
  };

  const sendReply = async () => {
    const text = composer.value.trim();
    if ((text.length === 0 && !hasDraftMedia()) || preview || closed) return;
    send.disabled = true;
    try {
      let attachments = [];
      if (hasDraftMedia() && media !== null) {
        status.textContent = 'Uploading media to Reddit…';
        attachments = await media.uploadAll(base);
      }
      status.textContent = 'Queueing reply…';
      const response = await fetch(base + '/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          text,
          attachmentIds: attachments.map(item => item.id)
        })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      composer.value = '';
      if (media !== null) media.clear();
      resizeComposer();
      status.textContent = 'Reply queued for Reddit.';
    } catch {
      status.textContent = 'Reply was not queued. Your text and selected media have been kept.';
    } finally {
      refreshSend();
    }
  };

  send.addEventListener('click', () => void sendReply());
  composer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendReply();
    }
  });

  if (preview) {
    document.body.classList.add('preview');
    modeBadge.textContent = 'Preview';
    modeBadge.dataset.mode = 'preview';
    setConnection('Read-only', 'connected');
    const now = Math.floor(Date.now() / 1000);
    const mockImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"%3E%3Crect width="720" height="360" rx="28" fill="%238d5bd6"/%3E%3Ccircle cx="360" cy="148" r="72" fill="%23f8c5ef"/%3E%3Ctext x="360" y="270" text-anchor="middle" font-family="sans-serif" font-size="32" fill="white"%3EMock Modmail image%3C/text%3E%3C/svg%3E';
    render({
      moderator: { handle: '@MaeModerator', platform: 'preview' },
      conversation: {
        participant: 'ExampleUser',
        subreddit: 'catgirlcoin',
        subject: 'Responsive bubble and long-message visual QA · synthetic preview',
        state: 'inprogress',
        messages: [
          { id: 'p1', side: 'participant', sender: 'u/ExampleUser', origin: 'Reddit', bodyMarkdown: 'Hi! This is a short message so we can check the compact purple bubble.', createdAt: now - 900, attachments: [] },
          { id: 'p2', side: 'participant', sender: 'u/ExampleUser', origin: 'Reddit', bodyMarkdown: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This intentionally longer participant message checks wrapping, readable line length and how the left-side bubble behaves on a narrow phone.', createdAt: now - 830, attachments: [] },
          { id: 'p3', side: 'moderator', sender: 'u/RedditMod', origin: 'Reddit', bodyMarkdown: 'Thanks! This is a direct Reddit moderator reply, so the pink bubble identifies Reddit as its source.', createdAt: now - 710, attachments: [] },
          { id: 'p4', side: 'moderator', sender: '@AliceMod', origin: 'Discord', bodyMarkdown: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nA second paragraph checks multiline spacing. On Reddit this reply carries the plain-text audit prefix, but the trusted web presentation moves that attribution into this bubble header.', createdAt: now - 620, attachments: [{ id: 'mock-image', name: 'moderation-context.png', kind: 'image', url: mockImage }] },
          { id: 'p5', side: 'internal', sender: 'u/Mae', origin: 'Reddit', bodyMarkdown: 'Synthetic internal staff note. It stays centred and visually distinct so it cannot be confused with either side of the conversation.', createdAt: now - 500, attachments: [] },
          { id: 'p6', side: 'participant', sender: 'u/ExampleUser', origin: 'Reddit', bodyMarkdown: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Supercalifragilisticexpialidocious-very-long-token-example-to-check-overflow@example.invalid', createdAt: now - 390, attachments: [] },
          { id: 'p7', side: 'moderator', sender: '@KarlaMod', origin: 'Telegram', bodyMarkdown: 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. This long Telegram-origin pink bubble makes the preview tall enough to test scrolling, mobile safe areas and app attribution.', createdAt: now - 260, attachments: [] },
          { id: 'p8', side: 'moderator', sender: '@KarlaMod', origin: 'Telegram', bodyMarkdown: 'Consecutive moderator message for spacing.', createdAt: now - 200, attachments: [] },
          { id: 'p9', side: 'participant', sender: 'u/ExampleUser', origin: 'Reddit', bodyMarkdown: 'Looks good from my side. One last tiny bubble. ✨', createdAt: now - 80, attachments: [] }
        ]
      }
    });
    closed = true;
    setEnabled(false);
    composer.placeholder = 'Preview only · replies are disabled';
    send.querySelector('.button-title').textContent = 'Preview only';
    close.querySelector('.button-title').textContent = 'Leave preview';
    status.textContent = 'Synthetic read-only preview. Nothing here can reach Reddit.';
  } else {
    modeBadge.textContent = 'Live';
    modeBadge.dataset.mode = 'live';
    setConnection('Connecting…', 'reconnecting');
    events = new EventSource(base + '/stream');
    events.onopen = () => setConnection('Connected', 'connected');
    events.onmessage = event => {
      try { render(JSON.parse(event.data)); }
      catch { status.textContent = 'Could not read a conversation update.'; }
    };
    events.addEventListener('closed', () => {
      closed = true;
      setEnabled(false);
      setConnection('Closed', 'closed');
      status.textContent = 'This temporary terminal has closed.';
      events.close();
    });
    events.onerror = () => {
      if (!closed) {
        setConnection('Reconnecting…', 'reconnecting');
        status.textContent = 'Connection interrupted; reconnecting…';
      }
    };
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
    setConnection('Closed', 'closed');
    await fetch(base + '/close', { method: 'POST' }).catch(() => undefined);
    if (events !== null) events.close();
    status.textContent = 'Terminal access closed. You can close this window.';
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.close === 'function') window.Telegram.WebApp.close();
  });

  resizeComposer();
  refreshSend();
})();
`;
