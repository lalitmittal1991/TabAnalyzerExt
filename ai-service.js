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

  return await callGemini(prompt);
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
