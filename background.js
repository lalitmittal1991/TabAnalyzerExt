// ============================================================
// TabMind — Background Service Worker
// Tracks active tab durations and stores browsing history.
// Data is stored in chrome.storage.local with a rolling 7-day window.
// ============================================================

const STORAGE_KEY = 'tabmind_tracking_data';
const MAX_AGE_DAYS = 14;

let currentTabInfo = null; // { tabId, url, title, startTime }

// ---- Lifecycle Events ----

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await recordCurrentAndStart(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    if (currentTabInfo && currentTabInfo.tabId === tabId) {
      await recordCurrentAndStart(tabId);
    }
    notifySidePanelRefresh();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  notifySidePanelRefresh();
  checkTabThreshold();
});

async function checkTabThreshold() {
  const settings = await chrome.storage.local.get('tabmind_tab_threshold');
  const threshold = parseInt(settings.tabmind_tab_threshold);
  if (!threshold || threshold <= 0) return;

  const tabs = await chrome.tabs.query({});
  if (tabs.length > threshold) {
    // We try to open it, but if it fails due to "user gesture" requirement, we show a notification
    chrome.windows.getCurrent((window) => {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ windowId: window.id }).catch(() => {
          // Fallback to notification if opening is blocked
          showThresholdNotification(tabs.length);
        });
      } else {
        showThresholdNotification(tabs.length);
      }
    });
  }
}

function showThresholdNotification(count) {
  chrome.notifications.create('tabmind_threshold_hit', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'TabMind — Too many tabs!',
    message: `You currently have ${count} tabs open. Click here to prioritize them with AI!`,
    priority: 2
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'tabmind_threshold_hit') {
    chrome.windows.getCurrent((window) => {
      chrome.sidePanel.open({ windowId: window.id });
    });
  }
});

function notifySidePanelRefresh() {
  chrome.runtime.sendMessage({ action: 'refreshAnalysis' }).catch(() => {
    // Ignore error if side panel is not open
  });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (currentTabInfo && currentTabInfo.tabId === tabId) {
    await recordCurrent();
    currentTabInfo = null;
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — record current
    await recordCurrent();
    currentTabInfo = null;
  } else {
    // Browser gained focus — find active tab in the window
    const tabs = await chrome.tabs.query({ active: true, windowId });
    if (tabs.length > 0) {
      await recordCurrentAndStart(tabs[0].id);
    }
  }
});

// ---- Helpers ----

async function recordCurrentAndStart(tabId) {
  await recordCurrent();
  try {
    const tab = await chrome.tabs.get(tabId);
    currentTabInfo = {
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
      startTime: Date.now()
    };
  } catch {
    currentTabInfo = null;
  }
}

async function recordCurrent() {
  if (!currentTabInfo) return;
  const elapsed = Date.now() - currentTabInfo.startTime;
  if (elapsed < 1000) return; // ignore sub-second visits

  const entry = {
    url: currentTabInfo.url,
    title: currentTabInfo.title,
    domain: extractDomain(currentTabInfo.url),
    duration: elapsed,
    timestamp: currentTabInfo.startTime
  };

  const data = await getTrackingData();
  data.push(entry);

  // Prune entries older than MAX_AGE_DAYS
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const filtered = data.filter(e => e.timestamp >= cutoff);

  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}

async function getTrackingData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---- Message Handler (for popup communication) ----

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTrackingData') {
    getTrackingData().then(data => sendResponse({ data }));
    return true; // keep channel open for async response
  }

  if (request.action === 'getTabContent') {
    chrome.scripting.executeScript(
      {
        target: { tabId: request.tabId },
        func: extractPageText
      },
      (results) => {
        if (chrome.runtime.lastError || !results || !results[0]) {
          sendResponse({ text: '', metadata: {} });
        } else {
          const payload = results[0].result || {};
          if (typeof payload === 'string') {
            sendResponse({ text: payload, metadata: {} });
          } else {
            sendResponse({
              text: payload.text || '',
              metadata: payload.metadata || {}
            });
          }
        }
      }
    );
    return true;
  }
});

// Injected function — runs in the tab context
function extractPageText() {
  function countWords(text) {
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }

  function parseDurationValue(value) {
    if (!value) return null;
    const iso = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (iso) {
      const h = parseInt(iso[1] || '0', 10);
      const m = parseInt(iso[2] || '0', 10);
      const s = parseInt(iso[3] || '0', 10);
      return h * 60 + m + Math.round(s / 60);
    }

    const hms = value.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (hms) {
      if (hms[3] !== undefined) {
        return parseInt(hms[1], 10) * 60 + parseInt(hms[2], 10) + Math.round(parseInt(hms[3], 10) / 60);
      }
      return parseInt(hms[1], 10) + Math.round(parseInt(hms[2], 10) / 60);
    }

    const mins = value.match(/\b(\d+)\s*min\b/i);
    if (mins) return parseInt(mins[1], 10);
    return null;
  }

  function extractDurationFromMeta() {
    const selectors = [
      'meta[itemprop="duration"]',
      'meta[property="video:duration"]',
      'meta[name="duration"]',
      'meta[property="og:video:duration"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const content = el.getAttribute('content') || '';
      const parsed = parseDurationValue(content);
      if (parsed) return parsed;
    }
    return null;
  }

  function extractDurationFromVideoTag() {
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
    return Math.round(video.duration / 60);
  }

  function extractDurationFromTimeElements() {
    const nodes = Array.from(document.querySelectorAll('time, span, div'))
      .slice(0, 200)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    for (const value of nodes) {
      const parsed = parseDurationValue(value);
      if (parsed) return parsed;
    }
    return null;
  }

  // Get visible text, limit to ~3000 chars for API efficiency
  const body = document.body;
  if (!body) return { text: '', metadata: {} };

  // Remove script, style, nav, footer, header noise
  const clone = body.cloneNode(true);
  const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg'];
  removeTags.forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });

  let text = (clone.innerText || clone.textContent || '').trim();
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ');
  const trimmed = text.substring(0, 3000);

  const metadata = {
    wordCount: countWords(trimmed),
    imageCount: body.querySelectorAll('img').length,
    codeBlockCount: body.querySelectorAll('pre, code').length,
    videoDurationMinutes:
      extractDurationFromMeta() ||
      extractDurationFromVideoTag() ||
      extractDurationFromTimeElements() ||
      null
  };

  return { text: trimmed, metadata };
}

// ---- Initialization ----
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Record the currently active tab when the service worker starts
(async () => {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs.length > 0) {
    currentTabInfo = {
      tabId: tabs[0].id,
      url: tabs[0].url || '',
      title: tabs[0].title || '',
      startTime: Date.now()
    };
  }
})();
