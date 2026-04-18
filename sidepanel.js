// ============================================================
// TabMind — Popup Controller
// Coordinates UI events and AI service calls.
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  // Elements
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const views = document.querySelectorAll('.view');
  const btnAnalyzeTabs = document.getElementById('btn-analyze-tabs');
  const apiKeyInput = document.getElementById('api-key');
  const docTitleInput = document.getElementById('doc-title');
  const docIdInput = document.getElementById('doc-id');
  const tabThresholdInput = document.getElementById('tab-threshold');
  const syncInsightsCheckbox = document.getElementById('sync-insights');
  const btnSaveSettings = document.getElementById('save-settings');
  const settingsBtn = document.getElementById('settings-btn');
  const btnSyncGDoc = document.getElementById('btn-sync-gdoc');
  const planMetrics = document.getElementById('plan-metrics');

  window.refreshTimeout = null;

  function showView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));

    document.getElementById(viewId).classList.add('active');
    const navItem = Array.from(navItems).find(n => n.dataset.view === viewId);
    if (navItem) navItem.classList.add('active');

    if (viewId === 'view-insights') loadInsights();
    if (viewId === 'view-suggestions') loadSuggestions();
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });
  settingsBtn.addEventListener('click', () => showView('view-settings'));

  // -- Settings Management --
  chrome.storage.local.get([
    'tabmind_api_key',
    'tabmind_doc_title',
    'tabmind_doc_id',
    'tabmind_tab_threshold',
    'tabmind_sync_insights',
    'tabmind_daily_capacity'
  ], (data) => {
    if (data.tabmind_api_key) apiKeyInput.value = data.tabmind_api_key;
    if (data.tabmind_doc_title) docTitleInput.value = data.tabmind_doc_title;
    if (data.tabmind_doc_id) docIdInput.value = data.tabmind_doc_id;
    if (data.tabmind_tab_threshold) tabThresholdInput.value = data.tabmind_tab_threshold;
    syncInsightsCheckbox.checked = !!data.tabmind_sync_insights;
    hydrateDailyCapacitySettings(data.tabmind_daily_capacity);

    if (!data.tabmind_api_key) showView('view-settings');
  });

  btnSaveSettings.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const title = docTitleInput.value.trim() || 'TabMind Discovery';
    const id = docIdInput.value.trim();
    const threshold = parseInt(tabThresholdInput.value) || 0;
    const syncInsights = syncInsightsCheckbox.checked;
    const dailyCapacity = readDailyCapacitySettings();

    chrome.storage.local.set({
      tabmind_api_key: key,
      tabmind_doc_title: title,
      tabmind_doc_id: id,
      tabmind_tab_threshold: threshold,
      tabmind_sync_insights: syncInsights,
      tabmind_daily_capacity: dailyCapacity
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
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const tabData = [];

      for (const tab of tabs) {
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) continue;
        try {
          const response = await chrome.runtime.sendMessage({ action: 'getTabContent', tabId: tab.id });
          tabData.push({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            content: response.text || '',
            metadata: response.metadata || {}
          });
        } catch (e) {
          console.error(`Failed to read tab ${tab.id}`, e);
          tabData.push({ id: tab.id, title: tab.title, url: tab.url, content: '', metadata: {} });
        }
      }

      const analyzedTabs = await analyzeTabs(tabData);
      const settings = await chrome.storage.local.get('tabmind_daily_capacity');
      const generatedPlan = buildSundayPlan(analyzedTabs, settings.tabmind_daily_capacity || null);
      await chrome.storage.local.set({ tabmind_current_plan: generatedPlan });

      const priorityState = buildPriorityState(analyzedTabs, generatedPlan);
      renderPlanMetrics(priorityState);
      renderTabs(analyzedTabs, priorityState);
    } catch (err) {
      tabListEl.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${err.message}</div>`;
    } finally {
      loadingEl.style.display = 'none';
    }
  });

  function renderTabs(tabList, priorityState = null) {
    const container = document.getElementById('tab-list');
    container.innerHTML = '';
    const rankByUrl = priorityState?.rankByUrl || {};
    const shouldPrioritize = !!priorityState?.shouldPrioritize;

    const ordered = [...tabList].sort((a, b) => {
      if (!shouldPrioritize) return 0;
      const ra = rankByUrl[a.url] || Number.MAX_SAFE_INTEGER;
      const rb = rankByUrl[b.url] || Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });

    ordered.forEach(tab => {
      const card = document.createElement('div');
      card.className = 'tab-card';
      const privacyClass = tab.privacy === 'Private' ? 'badge-private' : 'badge-public';
      const rank = rankByUrl[tab.url];
      const priorityRow = shouldPrioritize && rank ? `<div class="tab-nature">Priority: #${rank}</div>` : '';

      card.innerHTML = `
        <div class="tab-header">
          <div class="tab-info">
            <div class="tab-category">${tab.category}</div>
            <div class="tab-title" title="${tab.title}">${tab.title}</div>
          </div>
          <div class="meta-badges">
            <span class="chip ${privacyClass}">${tab.privacy}</span>
            <span class="chip chip-neutral">${tab.contentType}</span>
          </div>
        </div>
        <div class="tab-nature">${tab.nature}</div>
        <div class="tab-nature">Estimated time: ${formatEstimate(tab)}</div>
        ${priorityRow}
        <button class="btn btn-secondary btn-sm" style="padding: 6px; font-size: 11px; margin-top: 4px;">Jump to Tab</button>
      `;

      card.querySelector('button').addEventListener('click', () => {
        chrome.tabs.query({ url: tab.url }, (matches) => {
          if (matches.length > 0) {
            chrome.tabs.update(matches[0].id, { active: true });
          } else {
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

  function formatEstimate(tab) {
    if (tab.estimateStatus !== 'ok') return 'Data not available';
    const detail = tab.estimateDetail ? ` (${tab.estimateDetail})` : '';
    return `${tab.estimatedMinutes} min${detail}`;
  }

  async function renderPlanMetrics(priorityState = null) {
    if (!planMetrics) return;

    const planState = await chrome.storage.local.get('tabmind_current_plan');
    const plan = planState.tabmind_current_plan;

    if (!plan || !plan.items) {
      planMetrics.innerHTML = `<div class="empty-state" style="padding: 12px 0;">Run analysis to view available vs open content time.</div>`;
      return;
    }

    const availableMinutes = Math.round((plan.availableMinutes || (plan.availableHours || 0) * 60));
    const totalOpenMinutes = priorityState
      ? priorityState.totalOpenMinutes
      : plan.items
          .filter(i => i.estimateStatus === 'ok' && typeof i.estimatedMinutes === 'number')
          .reduce((sum, i) => sum + i.estimatedMinutes, 0);

    planMetrics.innerHTML = `
      <div class="tab-card">
        <div class="tab-category">Time Summary</div>
        <div class="tab-nature">Time Available: ${Math.round((availableMinutes / 60) * 10) / 10}h</div>
        <div class="tab-nature">Total Time of Open Content: ${Math.round((totalOpenMinutes / 60) * 10) / 10}h</div>
      </div>
    `;
  }

  function buildPriorityState(tabList, plan) {
    const availableMinutes = Math.round((plan?.availableMinutes || (plan?.availableHours || 0) * 60));
    const eligible = tabList
      .filter(tab => tab.eligibleForPlan && tab.estimateStatus === 'ok' && typeof tab.estimatedMinutes === 'number');
    const totalOpenMinutes = eligible.reduce((sum, tab) => sum + tab.estimatedMinutes, 0);
    const shouldPrioritize = totalOpenMinutes > availableMinutes;
    const rankByUrl = {};

    if (shouldPrioritize) {
      eligible
        .sort((a, b) => {
          const impactDiff = getImpactScore(b) - getImpactScore(a);
          if (impactDiff !== 0) return impactDiff;
          return (a.estimatedMinutes || 0) - (b.estimatedMinutes || 0);
        })
        .forEach((tab, idx) => {
          rankByUrl[tab.url] = idx + 1;
        });
    }

    return { availableMinutes, totalOpenMinutes, shouldPrioritize, rankByUrl };
  }

  function getImpactScore(tab) {
    const text = `${tab.category || ''} ${tab.nature || ''} ${tab.title || ''}`.toLowerCase();
    let score = 0;

    const highImpactTerms = [
      'research', 'technical', 'tutorial', 'learning', 'documentation',
      'architecture', 'api', 'engineering', 'development', 'study'
    ];
    const mediumImpactTerms = ['analysis', 'guide', 'reference', 'productivity', 'news'];
    const lowImpactTerms = ['entertainment', 'fun', 'music', 'movie', 'meme', 'social'];

    highImpactTerms.forEach((term) => { if (text.includes(term)) score += 3; });
    mediumImpactTerms.forEach((term) => { if (text.includes(term)) score += 1; });
    lowImpactTerms.forEach((term) => { if (text.includes(term)) score -= 2; });

    if (tab.contentType === 'Blog') score += 2;
    if (tab.contentType === 'Video') score += 1;

    return score;
  }

  function readDailyCapacitySettings() {
    const data = {};
    dayKeys.forEach((day) => {
      const hoursInput = document.getElementById(`hours-${day}`);
      const offInput = document.getElementById(`off-${day}`);
      data[day] = {
        hours: Math.max(0, Number(hoursInput?.value || 0)),
        off: !!offInput?.checked
      };
    });
    return data;
  }

  function hydrateDailyCapacitySettings(stored) {
    const defaults = {
      monday: { hours: 2, off: false },
      tuesday: { hours: 2, off: false },
      wednesday: { hours: 2, off: false },
      thursday: { hours: 2, off: false },
      friday: { hours: 2, off: false },
      saturday: { hours: 4, off: false },
      sunday: { hours: 4, off: false }
    };

    dayKeys.forEach((day) => {
      const cfg = (stored && stored[day]) || defaults[day];
      const hoursInput = document.getElementById(`hours-${day}`);
      const offInput = document.getElementById(`off-${day}`);
      if (!hoursInput || !offInput) return;
      hoursInput.value = Number.isFinite(Number(cfg.hours)) ? Number(cfg.hours) : defaults[day].hours;
      offInput.checked = !!cfg.off;
      hoursInput.disabled = offInput.checked;
      offInput.addEventListener('change', () => {
        hoursInput.disabled = offInput.checked;
        if (offInput.checked) hoursInput.value = 0;
      });
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
      document.getElementById('habits-text').innerText = insights.summary;
      renderWeeklyHistogram(insights.weeklyHistogram || []);

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

  function renderWeeklyHistogram(histogramData) {
    const container = document.getElementById('weekly-histogram');
    if (!container) return;
    container.innerHTML = '';
    if (!histogramData.length) {
      container.innerHTML = '<div class="tab-nature">No weekly data yet.</div>';
      return;
    }

    const maxHours = Math.max(...histogramData.map(i => i.hours), 1);
    histogramData.forEach((bucket, idx) => {
      const bar = document.createElement('div');
      bar.className = 'histogram-bar-wrap';
      const weekLabel = idx === histogramData.length - 1 ? 'Current week' : `Week -${histogramData.length - 1 - idx}`;
      const pct = Math.max(8, Math.round((bucket.hours / maxHours) * 100));
      bar.innerHTML = `
        <div class="histogram-label">${weekLabel} (${bucket.label})</div>
        <div class="histogram-bar-bg">
          <div class="histogram-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="histogram-value">${bucket.hours}h</div>
      `;
      container.appendChild(bar);
    });
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

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'refreshAnalysis') {
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav && activeNav.dataset.view === 'view-tabs') {
        clearTimeout(window.refreshTimeout);
        window.refreshTimeout = setTimeout(() => btnAnalyzeTabs.click(), 5000);
      }
    }
  });

  // -- Google Docs Sync --
  btnSyncGDoc.addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to end your session and push discovery findings to Google Docs?');
    if (!confirmed) return;

    btnSyncGDoc.disabled = true;
    btnSyncGDoc.innerText = '⌛ Syncing...';

    try {
      const trackingResponse = await chrome.runtime.sendMessage({ action: 'getTrackingData' });
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      const suggestions = await generateSuggestions(trackingResponse.data, currentTabs);

      let insights = null;
      const settings = await chrome.storage.local.get('tabmind_sync_insights');
      if (settings.tabmind_sync_insights) insights = await generateInsights(trackingResponse.data);

      const planState = await chrome.storage.local.get('tabmind_current_plan');
      const result = await syncToGoogleDoc(suggestions, insights, planState.tabmind_current_plan || null, trackingResponse.data || []);

      if (result.count > 0 || (insights && result.status === 'success')) {
        alert('Successfully synced discovery links and weekly summary to "TabMind Discovery" Google Doc!');
      } else {
        alert('No new unique content found to sync.');
      }
    } catch (err) {
      console.error(err);
      alert(`Sync failed: ${err.message}. Make sure you've configured your OAuth Client ID in manifest.json.`);
    } finally {
      btnSyncGDoc.disabled = false;
      btnSyncGDoc.innerText = '📂 End Session & Sync to Google Doc';
    }
  });

  renderPlanMetrics();
});

