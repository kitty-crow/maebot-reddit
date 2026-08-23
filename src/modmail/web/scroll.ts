export const modmailTerminalScrollRuntime = String.raw`
(() => {
  'use strict';
  const messages = document.getElementById('messages');
  if (!(messages instanceof HTMLElement)) return;

  let initialised = false;
  let userMovedAway = false;

  const distanceFromBottom = () => Math.max(0, messages.scrollHeight - messages.scrollTop - messages.clientHeight);
  const atBottom = () => distanceFromBottom() < 96;
  const toBottom = behavior => {
    messages.scrollTo({ top: messages.scrollHeight, behavior });
  };

  messages.addEventListener('scroll', () => {
    if (!initialised) return;
    userMovedAway = !atBottom();
  }, { passive: true });

  const settleInitialPosition = () => {
    if (initialised || messages.childElementCount === 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toBottom('auto');
        initialised = true;
        userMovedAway = false;
      });
    });
  };

  const observer = new MutationObserver(() => {
    if (!initialised) {
      settleInitialPosition();
      return;
    }
    if (!userMovedAway || atBottom()) requestAnimationFrame(() => toBottom('smooth'));
  });
  observer.observe(messages, { childList: true, subtree: true, characterData: true });

  const resize = new ResizeObserver(() => {
    if (!initialised) {
      settleInitialPosition();
      return;
    }
    if (!userMovedAway) toBottom('auto');
  });
  resize.observe(messages);

  if (messages.childElementCount > 0) settleInitialPosition();
})();
`;
