const api = /** @type {any} */ (window).api;

const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const closeBtn = document.getElementById('close-btn');

// Load placeholder from settings
(async () => {
    try {
        const settings = await api.getSettings();
        if (settings.quickChatPlaceholder) {
            input.placeholder = settings.quickChatPlaceholder;
        }
    } catch { /* use default */ }
    input.focus();
})();

async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    await api.sendQuickChat(text);
    // Window will be closed by main process after sending
}

sendBtn.addEventListener('click', send);
closeBtn.addEventListener('click', () => api.closeQuickChat());
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        send();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        api.closeQuickChat();
    }
});
