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
  let lastSignature = '';
  let closed = false;
  let events = null;

  const setConnection = (text, state) => {
    connection.textContent = text;
    connection.dataset.state = state;
  };

  const resizeComposer = () => {
    composer.style.height = 'auto';
    composer.style.height = Math.min(Math.max(composer.scrollHeight, 78), 240) + 'px';
  };

  const refreshSend = () => {
    send.disabled = preview || closed || composer.disabled || composer.value.trim().length === 0;
  };

  const setEnabled = enabled => {
    composer.disabled = !enabled;
    refreshSend();
  };

  composer.addEventListener('input', () => {
    resizeComposer();
    refreshSend();
  });

  const roleFor = (message, participant) => {
    if (message.isInternal) return 'internal';
    const author = (message.author && message.author.name || '').toLowerCase();
    return participant && author === participant.toLowerCase() ? 'participant' : 'moderator';
  };

  const renderMessages = (conversation, participant) => {
    const signature = JSON.stringify(conversation.messages.map(message => [
      message.id,
      message.bodyMarkdown,
      message.createdAt,
      message.isInternal,
      message.author && message.author.name
    ]));
    if (signature === lastSignature) return;

    const first = lastSignature.length === 0;
    const fromBottom = Math.max(0, messages.scrollHeight - messages.scrollTop - messages.clientHeight);
    lastSignature = signature;
    messages.replaceChildren();

    for (const message of conversation.messages) {
      const role = roleFor(message, participant);
      const wrapper = document.createElement('article');
      wrapper.className = 'message-wrapper ' + role;

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble ' + role;

      const who = document.createElement('div');
      who.className = 'nickname-strip';
      const name = message.author && message.author.name || '[deleted]';
      who.textContent = message.isInternal ? 'Internal note · ' + name : name;

      const body = document.createElement('div');
      body.className = 'message-text';
      body.textContent = message.bodyMarkdown || '';
      bubble.append(who, body);

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
    const participant = conversation.participant && conversation.participant.name || '[deleted]';
    participantEl.textContent = 'u/' + participant;
    subredditEl.textContent = 'r/' + conversation.subreddit;
    identityEl.textContent = moderator.handle + ' · ' + moderator.platform;
    subjectEl.textContent = conversation.subject || '(no subject)';
    renderMessages(conversation, participant);

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
    if (!text || preview || closed) return;
    send.disabled = true;
    status.textContent = 'Queueing reply…';
    try {
      const response = await fetch(base + '/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), text })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      composer.value = '';
      resizeComposer();
      status.textContent = 'Reply queued for Reddit.';
    } catch {
      status.textContent = 'Reply was not queued. Your text has been kept.';
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
    render({
      moderator: { handle: '@MaeModerator', platform: 'preview' },
      conversation: {
        participant: { name: 'ExampleUser' },
        subreddit: 'catgirlcoin',
        subject: 'Responsive bubble and long-message visual QA · synthetic preview',
        state: 'inprogress',
        messages: [
          { id: 'p1', author: { name: 'ExampleUser' }, bodyMarkdown: 'Hi! This is a short message so we can check the compact purple bubble.', createdAt: now - 780, isInternal: false },
          { id: 'p2', author: { name: 'ExampleUser' }, bodyMarkdown: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This intentionally longer participant message checks wrapping, readable line length and how the left-side bubble behaves on a narrow phone.', createdAt: now - 720, isInternal: false },
          { id: 'p3', author: { name: 'MaeModerator' }, bodyMarkdown: 'Thanks! This is a compact moderator reply on the pink side.', createdAt: now - 610, isInternal: false },
          { id: 'p4', author: { name: 'MaeModerator' }, bodyMarkdown: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nA second paragraph checks multiline spacing and whether a longer moderator reply stays comfortable on mobile.', createdAt: now - 545, isInternal: false },
          { id: 'p5', author: { name: 'Mae' }, bodyMarkdown: 'Synthetic internal staff note. It stays centred and visually neutral so it cannot be confused with either side of the conversation.', createdAt: now - 430, isInternal: true },
          { id: 'p6', author: { name: 'ExampleUser' }, bodyMarkdown: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Supercalifragilisticexpialidocious-very-long-token-example-to-check-overflow@example.invalid', createdAt: now - 320, isInternal: false },
          { id: 'p7', author: { name: 'MaeModerator' }, bodyMarkdown: 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. This final long pink bubble makes the preview tall enough to test scrolling, sticky composition and safe-area spacing.', createdAt: now - 190, isInternal: false },
          { id: 'p8', author: { name: 'ExampleUser' }, bodyMarkdown: 'Looks good from my side. One last tiny bubble. ✨', createdAt: now - 70, isInternal: false }
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
