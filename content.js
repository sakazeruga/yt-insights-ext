// content.js – YouTube video detection (injected on youtube.com/watch)
'use strict';

const TITLE_SELECTORS = [
  'h1.ytd-video-primary-info-renderer yt-formatted-string',
  '.ytd-watch-metadata h1 yt-formatted-string',
  'h1.ytd-video-primary-info-renderer',
  '#above-the-fold #title h1',
  'ytd-watch-metadata h1'
];

const CHANNEL_SELECTORS = [
  'ytd-channel-name a.yt-formatted-string',
  '#channel-name a',
  '#owner-name a',
  'ytd-video-owner-renderer #channel-name a'
];

function extractVideoInfo() {
  const videoId = new URLSearchParams(window.location.search).get('v');
  if (!videoId) return null;

  let title = '';
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { title = el.textContent.trim(); break; }
  }
  if (!title) title = document.title.replace(' - YouTube', '').trim();

  let channelName = '';
  for (const sel of CHANNEL_SELECTORS) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) { channelName = el.textContent.trim(); break; }
  }

  const duration = document.querySelector('.ytp-time-duration')?.textContent?.trim() || '';
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    channelName,
    thumbnailUrl,
    duration
  };
}

function pushVideoInfo() {
  const info = extractVideoInfo();
  try {
    chrome.runtime.sendMessage({ type: 'VIDEO_INFO', data: info });
  } catch (_) {
    // extension may not be ready
  }
}

// Initial push — wait for YouTube's React hydration
setTimeout(pushVideoInfo, 1800);

// SPA navigation observer
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  if (location.href.includes('/watch')) {
    setTimeout(pushVideoInfo, 1800);
  } else {
    try { chrome.runtime.sendMessage({ type: 'VIDEO_INFO', data: null }); } catch (_) {}
  }
}).observe(document.documentElement, { subtree: true, childList: true });
