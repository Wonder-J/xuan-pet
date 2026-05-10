// @ts-check

/** @type {typeof window & { api: any }} */
const win = /** @type {any} */ (window);
const api = win.api;

// ============ State ============
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let chatHistory = [];
let currentPanel = null;
const PET_SIZE = { width: 200, height: 250 };
const PANEL_SIZE = { width: 350, height: 520 };

// ============ DOM Refs ============
const petContainer = document.getElementById('pet-container');
const petSprite = document.getElementById('pet-sprite');
const chatPanel = document.getElementById('chat-panel');
const interactPanel = document.getElementById('interact-panel');
const settingsPanel = document.getElementById('settings-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const modelInput = document.getElementById('model-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const interactResponse = document.getElementById('interact-response');

console.log('[renderer] loaded, api =', api);

// ============ Prevent native drag (macOS intercepts it and breaks events) ============
document.addEventListener('dragstart', (e) => {
  e.preventDefault();
});

// ============ Pet Drag (left-click drag) ============
let mouseDownOnPet = false;

document.addEventListener('mousedown', (e) => {
  console.log('[event] mousedown button=' + e.button, e.screenX, e.screenY);
  // Right-click / two-finger click → show context menu
  if (e.button === 2) {
    e.preventDefault();
    console.log('[menu] right-click detected via mousedown');
    api.showContextMenu();
    return;
  }
  // Only left-click for drag
  if (e.button !== 0) return;
  if (e.target.closest('.panel')) return;
  mouseDownOnPet = true;
  isDragging = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

document.addEventListener('mousemove', (e) => {
  if (!mouseDownOnPet) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    isDragging = true;
    api.moveWindow(dx, dy);
    dragStartX = e.screenX;
    dragStartY = e.screenY;
  }
});

document.addEventListener('mouseup', () => {
  mouseDownOnPet = false;
  isDragging = false;
});

// ============ Right-click → Native Context Menu ============
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  console.log('[menu] contextmenu fired');
  api.showContextMenu();
});

// Handle menu action from main process (tray or context menu)
api.onMenuAction((action) => {
  console.log('[menu] action:', action);
  if (action === 'chat') {
    openPanel('chat-panel');
  } else if (action === 'interact') {
    openPanel('interact-panel');
  } else if (action === 'settings') {
    openPanel('settings-panel');
    loadSettings();
  }
});

// ============ Panel Management ============
async function openPanel(panelId) {
  closeAllPanels(true);
  currentPanel = panelId;
  await api.resizeWindow(PANEL_SIZE.width, PANEL_SIZE.height);
  // Small frame delay to let the window settle before animating in
  requestAnimationFrame(() => {
    const panel = document.getElementById(panelId);
    panel.classList.remove('hidden');
    panel.classList.add('visible');
  });
}

function closeAllPanels(skipResize) {
  [chatPanel, interactPanel, settingsPanel].forEach((p) => {
    p.classList.remove('visible');
  });
  currentPanel = null;
}

document.querySelectorAll('.close-btn').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAllPanels();
    // Wait for fade-out animation before resizing window
    await new Promise((r) => setTimeout(r, 250));
    await api.resizeWindow(PET_SIZE.width, PET_SIZE.height);
  });
});


// ============ Chat ============
function addChatMessage(role, content) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="bubble">${escapeHtml(content)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  addChatMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  chatSendBtn.disabled = true;
  chatSendBtn.textContent = '...';

  const result = await api.sendChat(chatHistory);

  chatSendBtn.disabled = false;
  chatSendBtn.textContent = '发送';

  if (result.error) {
    addChatMessage('error', result.error);
  } else {
    addChatMessage('assistant', result.content);
    chatHistory.push({ role: 'assistant', content: result.content });
  }
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// ============ Interact ============
const INTERACT_RESPONSES = {
  pet: ['嘿嘿，好舒服呀~ 🥰', '摸摸头，心情好好！✨', '再摸摸嘛~ 😊'],
  feed: ['好好吃！谢谢主人~ 🍖', '吃饱饱，力气大大！💪', '还想吃！再来一个~ 😋'],
  play: ['好开心！再来再来！⚽', '玩累了，休息一下下~ 😄', '主人最棒了！🎉'],
  sleep: ['zzZ... 晚安~ 😴', '困了困了... 💤', '让我眯一会儿... 🌙'],
};

document.querySelectorAll('.interact-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.interact;
    const responses = INTERACT_RESPONSES[action];
    const response = responses[Math.floor(Math.random() * responses.length)];
    interactResponse.textContent = response;

    // Pet animation
    petSprite.classList.remove('idle', 'bounce');
    petSprite.classList.add('bounce');
    setTimeout(() => {
      petSprite.classList.remove('bounce');
      petSprite.classList.add('idle');
    }, 500);
  });
});

// ============ Settings ============
async function loadSettings() {
  const settings = await api.getSettings();

  // Populate provider select
  providerSelect.innerHTML = '';
  settings.providers.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    if (p.id === settings.currentProvider) option.selected = true;
    providerSelect.appendChild(option);
  });

  updateProviderFields(settings);

  providerSelect.onchange = () => updateProviderFields(settings);
}

function updateProviderFields(settings) {
  const provider = settings.providers.find((p) => p.id === providerSelect.value);
  if (provider) {
    apiKeyInput.value = provider.apiKey || '';
    modelInput.value = provider.model || '';
  }
}

saveSettingsBtn.addEventListener('click', async () => {
  const settings = await api.getSettings();
  const providerId = providerSelect.value;
  const providers = settings.providers.map((p) => {
    if (p.id === providerId) {
      return { ...p, apiKey: apiKeyInput.value, model: modelInput.value };
    }
    return p;
  });

  await api.setSettings({
    currentProvider: providerId,
    providers,
  });

  saveSettingsBtn.textContent = '✓ 已保存';
  setTimeout(() => {
    saveSettingsBtn.textContent = '保存设置';
  }, 1500);
});

// ============ Init ============
petSprite.classList.add('idle');
