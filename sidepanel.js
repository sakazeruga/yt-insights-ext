// sidepanel.js
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentVideo = null;
let userTags     = [];
let libLoaded    = false;
let searchTimer  = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initTagInput();
  initSaveButton();
  initRemoveButton();
  initLibraryControls();
  loadCurrentVideoFromStorage();
  listenStorageChanges();
});

// ─── Storage listener ─────────────────────────────────────────────────────────
function listenStorageChanges() {
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local') return;

    if (changes.currentVideo) {
      onVideoChange(changes.currentVideo.newValue);
    }

    if (currentVideo) {
      const key = `analysis_${currentVideo.videoId}`;
      if (changes[key]) onAnalysisUpdate(changes[key].newValue);
    }
  });
}

// ─── Tab logic ────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const pane = document.getElementById(`tab-${btn.dataset.tab}`);
      pane.classList.remove('hidden');
      if (btn.dataset.tab === 'library' && !libLoaded) loadLibrary();
    });
  });
}

// ─── Current video ────────────────────────────────────────────────────────────
async function loadCurrentVideoFromStorage() {
  const { currentVideo: v } = await storageGet('currentVideo');
  await onVideoChange(v);
}

async function onVideoChange(video) {
  currentVideo = video || null;

  if (!video) {
    show('no-video'); hide('video-panel');
    return;
  }

  hide('no-video'); show('video-panel');

  // Fill meta card
  $('vid-thumb').src          = video.thumbnailUrl;
  $('vid-title').textContent  = video.title;
  $('vid-channel').textContent = video.channelName;
  $('vid-duration').textContent = video.duration;

  // Check bookmark status
  const { exists, data } = await msg({ type: 'CHECK_BOOKMARK', videoId: video.videoId });
  if (exists && data) {
    showBookmarkedState(data);
  } else {
    showUnbookmarkedState();
  }

  // Restore cached analysis if any
  const cached = (await storageGet(`analysis_${video.videoId}`))[`analysis_${video.videoId}`];
  if (cached) onAnalysisUpdate(cached);
}

function showBookmarkedState(data) {
  show('bm-banner'); hide('bm-form');
  // Pre-fill existing analysis if bookmark has it
  if (data.status === 'done' && data.summary) {
    renderAnalysis({
      summary:              data.summary,
      keyPoints:            data.key_points || [],
      importantTimestamps:  data.important_timestamps || [],
      category:             data.category,
      insights:             data.insights,
      autoTags:             data.auto_tags || []
    });
  } else if (data.status === 'analyzing') {
    show('analysis-area'); show('analysis-loading');
    hide('analysis-done'); hide('analysis-error');
  }
}

function showUnbookmarkedState() {
  hide('bm-banner'); show('bm-form');
  hide('analysis-area');
  // Reset form
  userTags = [];
  renderTagChips();
  $('notes-inp').value = '';
}

// ─── Tag input ────────────────────────────────────────────────────────────────
function initTagInput() {
  $('tag-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = $('tag-inp').value.trim().replace(/,+$/, '');
      if (v && !userTags.includes(v)) { userTags.push(v); renderTagChips(); }
      $('tag-inp').value = '';
    }
    if (e.key === 'Backspace' && !$('tag-inp').value && userTags.length) {
      userTags.pop(); renderTagChips();
    }
  });
  $('tag-field').addEventListener('click', () => $('tag-inp').focus());
}

function renderTagChips() {
  $('tags-row').innerHTML = userTags.map((t, i) => `
    <span class="tag-chip">
      ${esc(t)}
      <button class="tag-chip-x" data-i="${i}">×</button>
    </span>`
  ).join('');
  $('tags-row').querySelectorAll('.tag-chip-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      userTags.splice(+btn.dataset.i, 1);
      renderTagChips();
    });
  });
}

// ─── Save / bookmark ──────────────────────────────────────────────────────────
function initSaveButton() {
  $('btn-save').addEventListener('click', handleSave);
}

async function handleSave() {
  if (!currentVideo) return;

  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = '保存中…';

  const bm = {
    video_id:      currentVideo.videoId,
    video_url:     currentVideo.url,
    title:         currentVideo.title,
    channel_name:  currentVideo.channelName,
    thumbnail_url: currentVideo.thumbnailUrl,
    duration:      currentVideo.duration,
    tags:          userTags,
    user_notes:    $('notes-inp').value.trim(),
    status:        'analyzing'
  };

  const res = await msg({ type: 'SAVE_BOOKMARK', data: bm });
  if (!res?.ok) {
    toast('保存失敗: ' + (res?.error || ''), 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>◈</span> ブックマーク＋AI分析';
    return;
  }

  // Switch to analyzing state
  hide('bm-form'); show('bm-banner');
  show('analysis-area'); show('analysis-loading');
  hide('analysis-done'); hide('analysis-error');
  toast('ブックマーク保存 — Gemini解析を開始します', 'ok');

  // Kick off analysis (result flows via storage.onChanged)
  msg({ type: 'ANALYZE_VIDEO', videoId: currentVideo.videoId, videoUrl: currentVideo.url });

  btn.disabled = false;
  btn.innerHTML = '<span>◈</span> ブックマーク＋AI分析';
  if (libLoaded) loadLibrary();
}

// ─── Remove bookmark ──────────────────────────────────────────────────────────
function initRemoveButton() {
  $('btn-remove').addEventListener('click', async () => {
    if (!currentVideo) return;
    if (!confirm('このブックマークを削除しますか？')) return;
    await msg({ type: 'DELETE_BOOKMARK', videoId: currentVideo.videoId });
    chrome.storage.local.remove(`analysis_${currentVideo.videoId}`);
    showUnbookmarkedState();
    toast('削除しました', 'ok');
    if (libLoaded) loadLibrary();
  });
}

// ─── Analysis rendering ───────────────────────────────────────────────────────
function onAnalysisUpdate(state) {
  if (!state) return;
  show('analysis-area');

  if (state.status === 'analyzing') {
    show('analysis-loading'); hide('analysis-done'); hide('analysis-error');
    return;
  }

  hide('analysis-loading');

  if (state.status === 'error') {
    show('analysis-error'); hide('analysis-done');
    $('analysis-error-msg').textContent = '⚠ ' + (state.error || '不明なエラー');
    $('btn-retry').onclick = () => {
      msg({ type: 'ANALYZE_VIDEO', videoId: currentVideo.videoId, videoUrl: currentVideo.url });
      show('analysis-loading'); hide('analysis-error');
    };
    return;
  }

  if (state.status === 'done' && state.analysis) {
    renderAnalysis(state.analysis);
  }
}

function renderAnalysis(a) {
  hide('analysis-loading'); hide('analysis-error');
  show('analysis-area'); show('analysis-done');

  // Summary
  $('a-summary').textContent = a.summary || '';

  // Key points
  $('a-keypoints').innerHTML = (a.keyPoints || []).map(p =>
    `<li class="kp-item">${esc(p)}</li>`
  ).join('');

  // Timestamps
  $('a-timestamps').innerHTML = (a.importantTimestamps || []).map(ts => `
    <div class="ts-item">
      <a href="${currentVideo?.url}&t=${toSecs(ts.time)}s" target="_blank" class="ts-link">
        <span class="ts-time">${esc(ts.time)}</span>
      </a>
      <span class="ts-label">${esc(ts.label)}</span>
    </div>`
  ).join('');

  // Insights
  $('a-insights').textContent = a.insights || '';

  // Auto tags
  $('a-autotags').innerHTML = (a.autoTags || []).map(t =>
    `<span class="auto-tag">${esc(t)}</span>`
  ).join('');
}

// ─── Library ──────────────────────────────────────────────────────────────────
function initLibraryControls() {
  $('btn-refresh').addEventListener('click', loadLibrary);

  $('lib-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadLibrary, 380);
  });

  $('cat-filter').addEventListener('change', loadLibrary);
}

async function loadLibrary() {
  libLoaded = true;
  $('bm-list').innerHTML = '<div class="list-loading"><div class="spinner"></div></div>';

  const query = {
    search:   $('lib-search').value.trim() || undefined,
    category: $('cat-filter').value || undefined
  };

  const res = await msg({ type: 'GET_BOOKMARKS', query });
  if (!res?.ok) {
    $('bm-list').innerHTML = `<div class="list-empty">⚠ ${esc(res?.error || 'エラー')}</div>`;
    return;
  }

  const items = res.data || [];
  $('lib-count').textContent = `${items.length} 件`;

  if (!items.length) {
    $('bm-list').innerHTML = '<div class="list-empty">📚 ブックマークがありません</div>';
    return;
  }

  $('bm-list').innerHTML = items.map(b => `
    <div class="bm-card">
      <img class="bm-img" src="${b.thumbnail_url || `https://img.youtube.com/vi/${b.video_id}/mqdefault.jpg`}" alt="" loading="lazy">
      <div class="bm-body">
        <a href="${b.video_url}" target="_blank" class="bm-title">${esc(b.title)}</a>
        <div class="bm-meta">
          <span class="bm-channel">${esc(b.channel_name || '')}</span>
          ${b.category ? `<span class="bm-cat">${esc(b.category)}</span>` : ''}
          <span class="${statusClass(b.status)}">${statusLabel(b.status)}</span>
        </div>
        ${b.summary ? `<p class="bm-summary">${esc(b.summary)}</p>` : ''}
        <div class="bm-tags-row">
          ${[...(b.tags || []), ...(b.auto_tags || [])].slice(0, 6).map(t =>
            `<span class="bm-tag">${esc(t)}</span>`
          ).join('')}
        </div>
        <div class="bm-actions">
          <button class="btn-ghost-danger" onclick="libDelete('${b.video_id}')">削除</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.libDelete = async function(videoId) {
  if (!confirm('削除しますか？')) return;
  await msg({ type: 'DELETE_BOOKMARK', videoId });
  chrome.storage.local.remove(`analysis_${videoId}`);
  toast('削除しました', 'ok');
  loadLibrary();
};

function statusClass(s) {
  if (s === 'done')      return 'bm-status-done';
  if (s === 'analyzing') return 'bm-status-analyzing';
  return 'bm-status-pending';
}
function statusLabel(s) {
  if (s === 'done')      return '✦ 分析済';
  if (s === 'analyzing') return '⟳ 分析中';
  return '○ 未分析';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(text, type = 'ok') {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $( id)?.classList.remove('hidden');
const hide = id => $( id)?.classList.add('hidden');

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toSecs(t) {
  if (!t) return 0;
  const p = String(t).split(':').map(Number);
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  if (p.length === 2) return p[0]*60 + p[1];
  return 0;
}

function msg(payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(payload, res => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

function storageGet(...keys) {
  return new Promise(r => chrome.storage.local.get(keys.length === 1 ? keys[0] : keys, r));
}
