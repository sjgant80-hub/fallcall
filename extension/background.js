// ◊ FallCall Live — Background Service Worker
// Orchestrates audio capture, analysis engine, and sidebar updates
// MV3 architecture: popup → background → offscreen (audio) → content (sidebar)

let activeTabId = null;
let isCapturing = false;
let callStartTime = null;

// ── Message Router ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'startCapture':
      startCapture(msg.tabId)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'stopCapture':
      stopCapture()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'getState':
      sendResponse({
        isCapturing,
        activeTabId,
        callStartTime,
        elapsed: callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0
      });
      return false;

    // Offscreen → Content: forward analysis results
    case 'analysisResult':
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          action: 'updateSidebar',
          data: msg.data
        }).catch(() => {});
      }
      return false;

    // Offscreen → Content: forward transcript chunks
    case 'transcript':
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          action: 'updateTranscript',
          data: msg.data
        }).catch(() => {});
      }
      return false;

    // Offscreen → Background: call ended, save data
    case 'callData':
      saveCallData(msg.data);
      return false;

    default:
      return false;
  }
});

// ── Start Capture ───────────────────────────────────────────
async function startCapture(tabId) {
  if (isCapturing) throw new Error('Already capturing');

  activeTabId = tabId;
  callStartTime = Date.now();

  // 1. Get media stream ID for the target tab
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId
  });

  // 2. Ensure offscreen document exists for audio processing
  await ensureOffscreen();

  // 3. Get Deepgram key from storage
  const { deepgram_key } = await chrome.storage.local.get('deepgram_key');

  // 4. Tell offscreen to start processing audio
  chrome.runtime.sendMessage({
    action: 'startProcessing',
    streamId,
    tabId,
    deepgramKey: deepgram_key || ''
  });

  // 5. Tell content script to show the sidebar
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'showSidebar' });
  } catch {
    // Content script might not be injected yet, inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    // Retry after injection
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'showSidebar' }).catch(() => {});
    }, 300);
  }

  isCapturing = true;
  return { success: true };
}

// ── Stop Capture ────────────────────────────────────────────
async function stopCapture() {
  if (!isCapturing) return { success: true };

  // Tell offscreen to stop
  chrome.runtime.sendMessage({ action: 'stopProcessing' });

  // Tell content script call ended
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'callEnded' }).catch(() => {});
  }

  isCapturing = false;
  callStartTime = null;
  activeTabId = null;

  return { success: true };
}

// ── Offscreen Document Management ───────────────────────────
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Captures tab audio for real-time sales call transcription and coaching'
    });
  }
}

// ── Call History ─────────────────────────────────────────────
async function saveCallData(data) {
  const result = await chrome.storage.local.get('calls');
  const calls = result.calls || [];
  calls.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    duration: data.duration || 0,
    transcript: data.transcript || [],
    analysis: data.analysis || {},
    score: data.score || null
  });
  if (calls.length > 100) calls.length = 100;
  await chrome.storage.local.set({ calls });
}
