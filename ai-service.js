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
6. "priority" (number 1-10, where 10 = highest priority / most productive or important)
7. "priorityReason" (string — why this priority was assigned)

Sort the output array by priority descending (highest first).

Return ONLY a JSON array of objects with the above fields.

Here are the tabs:

${tabSummaries}`;

  return await callGemini(prompt);
}

async function generateInsights(trackingData) {
  // Summarize tracking data by domain
  const domainMap = {};
  trackingData.forEach(entry => {
    const d = entry.domain || 'unknown';
    if (!domainMap[d]) {
      domainMap[d] = { totalTime: 0, visits: 0, titles: new Set() };
    }
    domainMap[d].totalTime += entry.duration;
    domainMap[d].visits += 1;
    domainMap[d].titles.add(entry.title);
  });

  const summary = Object.entries(domainMap)
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 20)
    .map(([domain, info]) => `Domain: ${domain}\n  Total Time: ${Math.round(info.totalTime / 1000)}s\n  Visits: ${info.visits}\n  Sample Titles: ${[...info.titles].slice(0, 3).join(', ')}`)
    .join('\n\n');

  const prompt = `You are an intelligent browsing analyst. Based on the following 7-day browsing activity summary, generate personalized insights about the user.

Provide:
1. "summary" (string — a 2-3 sentence overview of their browsing habits)
2. "topCategories" (array of objects with "name" and "percentage" — estimated time distribution across categories like News, Social Media, Learning, Development, Entertainment, etc.)
3. "productivityScore" (number 1-100 — how productive their browsing has been)
4. "productivityLabel" (string — e.g. "Highly Productive", "Balanced", "Distracted")
5. "funFacts" (array of 3 short fun observations about their browsing)
6. "tips" (array of 2-3 actionable tips to improve browsing habits)

Return ONLY a JSON object with the above fields.

Browsing Activity (last 7 days):

${summary}`;

  return await callGemini(prompt);
}

async function generateSuggestions(trackingData, currentTabs) {
  const interests = {};
  trackingData.forEach(entry => {
    const d = entry.domain || 'unknown';
    if (!interests[d]) interests[d] = { time: 0, titles: [] };
    interests[d].time += entry.duration;
    if (interests[d].titles.length < 3) interests[d].titles.push(entry.title);
  });

  const topInterests = Object.entries(interests)
    .sort((a, b) => b[1].time - a[1].time)
    .slice(0, 10)
    .map(([domain, info]) => `${domain}: ${info.titles.join(', ')}`)
    .join('\n');

  const currentTabTitles = currentTabs.map(t => t.title).join(', ');

  const prompt = `You are an intelligent content curator. Based on the user's browsing interests and currently open tabs, suggest excellent further reading resources.

User's top interests (by time spent):
${topInterests}

Currently open tabs: ${currentTabTitles}

Provide exactly 5 suggestions. For each:
1. "title" (string — catchy title for the resource)
2. "url" (string — actual working URL to a real resource, article, or website)
3. "source" (string — the website/publication name)
4. "reason" (string — why this matches their interests)
5. "category" (string — e.g. "Deep Dive", "Tutorial", "News", "Tool", "Community")

Return ONLY a JSON array of 5 suggestion objects.`;

  return await callGemini(prompt);
}
