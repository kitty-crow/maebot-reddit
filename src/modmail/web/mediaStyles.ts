export const modmailMediaStyles = String.raw`
.attachment-controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}

.attach-button {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: .72rem;
  font-weight: 750;
  cursor: pointer;
}

.attachment-drafts {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  gap: 5px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.attachment-draft {
  display: flex;
  min-width: 0;
  max-width: 190px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 3px 5px 3px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--muted);
  font-size: .66rem;
}

.attachment-draft__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-draft__remove {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.message-media {
  display: grid;
  gap: 6px;
  padding: 0 7px 7px;
}

.message-media__item {
  display: block;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 11px;
  background: rgb(0 0 0 / 12%);
  color: inherit;
  text-decoration: none;
}

.message-media__item img,
.message-media__item video {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  background: rgb(0 0 0 / 18%);
}

.message-media__caption {
  display: block;
  padding: 5px 7px;
  overflow: hidden;
  font-size: .64rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 520px) {
  .attachment-controls {
    margin-top: 4px;
  }

  .attach-button {
    min-height: 31px;
    padding: 4px 8px;
    font-size: .66rem;
  }

  .attachment-draft {
    max-width: 150px;
  }

  .message-media__item img,
  .message-media__item video {
    max-height: 210px;
  }
}
`;
