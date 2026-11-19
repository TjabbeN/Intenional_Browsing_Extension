// Shown instead of the browser's extensions page when blockExtensionsPage is
// on. The button opens the loop-break page set in the popup.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('talkBtn');
  const hint = document.getElementById('hint');

  chrome.storage.sync.get(['loopBreakUrl'], (result) => {
    const url = (result.loopBreakUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      btn.disabled = true;
      hint.textContent = 'Set a loop-break page in the extension popup to enable this.';
    }
  });

  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openLoopBreak' }, (resp) => {
      void chrome.runtime.lastError;
      if (!resp || !resp.success) {
        hint.textContent = 'No loop-break page set. Open the extension popup to configure it.';
      }
    });
  });
});
