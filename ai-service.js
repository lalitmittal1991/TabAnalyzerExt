// ============================================================
// TabMind — AI Service
// Handles all interactions with the Gemini API.
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function getApiKey() {
  const result = await chrome.storage.local.get('tabmind_api_key');
  return result.tabmind_api_key || '';
}

async function callGemini(prompt) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API key not configured. Please set your Gemini API key in Settings.');
  }

  const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini API.');

  try {
    return JSON.parse(text);
  } catch {
    // If JSON parse fails, return raw text wrapped
    return { raw: text };
  }
}

// ---- Prompt Builders ----

async function analyzeTabs(tabs) {
  const tabSummaries = tabs.map((t, i) => `Tab ${i + 1}:\n  Title: ${t.title}\n  URL: ${t.url}\n  Content Snippet: ${(t.content || '').substring(0, 500)}`).join('\n\n');

  const prompt = `You are an intelligent browsing assistant. Analyze the following open browser tabs and for each tab provide:
1. "tabIndex" (number, 1-based matching input)
2. "title" (string)
3. "url" (string)
4. "category" (string — e.g. "News", "Social Media", "Learning", "Development", "Entertainment", "Shopping", "Productivity", "Communication", "Research", "Other")
5. "nature" (string — brief description of what the content is about)

Return ONLY a JSON array of objects with the above fields.

Here are the tabs:

${tabSummaries}`;

  const aiTabs = await callGemini(prompt);
  const normalized = Array.isArray(aiTabs) ? aiTabs : [];
  return normalized.map((tab, index) => {
    const source = tabs[index] || {};
    const safeUrl = tab.url || source.url || '';
    const metadata = source.metadata || {};
    const privacy = getPrivacyTag(safeUrl);
    const category = tab.category || inferCategoryFromUrl(safeUrl);
    const nature = tab.nature || 'Context unavailable';
    const planEstimate = getPlanEstimate({
      url: safeUrl,
      category,
      nature,
      metadata
    });

    return {
      tabIndex: tab.tabIndex || index + 1,
      title: tab.title || source.title || 'Untitled',
      url: safeUrl,
      category,
      nature,
      privacy,
      popularity: privacy === 'Public' ? estimatePopularityTier(safeUrl) : 'N/A',
      contentType: planEstimate.contentType,
      estimatedMinutes: planEstimate.estimatedMinutes,
      estimateStatus: planEstimate.status,
      estimateDetail: planEstimate.detail,
      estimateSource: planEstimate.source,
      eligibleForPlan: planEstimate.eligibleForPlan
    };
  });
}

async function generateInsights(trackingData) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  
  const currentWeek = trackingData.filter(e => e.timestamp > now - weekMs);
  const pastWeek = trackingData.filter(e => e.timestamp <= now - weekMs && e.timestamp > now - 2 * weekMs);
  
  const currentSummary = summarizeData(currentWeek);
  const pastSummary = summarizeData(pastWeek);

  const prompt = `You are an intelligent browsing analyst. Compare the user's browsing activity from THIS WEEK (last 7 days) against LAST WEEK (days 8-14).
Focus on "Time Productivity" and "Diversity of Topics". Highlight specific trends, growth, or shifts (e.g. "spending 20% more time on educational content this week than last").

Provide:
1. "summary" (string — dynamic comparison of this week vs last week habits)
2. "topCategories" (array of objects with "name" and "percentage" for THIS week)
3. "productivityScore" (number 1-100 for THIS week)
4. "productivityLabel" (string — e.g. "Improving", "Highly Focused", "Diversifying")
5. "funFacts" (array of 3 short facts comparing weeks — e.g. "New topic alert!", "Development time is up!")
6. "tips" (array of 2-3 actionable tips based on these trends)

Return ONLY a JSON object with the above fields.

THIS WEEK (Summary):
${currentSummary}

LAST WEEK (Summary):
${pastSummary.length > 0 ? pastSummary : "Not enough historical data for last week yet."}`;

  const aiInsights = await callGemini(prompt);
  return {
    ...aiInsights,
    weeklyHistogram: buildWeeklyHistogram(trackingData)
  };
}

function summarizeData(data) {
  const domainMap = {};
  data.forEach(entry => {
    const d = entry.domain || 'unknown';
    if (!domainMap[d]) domainMap[d] = { time: 0, titles: new Set() };
    domainMap[d].time += entry.duration;
    domainMap[d].titles.add(entry.title);
  });

  return Object.entries(domainMap)
    .sort((a, b) => b[1].time - a[1].time)
    .slice(0, 15)
    .map(([domain, info]) => `- ${domain}: ${Math.round(info.time / 1000)}s (Sample: ${Array.from(info.titles).slice(0, 2).join(', ')})`)
    .join('\n');
}

async function generateSuggestions(trackingData, currentTabs) {
  const interestMap = {};
  trackingData.forEach(entry => {
    const d = entry.domain || 'unknown';
    if (!interestMap[d]) interestMap[d] = 0;
    interestMap[d] += entry.duration;
  });

  const topInterests = Object.entries(interestMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domain, time]) => `${domain} (${Math.round(time / 60000)} mins)`)
    .join(', ');

  const currentTabTitles = currentTabs.map(t => t.title).join(', ');

  const prompt = `You are an intelligent content curator. Based on the user's deep interests from the LAST 14 DAYS and their currently open tabs, suggest 5 high-quality reading resources.
Focus more on their long-term patterns and core interests rather than just immediate activity.

Core Interests (Summary): ${topInterests}
Recently/Currently Open: ${currentTabTitles}

Provide exactly 5 suggestions. For each:
1. "title" (string — catchy title)
2. "url" (string — actual working URL to a real resource)
3. "source" (string — the publication name)
4. "reason" (string — why this matches their full week profile)
5. "category" (string — e.g. "Deep Dive", "Tutorial", "Weekly Find")

Return ONLY a JSON array of 5 suggestion objects.`;

  return await callGemini(prompt);
}

function getPrivacyTag(url) {
  const privateHosts = [
    'mail.google.com',
    'drive.google.com',
    'docs.google.com',
    'calendar.google.com',
    'meet.google.com',
    'localhost',
    '127.0.0.1'
  ];
  const host = getHostname(url);
  if (privateHosts.some(h => host === h || host.endsWith(`.${h}`))) return 'Private';
  if (host.includes('jupyter') || url.includes('/lab') || url.includes('/notebooks/')) return 'Private';
  return 'Public';
}

function estimatePopularityTier(url) {
  const host = getHostname(url);
  const high = ['youtube.com', 'github.com', 'wikipedia.org', 'stackoverflow.com', 'medium.com'];
  const medium = ['substack.com', 'dev.to', 'coursera.org', 'udemy.com', 'nytimes.com', 'bbc.com'];
  if (high.some(d => host === d || host.endsWith(`.${d}`))) return 'High';
  if (medium.some(d => host === d || host.endsWith(`.${d}`))) return 'Medium';
  return 'Low';
}

function getPlanEstimate({ url, category, nature, metadata }) {
  const contentType = classifyPlanningContentType(url, category, nature);
  if (contentType === 'Other') {
    return {
      contentType: 'Other',
      eligibleForPlan: false,
      status: 'excluded',
      detail: 'Not in planning scope (only YouTube/Blog)',
      source: 'n/a',
      estimatedMinutes: null
    };
  }

  if (contentType === 'Video') {
    const videoMinutes = toNumber(metadata.videoDurationMinutes);
    if (!videoMinutes || videoMinutes <= 0) {
      return {
        contentType: 'Video',
        eligibleForPlan: true,
        status: 'unavailable',
        detail: 'Video length metadata not available',
        source: 'metadata',
        estimatedMinutes: null
      };
    }
    return {
      contentType: 'Video',
      eligibleForPlan: true,
      status: 'ok',
      detail: `Video ${videoMinutes}m + 20% buffer`,
      source: 'metadata',
      estimatedMinutes: Math.ceil(videoMinutes * 1.2)
    };
  }

  const wordCount = toNumber(metadata.wordCount);
  const imageCount = toNumber(metadata.imageCount);
  const codeBlockCount = toNumber(metadata.codeBlockCount);
  if (wordCount <= 0) {
    return {
      contentType: 'Blog',
      eligibleForPlan: true,
      status: 'unavailable',
      detail: 'Blog content metrics not available',
      source: 'page-scan',
      estimatedMinutes: null
    };
  }

  const technical = isTechnicalNature(nature, category, url);
  const wpm = technical ? 150 : 250;
  const seconds = (wordCount / wpm) * 60 + (imageCount * 3) + (codeBlockCount * 10);
  return {
    contentType: 'Blog',
    eligibleForPlan: true,
    status: 'ok',
    detail: `${technical ? 'Technical' : 'General'} @ ${wpm} WPM`,
    source: 'formula',
    estimatedMinutes: Math.max(1, Math.ceil(seconds / 60))
  };
}

function classifyPlanningContentType(url, category, nature) {
  const host = getHostname(url);
  const lowerNature = (nature || '').toLowerCase();
  const lowerCategory = (category || '').toLowerCase();
  const isVideo =
    host.includes('youtube.com') ||
    host.includes('youtu.be') ||
    host.includes('vimeo.com') ||
    lowerCategory.includes('video') ||
    lowerNature.includes('video') ||
    lowerNature.includes('watch');
  if (isVideo) return 'Video';

  const blogSignals = [
    '/blog', '/article', '/post', 'medium.com', 'substack.com', 'dev.to', 'hashnode.com'
  ];
  const isBlog =
    blogSignals.some(s => url.toLowerCase().includes(s)) ||
    lowerCategory.includes('news') ||
    lowerCategory.includes('research') ||
    lowerNature.includes('article') ||
    lowerNature.includes('blog') ||
    lowerNature.includes('read');
  return isBlog ? 'Blog' : 'Other';
}

function isTechnicalNature(nature, category, url) {
  const text = `${nature || ''} ${category || ''} ${url || ''}`.toLowerCase();
  const technicalTerms = [
    'technical', 'research', 'tutorial', 'api', 'engineering', 'code', 'programming',
    'documentation', 'architecture', 'machine learning', 'ai', 'data science'
  ];
  return technicalTerms.some(term => text.includes(term));
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function inferCategoryFromUrl(url) {
  const host = getHostname(url);
  if (host.includes('github')) return 'Development';
  if (host.includes('youtube') || host.includes('netflix')) return 'Entertainment';
  if (host.includes('docs') || host.includes('drive')) return 'Productivity';
  if (host.includes('news') || host.includes('times')) return 'News';
  return 'Research';
}

function buildWeeklyHistogram(trackingData) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentWeekStart = new Date(startOfToday);
  currentWeekStart.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));

  const buckets = [];
  for (let i = 2; i >= 0; i--) {
    const start = new Date(currentWeekStart);
    start.setDate(currentWeekStart.getDate() - (i * 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startMs = start.getTime();
    const endMs = end.getTime() + (24 * 60 * 60 * 1000 - 1);
    const minutes = Math.round(
      trackingData
        .filter(e => e.timestamp >= startMs && e.timestamp <= endMs)
        .reduce((sum, e) => sum + (e.duration || 0), 0) / 60000
    );
    const hours = minutes === 0 ? 0 : Number((minutes / 60).toFixed(1));
    buckets.push({
      label: `${formatDDMM(start)}-${formatDDMM(end)}`,
      minutes,
      hours
    });
  }
  return buckets;
}

function formatDDMM(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getHoursUntilUpcomingSunday(config, now = new Date()) {
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  let totalHours = 0;
  for (let i = 0; i <= daysUntilSunday; i++) {
    const cursor = new Date(now);
    cursor.setDate(now.getDate() + i);
    totalHours += getConfiguredDailyHours(cursor.getDay(), config);
  }
  return totalHours;
}

function buildSundayPlan(tabs, dailyCapacityConfig = null) {
  const now = new Date();
  const planConfig = withDefaultDailyCapacity(dailyCapacityConfig);
  const availableHours = getHoursUntilUpcomingSunday(planConfig, now);
  const availableMinutes = availableHours * 60;
  const candidates = [...tabs]
    .filter(tab => tab.eligibleForPlan)
    .sort((a, b) => (a.privacy === 'Public' ? -1 : 1));

  let usedMinutes = 0;
  const items = candidates.map((tab) => {
    const canEstimate = tab.estimateStatus === 'ok' && typeof tab.estimatedMinutes === 'number';
    const canFit = canEstimate && (usedMinutes + tab.estimatedMinutes <= availableMinutes);
    if (canFit) usedMinutes += tab.estimatedMinutes;
    return {
      title: tab.title,
      url: tab.url,
      estimatedMinutes: tab.estimatedMinutes,
      estimateStatus: tab.estimateStatus,
      estimateDetail: tab.estimateDetail,
      contentType: tab.contentType,
      planned: canFit,
      privacy: tab.privacy
    };
  });

  return {
    generatedAt: Date.now(),
    dailyCapacityConfig: planConfig,
    availableHours,
    availableMinutes,
    plannedMinutes: usedMinutes,
    items
  };
}

function withDefaultDailyCapacity(config) {
  const fallback = {
    monday: { hours: 2, off: false },
    tuesday: { hours: 2, off: false },
    wednesday: { hours: 2, off: false },
    thursday: { hours: 2, off: false },
    friday: { hours: 2, off: false },
    saturday: { hours: 4, off: false },
    sunday: { hours: 4, off: false }
  };
  const safe = config || {};
  const merged = {};
  Object.keys(fallback).forEach((day) => {
    const dayConfig = safe[day] || {};
    merged[day] = {
      hours: Math.max(0, Number.isFinite(Number(dayConfig.hours)) ? Number(dayConfig.hours) : fallback[day].hours),
      off: Boolean(dayConfig.off)
    };
  });
  return merged;
}

function getConfiguredDailyHours(jsDay, config) {
  const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const key = map[jsDay] || 'monday';
  const day = config[key];
  if (!day || day.off) return 0;
  return Math.max(0, Number(day.hours) || 0);
}
