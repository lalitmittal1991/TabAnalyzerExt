# TabMind — AI Powered Tab Analyzer & Explorer

TabMind is a premium Chrome Extension (Manifest V3) that uses Google Gemini AI to analyze your browsing activity, prioritize your open tabs, and intelligently sync discovery findings to your personal Google Docs.

![TabMind Icon](icons/icon128.png)

## ✨ Key Features

- **🧠 Impact-First Prioritization**: When total open-content time exceeds available time, tabs are ranked by highest impact first (technical/research/learning oriented tabs are prioritized).
- **⏱️ Focused Time Estimation**: Planning estimates are calculated only for YouTube/Video and Blog-type tabs.
- **🎬 Video Metadata Estimation**: Uses page metadata/video duration where available (+20% buffer); otherwise shows "Data not available".
- **📝 Blog Formula Estimation**: Uses formula-based estimate: `(Words / WPM) + (Images * 3 sec) + (Code blocks * 10 sec)`, with 150 WPM for technical/research and 250 WPM for general reading.
- **📅 Configurable Daily Capacity**: Set available hours per day and mark days as Off/Holiday (0h).
- **📊 Weekly Insights**: Compares your current week's browsing habits against the previous week using 14-day history tracking and shows a 3-week histogram.
- **🚀 Discovery Engine**: Suggests high-quality external resources based on your long-term interest profile.
- **📂 Google Docs Sync**: Appends discovery findings and weekly summary tables to the same Google Doc (no repeated new doc creation once doc ID is set/persisted).
- **🖥️ Persistent Side Panel**: A modern, glassmorphic UI that stays open as you switch between tabs or open new ones.
- **⚡ Auto-Invocation**: Automatically opens the side panel once you cross a specific tab count threshold (e.g., more than 10 tabs).

## 🧩 Analyze Tab Behavior

- Shows only two top-level time metrics:
  - **Time Available** (from your day-wise capacity till upcoming Sunday)
  - **Total Time of Open Content** (summed estimated time of eligible open content)
- If total time is within capacity, tabs are shown normally.
- If total time exceeds capacity, tabs are reordered with **priority labels** based on impact-first scoring.
- Popularity and single-score style ranking are removed from the Analyze workflow.

## 🚀 Installation

1.  **Clone this repository**:
    ```bash
    git clone https://github.com/lalitmittal1991/TabAnalyzerExt.git
    ```
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer Mode** (top-right corner).
4.  Click **Load unpacked** and select the `TabAnalyzerExt` folder.

## ⚙️ Configuration

### 1. Gemini API Key
-   Go to the **Settings** (gear icon) in the TabMind side panel.
-   Enter your **Google Gemini API Key**. You can get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

### 2. Google OAuth2 (for Doc Sync)
To enable the "End Session & Sync" feature:
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a project and enable the **Google Docs API** and **Google Drive API**.
3.  Configure your **OAuth Consent Screen** (add yourself as a Test User).
4.  Create **OAuth 2.0 Credentials** (Application type: Chrome extension) and link it to your Extension ID.

### 3. Google Doc Reuse (Recommended)

- Open your target Google Doc and copy the ID from:
  - `https://docs.google.com/document/d/<DOC_ID>/edit`
- Paste `<DOC_ID>` in Settings under **Google Doc ID**.
- This guarantees all future syncs append to the same document.

## 🏗️ Architecture

-   **Background Service Worker**: Handles persistent time tracking, active tab events, and page metadata extraction (word count, image count, code blocks, video duration).
-   **Side Panel**: The main UI container for Manifest V3.
-   **Content Scraper**: Securely reads invisible text from tabs for AI analysis.
-   **AI Service**: Orchestrates prompts for Gemini 2.0 Flash, estimation logic, and prioritization decisions.

## 🛠️ Tech Stack

-   **Manifest**: Version 3
-   **Logic**: Pure JavaScript (ES6 Modules)
-   **Styling**: Vanilla CSS (Glassmorphism, Dark Mode)
-   **AI**: Google Gemini 2.0 Flash
-   **APIs**: Google Docs REST API, Google Drive API

---

*Designed for high-productivity browsing.*
