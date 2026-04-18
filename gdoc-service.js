// ============================================================
// TabMind — Google Docs Service
// Handles OAuth2 and Google Docs API interactions.
// ============================================================

const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file'];
const SYNCED_URLS_KEY = 'tabmind_synced_urls';

async function syncToGoogleDoc(suggestions, insights = null, plan = null, trackingData = []) {
  // 0. Get user settings
  const settings = await chrome.storage.local.get(['tabmind_doc_title', 'tabmind_doc_id']);
  const configuredTitle = settings.tabmind_doc_title || 'TabMind Discovery';
  const configuredDocId = settings.tabmind_doc_id;

  // 1. Get OAuth Token
  const token = await getAuthToken();
  if (!token) throw new Error("Could not obtain Google OAuth token.");

  // 2. Filter out already synced URLs
  const syncedData = await chrome.storage.local.get(SYNCED_URLS_KEY);
  const previouslySynced = syncedData[SYNCED_URLS_KEY] || [];
  
  const newSuggestions = suggestions.filter(s => !previouslySynced.includes(s.url));
  
  if (newSuggestions.length === 0 && !insights) {
    return { count: 0, status: 'no_new_content' };
  }

  // 3. Find or Create the Discovery Doc
  let docId = configuredDocId;
  if (!docId) {
    docId = await findTabMindDoc(token, configuredTitle);
  }
  
  if (!docId) {
    docId = await createTabMindDoc(token, configuredTitle);
  }
  if (docId && configuredDocId !== docId) {
    await chrome.storage.local.set({ tabmind_doc_id: docId });
  }

  // 4. Append new content
  await appendToDoc(docId, newSuggestions, insights, plan, trackingData, token);

  // 5. Update synced list
  if (newSuggestions.length > 0) {
    const updatedSynced = [...previouslySynced, ...newSuggestions.map(s => s.url)];
    await chrome.storage.local.set({ [SYNCED_URLS_KEY]: updatedSynced });
  }

  return { count: newSuggestions.length, status: 'success' };
}

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

async function findTabMindDoc(token, title) {
  const query = encodeURIComponent(`name="${title}" and mimeType="application/vnd.google-apps.document" and trashed=false`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=1&orderBy=modifiedTime desc`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  return data.files?.[0]?.id || null;
}

async function createTabMindDoc(token, title) {
  const response = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: title })
  });
  const data = await response.json();
  return data.documentId;
}

async function appendToDoc(docId, suggestions, insights, plan, trackingData, token) {
  const dateStr = new Date().toLocaleDateString();
  const endIndex = await getDocumentEndIndex(docId, token);
  let sessionText = `\n\n=========================================\nSESSION SYNC: ${dateStr}\n=========================================\n`;

  // 1. Append Insights (if enabled and provided)
  if (insights) {
    const insightText =
      `\n[WEEKLY PRODUCTIVITY SUMMARY]\n` +
      `Trends: ${insights.summary}\n` +
      `Productivity: ${insights.productivityScore}/100 (${insights.productivityLabel})\n` +
      `Top Focus: ${insights.topCategories.map(c => `${c.name} (${c.percentage}%)`).join(', ')}\n` +
      `Fun Facts: ${insights.funFacts.join(' • ')}\n`;
    sessionText += insightText;

    if (Array.isArray(insights.weeklyHistogram) && insights.weeklyHistogram.length) {
      sessionText += `\n[WEEKLY TIME TABLE]\n`;
      sessionText += `Week Range | Chrome Time (hrs)\n`;
      sessionText += `-----------|------------------\n`;
      insights.weeklyHistogram.forEach((w) => {
        sessionText += `${w.label} | ${w.hours}\n`;
      });
    }
  }

  if (plan && Array.isArray(plan.items)) {
    const plannedItems = plan.items.filter(i => i.planned);
    const expectedMinutes = plannedItems.reduce((sum, i) => sum + (i.estimatedMinutes || 0), 0);
    const plannedUrls = plannedItems.map(i => i.url).filter(Boolean);
    const actualSuggestedMinutes = Math.round(
      (trackingData || [])
        .filter(e => e.timestamp >= (plan.generatedAt || 0) && plannedUrls.some(url => e.url && e.url.startsWith(url)))
        .reduce((sum, e) => sum + (e.duration || 0), 0) / 60000
    );
    const chromeMinutes = Math.round(
      (trackingData || [])
        .filter(e => e.timestamp >= (plan.generatedAt || 0))
        .reduce((sum, e) => sum + (e.duration || 0), 0) / 60000
    );
    const successPct = expectedMinutes > 0 ? Math.min(100, Math.round((actualSuggestedMinutes / expectedMinutes) * 100)) : 0;

    sessionText += `\n[PLAN TRACKER TABLE]\n`;
    sessionText += `Metric | Value\n`;
    sessionText += `-------|------\n`;
    sessionText += `Available till Sunday (hrs) | ${plan.availableHours || 0}\n`;
    sessionText += `Planned content time (hrs) | ${((plan.plannedMinutes || 0) / 60).toFixed(1)}\n`;
    sessionText += `Overall Chrome time since plan (hrs) | ${(chromeMinutes / 60).toFixed(1)}\n`;
    sessionText += `Suggested content actual (hrs) | ${(actualSuggestedMinutes / 60).toFixed(1)}\n`;
    sessionText += `Suggested content expected (hrs) | ${(expectedMinutes / 60).toFixed(1)}\n`;
    sessionText += `Plan success (%) | ${successPct}\n`;
  }

  // 2. Append Discovery Suggestions
  if (suggestions.length > 0) {
    let suggestionsText = `\n[DISCOVERY FINDINGS]\n`;
    suggestions.forEach(s => {
      suggestionsText += `• ${s.title}\n  URL: ${s.url}\n  Why: ${s.reason}\n\n`;
    });
    sessionText += suggestionsText;
  }

  if (!sessionText.trim()) return;

  await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        insertText: {
          location: { index: endIndex },
          text: sessionText
        }
      }]
    })
  });
}

async function getDocumentEndIndex(docId, token) {
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  const endIndex = data?.body?.content?.[data.body.content.length - 1]?.endIndex;
  return Math.max(1, (endIndex || 2) - 1);
}
