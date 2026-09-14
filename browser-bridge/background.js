const DRAFT_KEY = 'salaryEmailDraft';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'salary-email-handoff' || !message.payload) return;
  chrome.storage.local.set({
    [DRAFT_KEY]: {
      ...message.payload,
      receivedAt: Date.now()
    }
  });
  sendResponse?.({ok: true});
});
