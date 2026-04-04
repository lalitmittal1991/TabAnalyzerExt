# TabMind — AI Powered Tab Analyzer & Explorer

TabMind is a premium Chrome Extension (Manifest V3) that uses Google Gemini AI to analyze your browsing activity, prioritize your open tabs, and intelligently sync discovery findings to your personal Google Docs.

![TabMind Icon](icons/icon128.png)

## ✨ Key Features

- **🧠 Intelligent Prioritization**: Automatically ranks your open tabs (1-10) based on productivity and relevance.
- **📊 Weekly Insights**: Compares your current week's browsing habits against the previous week using 14-day history tracking.
- **🚀 Discovery Engine**: Suggests high-quality external resources based on your long-term interest profile.
- **📂 Google Docs Sync**: Appends your discovery findings and weekly productivity summaries into a dedicated Google Doc with smart deduplication.
- **🖥️ Persistent Side Panel**: A modern, glassmorphic UI that stays open as you switch between tabs or open new ones.
- **⚡ Auto-Invocation**: Automatically opens the side panel once you cross a specific tab count threshold (e.g., more than 10 tabs).

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

## 🏗️ Architecture

-   **Background Service Worker**: Handles persistent time tracking and active tab events.
-   **Side Panel**: The main UI container for Manifest V3.
-   **Content Scraper**: Securely reads invisible text from tabs for AI analysis.
-   **AI Service**: Orchestrates prompts for Gemini 2.0 Flash.

## 🛠️ Tech Stack

-   **Manifest**: Version 3
-   **Logic**: Pure JavaScript (ES6 Modules)
-   **Styling**: Vanilla CSS (Glassmorphism, Dark Mode)
-   **AI**: Google Gemini 2.0 Flash
-   **APIs**: Google Docs REST API, Google Drive API

---

*Designed for high-productivity browsing.*
