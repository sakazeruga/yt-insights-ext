// background.js – Service Worker
'use strict';

const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Tab management ───────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (tab.url?.includes('youtube.com/watch')) {
    chrome.storage.local.set({ lastYoutubeTabId: tabId });
  }
});

// ─── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  switch (msg.type) {

    case 'VIDEO_INFO':
      chrome.storage.local.set({ currentVideo: msg.data });
      reply({ ok: true });
      break;

    // Fire-and-forget: result flows back via chrome.storage.local change
    case 'ANALYZE_VIDEO':
      runGeminiAnalysis(msg.videoId, msg.videoUrl);
      reply({ ok: true, started: true });
      break;

    case 'CHECK_BOOKMARK':
      checkBookmark(msg.videoId).then(reply);
      return true;

    case 'SAVE_BOOKMARK':
      saveBookmark(msg.data).then(reply);
      return true;

    case 'UPDATE_BOOKMARK':
      updateBookmark(msg.videoId, msg.updates).then(reply);
      return true;

    case 'DELETE_BOOKMARK':
      deleteBookmark(msg.videoId).then(reply);
      return true;

    case 'GET_BOOKMARKS':
      getBookmarks(msg.query).then(reply);
      return true;
  }
});

// ─── Gemini ────────────────────────────────────────────────────────────────────

async function runGeminiAnalysis(videoId, videoUrl) {
  await setAnalysisState(videoId, { status: 'analyzing' });

  const { geminiApiKey } = await getSettings();
  if (!geminiApiKey) {
    await setAnalysisState(videoId, { status: 'error', error: 'Gemini API Keyが未設定です（設定ページで入力してください）' });
    return;
  }

  const prompt = `このYouTube動画を詳細に分析し、以下のJSON形式のみで回答してください（前後に余計な文字不要）。

{
  "summary": "動画の要約（日本語、200〜300字）",
  "keyPoints": [
    "重要なポイント1（完全な文で）",
    "重要なポイント2",
    "…最大10個"
  ],
  "importantTimestamps": [
    { "time": "0:00", "label": "冒頭・概要" },
    { "time": "2:30", "label": "このシーンの内容" }
  ],
  "category": "技術|ビジネス|教育|エンタメ|投資|健康|その他 から1つ",
  "insights": "この動画から得られる実践的な知見・学び・次のアクション（日本語、200字程度）",
  "autoTags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5"]
}`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { fileData: { fileUri: videoUrl } },
            { text: prompt }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3
        }
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Geminiからの応答が空でした');

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('JSONの解析に失敗しました');
      analysis = JSON.parse(m[0]);
    }

    await setAnalysisState(videoId, { status: 'done', analysis });

    // Persist analysis into the bookmark record
    await updateBookmark(videoId, {
      summary:               analysis.summary,
      key_points:            analysis.keyPoints,
      important_timestamps:  analysis.importantTimestamps,
      category:              analysis.category,
      insights:              analysis.insights,
      auto_tags:             analysis.autoTags,
      status:                'done'
    });

  } catch (err) {
    await setAnalysisState(videoId, { status: 'error', error: err.message });
  }
}

async function setAnalysisState(videoId, state) {
  await chrome.storage.local.set({
    [`analysis_${videoId}`]: { ...state, ts: Date.now() }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(r =>
    chrome.storage.sync.get(['geminiApiKey', 'sakuraApiUrl', 'sakuraApiKey'], r)
  );
}

// ─── さくらPHP API helpers ────────────────────────────────────────────────────

function apiHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': key
  };
}

async function checkBookmark(videoId) {
  const { sakuraApiUrl, sakuraApiKey } = await getSettings();

  if (!sakuraApiUrl || !sakuraApiKey) {
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    const found = bookmarks.find(b => b.video_id === videoId) || null;
    return { exists: !!found, data: found };
  }

  try {
    const res = await fetch(
      `${sakuraApiUrl}?video_id=${encodeURIComponent(videoId)}`,
      { headers: apiHeaders(sakuraApiKey) }
    );
    return await res.json();
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

async function saveBookmark(bm) {
  const { sakuraApiUrl, sakuraApiKey } = await getSettings();

  if (!sakuraApiUrl || !sakuraApiKey) {
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    const now = new Date().toISOString();
    const idx = bookmarks.findIndex(b => b.video_id === bm.video_id);
    if (idx >= 0) {
      bookmarks[idx] = { ...bookmarks[idx], ...bm, updated_at: now };
    } else {
      bookmarks.unshift({ id: `local_${Date.now()}`, ...bm, created_at: now, updated_at: now });
    }
    await chrome.storage.local.set({ bookmarks });
    return { ok: true, local: true };
  }

  try {
    const res = await fetch(sakuraApiUrl, {
      method: 'POST',
      headers: apiHeaders(sakuraApiKey),
      body: JSON.stringify(bm)
    });
    if (!res.ok) throw new Error(await res.text());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function updateBookmark(videoId, updates) {
  const { sakuraApiUrl, sakuraApiKey } = await getSettings();

  if (!sakuraApiUrl || !sakuraApiKey) {
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    const idx = bookmarks.findIndex(b => b.video_id === videoId);
    if (idx >= 0) {
      bookmarks[idx] = { ...bookmarks[idx], ...updates, updated_at: new Date().toISOString() };
      await chrome.storage.local.set({ bookmarks });
    }
    return { ok: true };
  }

  try {
    const res = await fetch(
      `${sakuraApiUrl}?video_id=${encodeURIComponent(videoId)}`,
      {
        method: 'PATCH',
        headers: apiHeaders(sakuraApiKey),
        body: JSON.stringify(updates)
      }
    );
    if (!res.ok) throw new Error(await res.text());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function deleteBookmark(videoId) {
  const { sakuraApiUrl, sakuraApiKey } = await getSettings();

  if (!sakuraApiUrl || !sakuraApiKey) {
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    await chrome.storage.local.set({ bookmarks: bookmarks.filter(b => b.video_id !== videoId) });
    return { ok: true };
  }

  try {
    const res = await fetch(
      `${sakuraApiUrl}?video_id=${encodeURIComponent(videoId)}`,
      { method: 'DELETE', headers: apiHeaders(sakuraApiKey) }
    );
    if (!res.ok) throw new Error(await res.text());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getBookmarks(query = {}) {
  const { sakuraApiUrl, sakuraApiKey } = await getSettings();

  if (!sakuraApiUrl || !sakuraApiKey) {
    let { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    if (query.search) {
      const q = query.search.toLowerCase();
      bookmarks = bookmarks.filter(b =>
        b.title?.toLowerCase().includes(q) ||
        b.summary?.toLowerCase().includes(q) ||
        b.insights?.toLowerCase().includes(q) ||
        (b.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (b.auto_tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (query.category) bookmarks = bookmarks.filter(b => b.category === query.category);
    return { ok: true, data: bookmarks };
  }

  try {
    const p = new URLSearchParams({ limit: String(query.limit || 100) });
    if (query.search)   p.set('search',   query.search);
    if (query.category) p.set('category', query.category);

    const res = await fetch(`${sakuraApiUrl}?${p}`, { headers: apiHeaders(sakuraApiKey) });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
