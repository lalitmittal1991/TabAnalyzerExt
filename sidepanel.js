// ============================================================
// TabMind — Popup Controller
// Coordinates UI events and AI service calls.
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const views = document.querySelectorAll('.view');
  const btnAnalyzeTabs = document.getElementById('btn-analyze-tabs');
  const apiKeyInput = document.getElementById('api-key');
  const docTitleInput = document.getElementById('doc-title');
  const docIdInput = document.getElementById('doc-id');
  const btnSaveSettings = document.getElementById('save-settings');
  const settingsBtn = document.getElementById('settings-btn');
  const btnSyncGDoc = document.getElementById('btn-sync-gdoc');
  
  window.refreshTimeout = null;
  
  // -- View Switching --
  function showView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));
    
    document.getElementById(viewId).classList.add('active');
    const navItem = Array.from(navItems).find(n => n.dataset.view === viewId);
    if (navItem) navItem.classList.add('active');

    // Trigger auto-load for certain views
    if (viewId === 'view-insights') loadInsights();
    if (viewId === 'view-suggestions') loadSuggestions();
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });

  settingsBtn.addEventListener('click', () => showView('view-settings'));

  // -- Settings Management --
  chrome.storage.local.get(['tabmind_api_key', 'tabmind_doc_title', 'tabmind_doc_id'], (data) => {
    if (data.tabmind_api_key) apiKeyInput.value = data.tabmind_api_key;
    if (data.tabmind_doc_title) docTitleInput.value = data.tabmind_doc_title;
    if (data.tabmind_doc_id) docIdInput.value = data.tabmind_doc_id;

    if (!data.tabmind_api_key) {
      showView('view-settings');
    }
  });

  btnSaveSettings.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const title = docTitleInput.value.trim() || 'TabMind Discovery';
    const id = docIdInput.value.trim();

    chrome.storage.local.set({ 
      'tabmind_api_key': key,
      'tabmind_doc_title': title,
      'tabmind_doc_id': id
    }, () => {
      const status = document.getElementById('save-status');
      status.innerText = 'Settings saved permanently!';
      status.style.color = 'var(--success)';
      setTimeout(() => { status.innerText = ''; }, 3000);
    });
  });

  // -- Tab Analysis --
  btnAnalyzeTabs.addEventListener('click', async () => {
    const tabListEl = document.getElementById('tab-list');
    const loadingEl = document.getElementById('loading-tabs');
    
    tabListEl.innerHTML = '';
    loadingEl.style.display = 'flex';

    try {
      // 1. Get all open tabs
      const tabs = await chrome.tabs.query({ currentWindow: true });
      
      // 2. Extract content from each tab (limit to active/recent for performance)
      const tabData = [];
      for (const tab of tabs) {
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) continue;
        
        try {
          // Send message to content script or use executeScript
          const response = await chrome.runtime.sendMessage({ action: 'getTabContent', tabId: tab.id });
          tabData.push({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            content: response.text || ''
          });
        } catch (e) {
          console.error(`Failed to read tab ${tab.id}`, e);
          tabData.push({ id: tab.id, title: tab.title, url: tab.url, content: '' });
        }
      }

      // 3. Call AI service
      const analyzedTabs = await analyzeTabs(tabData);
      
      // 4. Render
      renderTabs(analyzedTabs);
    } catch (err) {
      tabListEl.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${err.message}</div>`;
    } finally {
      loadingEl.style.display = 'none';
    }
  });

  function renderTabs(tabList) {
    const container = document.getElementById('tab-list');
    container.innerHTML = '';

    tabList.forEach(tab => {
      const card = document.createElement('div');
      card.className = 'tab-card';
      
      const priorityClass = tab.priority >= 8 ? 'priority-high' : tab.priority >= 5 ? 'priority-med' : 'priority-low';
      
      card.innerHTML = `
        <div class="tab-header">
          <div class="tab-info">
            <div class="tab-category">${tab.category}</div>
            <div class="tab-title" title="${tab.title}">${tab.title}</div>
          </div>
          <div class="priority-badge ${priorityClass}">${tab.priority}/10</div>
        </div>
        <div class="tab-nature">${tab.nature}</div>
        <button class="btn btn-secondary btn-sm" style="padding: 6px; font-size: 11px; margin-top: 4px;">Jump to Tab</button>
      `;

      card.querySelector('button').addEventListener('click', () => {
        // Find matching tab in current window
        chrome.tabs.query({ url: tab.url }, (matches) => {
          if (matches.length > 0) {
            chrome.tabs.update(matches[0].id, { active: true });
          } else {
            // Fallback to title matching if URL changed slightly
            chrome.tabs.query({}, (all) => {
               const match = all.find(t => t.title === tab.title);
               if (match) chrome.tabs.update(match.id, { active: true });
            });
          }
        });
      });

      container.appendChild(card);
    });
  }

  // -- Insights Loading --
  async function loadInsights() {
    const content = document.getElementById('insights-content');
    const loading = document.getElementById('loading-insights');
    const empty = document.getElementById('empty-insights');

    content.style.display = 'none';
    loading.style.display = 'flex';
    empty.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'getTrackingData' });
      const data = response.data;

      if (!data || data.length < 5) {
        empty.style.display = 'block';
        loading.style.display = 'none';
        return;
      }

      const insights = await generateInsights(data);
      
      document.getElementById('prod-score').innerText = insights.productivityScore;
      document.getElementById('prod-label').innerText = insights.productivityLabel;
      document.getElementById('habits-text').innerText = insights.summary;

      // Render Categories
      const chart = document.getElementById('category-chart');
      chart.innerHTML = '';
      insights.topCategories.forEach(cat => {
        const row = document.createElement('div');
        row.className = 'category-row';
        row.innerHTML = `
          <div class="category-meta">
            <span>${cat.name}</span>
            <span>${cat.percentage}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${cat.percentage}%"></div>
          </div>
        `;
        chart.appendChild(row);
      });

      // Render Fun Facts
      const factsContainer = document.getElementById('fun-facts');
      factsContainer.innerHTML = '';
      insights.funFacts.forEach(fact => {
        const item = document.createElement('div');
        item.className = 'tab-card';
        item.style.padding = '10px';
        item.innerHTML = `<div class="tab-nature" style="color: var(--text-primary)">✨ ${fact}</div>`;
        factsContainer.appendChild(item);
      });

      content.style.display = 'block';
    } catch (err) {
      console.error(err);
    } finally {
      loading.style.display = 'none';
    }
  }

  // -- Suggestions Loading --
  async function loadSuggestions() {
    const container = document.getElementById('suggestions-list');
    const loading = document.getElementById('loading-suggestions');
    const empty = document.getElementById('empty-suggestions');

    container.innerHTML = '';
    loading.style.display = 'flex';
    empty.style.display = 'none';

    try {
      const trackingResponse = await chrome.runtime.sendMessage({ action: 'getTrackingData' });
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      
      const suggestions = await generateSuggestions(trackingResponse.data, currentTabs);
      
      suggestions.forEach(s => {
        const card = document.createElement('div');
        card.className = 'tab-card';
        card.innerHTML = `
          <div class="tab-header">
            <div class="tab-info">
              <div class="tab-category">${s.category}</div>
              <div class="tab-title">${s.title}</div>
              <div style="font-size: 11px; color: var(--accent-secondary)">${s.source}</div>
            </div>
          </div>
          <div class="tab-nature">${s.reason}</div>
          <button class="btn btn-secondary btn-sm" style="padding: 6px; font-size: 11px; margin-top: 8px;">Explore Resource</button>
        `;
        card.querySelector('button').addEventListener('click', () => window.open(s.url, '_blank'));
        container.appendChild(card);
      });

    } catch (err) {
      console.error(err);
      empty.innerHTML = `<span style="color: var(--danger)">Error: ${err.message}</span>`;
      empty.style.display = 'block';
    } finally {
      loading.style.display = 'none';
    }
  }
  // -- Auto-refresh Listener (from Background) --
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshAnalysis') {
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav && activeNav.dataset.view === 'view-tabs') {
        clearTimeout(window.refreshTimeout);
        window.refreshTimeout = setTimeout(() => {
          btnAnalyzeTabs.click();
        }, 5000); // 5s delay to ensure user has settled on tab
      }
    }
  });

  // -- Google Docs Sync --
  btnSyncGDoc.addEventListener('click', async () => {
    const confirmed = confirm("Are you sure you want to end your session and push discovery findings to Google Docs?");
    if (!confirmed) return;

    btnSyncGDoc.disabled = true;
    btnSyncGDoc.innerText = '⌛ Syncing...';

    try {
      const trackingResponse = await chrome.runtime.sendMessage({ action: 'getTrackingData' });
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      const suggestions = await generateSuggestions(trackingResponse.data, currentTabs);
      
      const result = await syncToGoogleDoc(suggestions);
      
      if (result.count > 0) {
        alert(`Successfully synced ${result.count} new links to "TabMind Discovery" Google Doc!`);
      } else {
        alert("No new unique links found to sync.");
      }
    } catch (err) {
      console.error(err);
      alert(`Sync failed: ${err.message}. Make sure you've configured your OAuth Client ID in manifest.json.`);
    } finally {
      btnSyncGDoc.disabled = false;
      btnSyncGDoc.innerText = '📂 End Session & Sync to Google Doc';
    }
  });
});

