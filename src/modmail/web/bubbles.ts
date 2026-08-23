export const modmailBubbleStyles = String.raw`
:root {
  --user-bubble: linear-gradient(145deg, #8061cf, #6d4cbc);
  --user-strip: rgb(60 35 127 / 48%);
  --user-text: #ffffff;
  --mod-bubble: linear-gradient(145deg, #ed75ad, #d85b9b);
  --mod-strip: rgb(137 31 88 / 42%);
  --mod-text: #ffffff;
  --bubble-time: #756d82;
}

:root[data-theme="dark"] {
  --user-bubble: linear-gradient(145deg, #6945b9, #523293);
  --user-strip: rgb(31 17 76 / 55%);
  --mod-bubble: linear-gradient(145deg, #c84988, #a93672);
  --mod-strip: rgb(91 19 59 / 55%);
  --bubble-time: #aaa0b8;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --user-bubble: linear-gradient(145deg, #6945b9, #523293);
    --user-strip: rgb(31 17 76 / 55%);
    --mod-bubble: linear-gradient(145deg, #c84988, #a93672);
    --mod-strip: rgb(91 19 59 / 55%);
    --bubble-time: #aaa0b8;
  }
}

.message-wrapper {
  display: flex;
  width: fit-content;
  max-width: min(78%, 720px);
  flex-direction: column;
  opacity: 0;
  translate: 0 .25rem;
  transition: opacity 300ms ease, translate 300ms ease;
}

.message-wrapper.show {
  opacity: 1;
  translate: 0 0;
}

.message-wrapper.participant {
  align-self: flex-start;
  align-items: flex-start;
}

.message-wrapper.moderator {
  align-self: flex-end;
  align-items: flex-end;
}

.message-wrapper.internal {
  align-self: center;
  align-items: center;
  width: min(94%, 760px);
  max-width: none;
}

.message-bubble {
  position: relative;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  border-radius: 1.05rem;
  box-shadow: var(--shadow-soft);
}

.message-bubble.participant {
  border-bottom-left-radius: .32rem;
  background: var(--user-bubble);
  color: var(--user-text);
}

.message-bubble.moderator {
  border-bottom-right-radius: .32rem;
  background: var(--mod-bubble);
  color: var(--mod-text);
}

.message-bubble.internal {
  width: 100%;
  border: 1px dashed var(--internal-border);
  border-radius: .85rem;
  background: var(--internal);
  color: var(--text);
  box-shadow: none;
}

.nickname-strip {
  padding: .28rem .72rem .18rem;
  font-size: .68rem;
  font-weight: 850;
  letter-spacing: .015em;
}

.message-bubble.participant .nickname-strip {
  background: var(--user-strip);
  color: rgb(255 255 255 / 94%);
}

.message-bubble.moderator .nickname-strip {
  background: var(--mod-strip);
  color: rgb(255 255 255 / 96%);
}

.message-bubble.internal .nickname-strip {
  background: color-mix(in srgb, var(--internal-border) 18%, transparent);
  color: var(--muted);
}

.message-text {
  padding: .5rem .72rem .68rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: .9rem;
  line-height: 1.48;
}

.timestamp {
  margin-top: .22rem;
  padding-inline: .22rem;
  color: var(--bubble-time);
  font-family: var(--mono);
  font-size: .58rem;
}

.message-wrapper.participant .timestamp {
  align-self: flex-start;
}

.message-wrapper.moderator .timestamp {
  align-self: flex-end;
}

.message-wrapper.internal .timestamp {
  align-self: center;
}

@media (max-width: 720px) {
  .message-wrapper {
    max-width: 84%;
  }
}

@media (max-width: 520px) {
  .message-wrapper {
    max-width: 89%;
  }

  .message-wrapper.internal {
    width: 96%;
  }

  .nickname-strip {
    padding: .24rem .62rem .14rem;
    font-size: .64rem;
  }

  .message-text {
    padding: .44rem .62rem .58rem;
    font-size: .86rem;
  }
}
`;
