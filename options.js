// options.js
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['geminiApiKey', 'sakuraApiUrl', 'sakuraApiKey'], s => {
    if (s.geminiApiKey) $('geminiApiKey').value = s.geminiApiKey;
    if (s.sakuraApiUrl) $('sakuraApiUrl').value = s.sakuraApiUrl;
    if (s.sakuraApiKey) $('sakuraApiKey').value = s.sakuraApiKey;
  });

  $('btn-save').addEventListener('click', () => {
    const settings = {
      geminiApiKey: $('geminiApiKey').value.trim(),
      sakuraApiUrl: $('sakuraApiUrl').value.trim().replace(/\/+$/, ''),
      sakuraApiKey: $('sakuraApiKey').value.trim()
    };

    chrome.storage.sync.set(settings, () => {
      const el = $('save-status');
      el.textContent = '✓ 保存しました';
      el.className = 'save-status ok show';
      setTimeout(() => el.classList.remove('show'), 2500);
    });
  });
});

const $ = id => document.getElementById(id);
