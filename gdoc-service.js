// ============================================================
// TabMind — Google Docs Service
// Handles OAuth2 and Google Docs API interactions.
// ============================================================

const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file'];
const SYNCED_URLS_KEY = 'tabmind_synced_urls';

async function syncToGoogleDoc(suggestions) {
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
  
  if (newSuggestions.length === 0) {
    return { count: 0, status: 'no_new_links' };
  }

  // 3. Find or Create the Discovery Doc
  let docId = configuredDocId;
  if (!docId) {
    docId = await findTabMindDoc(token, configuredTitle);
  }
  
  if (!docId) {
    docId = await createTabMindDoc(token, configuredTitle);
  }

  // 4. Append new content
  await appendToDoc(docId, newSuggestions, token);

  // 5. Update synced list
  const updatedSynced = [...previouslySynced, ...newSuggestions.map(s => s.url)];
  await chrome.storage.local.set({ [SYNCED_URLS_KEY]: updatedSynced });

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
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
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

async function appendToDoc(docId, suggestions, token) {
  const dateStr = new Date().toLocaleDateString();
  const requests = [
    {
      insertText: {
        location: { index: 1 },
        text: `\n\n--- Session: ${dateStr} ---\n`
      }
    }
  ];

  suggestions.forEach(s => {
    requests.push({
      insertText: {
        location: { index: 1 },
        text: `${s.title}\n${s.url}\nNature: ${s.reason}\n\n`
      }
    });
  });

  await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  });
}
