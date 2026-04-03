// ============================================================
// TabMind — Background Service Worker
// Tracks active tab durations and stores browsing history.
// Data is stored in chrome.storage.local with a rolling 7-day window.
// ============================================================

const STORAGE_KEY = 'tabmind_tracking_data';
const MAX_AGE_DAYS = 7;

let currentTabInfo = null; // { tabId, url, title, startTime }

// ---- Lifecycle Events ----

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await recordCurrentAndStart(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && currentTabInfo && currentTabInfo.tabId === tabId) {
    // URL changed on current tab — record previous and restart
    await recordCurrentAndStart(tabId);
  }
});

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
          sendResponse({ text: '' });
        } else {
          sendResponse({ text: results[0].result || '' });
        }
      }
    );
    return true;
  }
});

// Injected function — runs in the tab context
function extractPageText() {
  // Get visible text, limit to ~3000 chars for API efficiency
  const body = document.body;
  if (!body) return '';

  // Remove script, style, nav, footer, header noise
  const clone = body.cloneNode(true);
  const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg'];
  removeTags.forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });

  let text = (clone.innerText || clone.textContent || '').trim();
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ');
  return text.substring(0, 3000);
}

// ---- Initialization ----
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
