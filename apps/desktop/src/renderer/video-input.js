const api = /** @type {any} */ (window).api;

const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const closeBtn = document.getElementById('close-btn');

// Pre-fill from clipboard if it looks like a bilibili link
(async () => {
    try {
        const clipUrl = await api.getClipboardUrl();
        if (clipUrl) {
            input.value = clipUrl;
            input.select();
        }
    } catch { /* use default */ }
    input.focus();
})();

async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    await api.sendVideoUrl(text);
    // Window will be closed by main process after sending
}

sendBtn.addEventListener('click', send);
closeBtn.addEventListener('click', () => api.closeVideoInput());
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        send();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        api.closeVideoInput();
    }
});
