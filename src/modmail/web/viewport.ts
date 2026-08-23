export const modmailTerminalViewportStyles = String.raw`
html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  min-height: 0;
}

.terminal-shell {
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.conversation-card,
.messages {
  min-height: 0;
}

.messages {
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.terminal-header {
  padding: 10px 12px;
}

.header-row {
  align-items: center;
  gap: 8px;
}

.brand-copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.eyebrow {
  margin: 0;
  font-size: .61rem;
  letter-spacing: .09em;
  white-space: nowrap;
}

h1 {
  min-width: 0;
  overflow: hidden;
  font-size: 1.02rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-toggle {
  width: 38px;
  height: 38px;
}

.conversation-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px 10px;
  margin-top: 7px;
  overflow: hidden;
}

.summary-item {
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.summary-item span,
.summary-item strong {
  display: inline;
}

.summary-item span {
  margin: 0 4px 0 0;
  font-size: .56rem;
  letter-spacing: .05em;
}

.summary-item strong {
  font-size: .72rem;
}

.subject {
  margin: 5px 0 0;
  overflow: hidden;
  font-size: .76rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-toolbar {
  min-height: 36px;
  padding: 5px 8px 5px 11px;
}

.composer-card {
  padding: 8px;
}

.composer-label {
  margin-bottom: 4px;
  font-size: .68rem;
}

textarea {
  min-height: 58px;
  max-height: 150px;
  padding: 8px 10px;
}

.composer-actions {
  gap: 6px;
  margin-top: 6px;
}

.action-button {
  min-height: 40px;
  padding: 6px 10px;
}

.status-row {
  min-height: 17px;
  margin-top: 4px;
}

@media (max-width: 720px) {
  .terminal-shell {
    width: 100%;
    padding:
      max(3px, env(safe-area-inset-top))
      max(3px, env(safe-area-inset-right))
      max(3px, env(safe-area-inset-bottom))
      max(3px, env(safe-area-inset-left));
    gap: 4px;
  }

  .terminal-header,
  .conversation-card,
  .composer-card {
    border-radius: 13px;
  }

  .conversation-summary {
    flex-wrap: nowrap;
  }

  .summary-item {
    flex: 0 1 auto;
  }

  .summary-item:last-child {
    grid-column: auto;
  }

  .messages {
    min-height: 0;
    padding: 8px;
  }
}

@media (max-width: 520px) {
  .terminal-shell {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .terminal-header {
    padding: 7px 8px;
  }

  .eyebrow {
    font-size: .54rem;
  }

  h1 {
    font-size: .93rem;
  }

  .theme-toggle {
    width: 34px;
    height: 34px;
  }

  .conversation-summary {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: 3px 8px;
    margin-top: 5px;
  }

  .summary-item {
    overflow: hidden;
    white-space: nowrap;
  }

  .summary-item strong {
    display: block;
    overflow: hidden;
    font-size: .67rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-item span {
    display: block;
    margin: 0;
    font-size: .49rem;
  }

  .subject {
    margin-top: 3px;
    font-size: .68rem;
  }

  .conversation-toolbar {
    min-height: 32px;
    padding: 3px 7px 3px 9px;
  }

  .connection-state {
    min-height: 24px;
    padding: 3px 7px;
    font-size: .62rem;
  }

  .messages {
    min-height: 0;
    padding: 7px;
  }

  .composer-card {
    padding: 6px;
  }

  .composer-label {
    margin-bottom: 3px;
  }

  textarea {
    min-height: 52px;
    max-height: 112px;
    padding: 7px 9px;
  }

  .composer-actions {
    gap: 5px;
    margin-top: 5px;
  }

  .action-button {
    min-height: 38px;
  }

  .status-row {
    margin-top: 3px;
  }
}
`;
