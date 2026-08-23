export const modmailMediaRuntime = String.raw`
(() => {
  'use strict';
  const picker = document.getElementById('media-picker');
  const attach = document.getElementById('attach-media');
  const drafts = document.getElementById('attachment-drafts');
  if (!(picker instanceof HTMLInputElement) || !(attach instanceof HTMLButtonElement) || !(drafts instanceof HTMLElement)) return;

  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
  const maxFiles = 8;
  const maxBytes = 20 * 1024 * 1024;
  let disabled = false;
  let selected = [];

  const notify = () => document.dispatchEvent(new CustomEvent('mae-modmail-media-change'));
  const cleanName = value => value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'attachment';
  const sizeText = bytes => bytes >= 1024 * 1024
    ? (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';

  const renderDrafts = () => {
    drafts.replaceChildren();
    for (const item of selected) {
      const chip = document.createElement('div');
      chip.className = 'attachment-draft';

      const label = document.createElement('span');
      label.className = 'attachment-draft__name';
      label.textContent = cleanName(item.file.name) + ' · ' + sizeText(item.file.size);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attachment-draft__remove';
      remove.setAttribute('aria-label', 'Remove ' + cleanName(item.file.name));
      remove.textContent = '×';
      remove.disabled = disabled;
      remove.addEventListener('click', () => {
        if (disabled) return;
        selected = selected.filter(candidate => candidate !== item);
        renderDrafts();
        notify();
      });

      chip.append(label, remove);
      drafts.append(chip);
    }
  };

  const addFiles = files => {
    if (disabled) return;
    for (const file of files) {
      if (selected.length >= maxFiles) break;
      if (!allowed.has(file.type) || file.size < 1 || file.size > maxBytes) continue;
      selected.push({ file, attachment: null });
    }
    picker.value = '';
    renderDrafts();
    notify();
  };

  attach.addEventListener('click', () => {
    if (!disabled) picker.click();
  });
  picker.addEventListener('change', () => addFiles([...(picker.files || [])]));

  const uploadOne = async (base, item) => {
    if (item.attachment !== null) return item.attachment;
    const response = await fetch(base + '/media', {
      method: 'POST',
      headers: {
        'content-type': item.file.type,
        'x-mae-file-name': encodeURIComponent(cleanName(item.file.name))
      },
      body: item.file
    });
    if (!response.ok) throw new Error('Media upload failed with HTTP ' + response.status);
    const payload = await response.json();
    if (!payload || !payload.attachment || typeof payload.attachment.id !== 'string') throw new Error('Media upload returned an invalid attachment');
    item.attachment = payload.attachment;
    return item.attachment;
  };

  const renderMessageAttachments = (bubble, attachments) => {
    if (!Array.isArray(attachments) || attachments.length === 0) return;
    const list = document.createElement('div');
    list.className = 'message-media';
    for (const attachment of attachments) {
      if (!attachment || typeof attachment.url !== 'string' || typeof attachment.name !== 'string') continue;
      const link = document.createElement('a');
      link.className = 'message-media__item';
      link.href = attachment.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      if (attachment.kind === 'image') {
        const image = document.createElement('img');
        image.src = attachment.url;
        image.alt = attachment.name;
        image.loading = 'lazy';
        link.append(image);
      } else if (attachment.kind === 'video') {
        const video = document.createElement('video');
        video.src = attachment.url;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        link.append(video);
      }

      const caption = document.createElement('span');
      caption.className = 'message-media__caption';
      caption.textContent = attachment.name;
      link.append(caption);
      list.append(link);
    }
    if (list.childElementCount > 0) bubble.append(list);
  };

  window.__maeModmailMedia = {
    hasFiles: () => selected.length > 0,
    count: () => selected.length,
    uploadAll: async base => {
      const attachments = [];
      for (const item of selected) attachments.push(await uploadOne(base, item));
      return attachments;
    },
    clear: () => {
      selected = [];
      renderDrafts();
      notify();
    },
    setDisabled: value => {
      disabled = value === true;
      picker.disabled = disabled;
      attach.disabled = disabled;
      renderDrafts();
    },
    renderMessageAttachments
  };
})();
`;
