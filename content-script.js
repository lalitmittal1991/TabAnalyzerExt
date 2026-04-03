// ============================================================
// TabMind — Content Script
// Lightweight script injected into all pages.
// Listens for messages from the background/popup to extract text.
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractText') {
    const text = extractVisibleText();
    sendResponse({ text });
  }
  return true;
});

function extractVisibleText() {
  const body = document.body;
  if (!body) return '';

  const clone = body.cloneNode(true);
  const noiseTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'iframe'];
  noiseTags.forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });

  let text = (clone.innerText || clone.textContent || '').trim();
  text = text.replace(/\s+/g, ' ');
  return text.substring(0, 3000);
}
