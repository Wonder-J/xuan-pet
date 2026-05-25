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
const PANEL_SIZE = { width: 400, height: 550 };
const ANIM_PANEL_SIZE = { width: 560, height: 650 };


// ============ Animation State ============
let petAnimations = { happy: [], idle: [], move: [], drag: [], sing: [], angry: [], sad: [], surprise: [], scared: [], sleep: [] };
let defaultImageURL = null;
let currentEmotion = 'idle';
let animFrameIndex = 0;
let animTimer = null;
let idleTimer = null;
let isRoaming = false;
let petScale = 1.0;
const PET_SCALE_MIN = 0.5;
const PET_SCALE_MAX = 3.0;
const PET_SCALE_STEP = 0.1;
const ANIM_FRAME_DURATION = 200;
const IDLE_INTERVAL = 10000;
const ACTION_DURATION = 7000; // all actions last 7 seconds

// Global action state — allows interrupting any running action
let _actionAudio = null;
let _actionTimeout = null;

function interruptCurrentAction() {
  if (_actionAudio) {
    _actionAudio.pause();
    _actionAudio.currentTime = 0;
    _actionAudio = null;
  }
  if (_actionTimeout) {
    clearTimeout(_actionTimeout);
    _actionTimeout = null;
  }
}

// ============ DOM Refs ============
const petContainer = document.getElementById('pet-container');
const petSprite = document.getElementById('pet-sprite');
const chatPanel = document.getElementById('chat-panel');
const interactPanel = document.getElementById('interact-panel');
const toolsPanel = document.getElementById('tools-panel');
const settingsPanel = document.getElementById('settings-panel');
const animationsPanel = document.getElementById('animations-panel');
const animationsContent = document.getElementById('animations-content');
const playlistPanel = document.getElementById('playlist-panel');
const playlistContent = document.getElementById('playlist-content');
const songPickerPanel = document.getElementById('song-picker-panel');
const songPickerContent = document.getElementById('song-picker-content');
const skillsPanel = document.getElementById('skills-panel');
const skillsContent = document.getElementById('skills-content');
const scheduledPanel = document.getElementById('scheduled-panel');
const scheduledContent = document.getElementById('scheduled-content');
const quickChatSettingsPanel = document.getElementById('quick-chat-settings-panel');
const shortcutSettingsPanel = document.getElementById('shortcut-settings-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const quickChatPlaceholderInput = document.getElementById('quick-chat-placeholder-input');
const saveQuickChatSettingsBtn = document.getElementById('save-quick-chat-settings-btn');
const shortcutSettingsContent = document.getElementById('shortcut-settings-content');
const saveShortcutSettingsBtn = document.getElementById('save-shortcut-settings-btn');
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const modelInput = document.getElementById('model-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const systemPromptInput = document.getElementById('system-prompt-input');
const DEFAULT_QUICK_CHAT_PLACEHOLDER = '你想问龙哥什么';
const SHORTCUT_FIELDS = [
  { key: 'quickChat', label: '快速聊天' },
  { key: 'chat', label: '聊天' },
  { key: 'interact', label: '互动' },
  { key: 'settings', label: '设置' },
  { key: 'animations', label: '动作设置' },
  { key: 'skills', label: '技能' },
  { key: 'playlist', label: '歌单设置' },
  { key: 'scheduled', label: '定时说话' },
  { key: 'roaming', label: '随意走动' },
  { key: 'video', label: '播放B站视频' },
];

console.log('[renderer] loaded, api =', api);

// ============ Click-through: ignore mouse on transparent areas ============
document.addEventListener('mouseenter', () => {
  // When mouse enters the window at all, check if it's over an interactive element
  // The forward:true on main process means we get these events even when ignoring
});

// Helper: attach hover listeners to make an element capture mouse events
function makeInteractive(el) {
  el.addEventListener('mouseenter', () => {
    api.setIgnoreMouse(false);
  });
  el.addEventListener('mouseleave', () => {
    // Only re-enable ignore if no panel is open
    if (!currentPanel) {
      api.setIgnoreMouse(true);
    }
  });
}

// Pet container always interactive on hover
makeInteractive(petContainer);

// All panels are interactive when visible
for (const panel of [chatPanel, interactPanel, toolsPanel, settingsPanel, animationsPanel, playlistPanel, songPickerPanel, skillsPanel, scheduledPanel, quickChatSettingsPanel, shortcutSettingsPanel]) {
  if (panel) makeInteractive(panel);
}

// ============ Prevent native drag (macOS intercepts it and breaks events) ============
document.addEventListener('dragstart', (e) => {
  e.preventDefault();
});

// ============ Pet Drag (left-click drag) ============
// Drag is handled in the main process via cursor polling.
// Renderer only sends drag-start / drag-end signals (2 IPC calls total).
let mouseDownOnPet = false;

document.addEventListener('mousedown', (e) => {
  // Right-click / two-finger click → show context menu
  if (e.button === 2) {
    e.preventDefault();
    api.showContextMenu();
    return;
  }
  // Only left-click for drag
  if (e.button !== 0) return;
  if (e.target.closest('.panel')) return;
  if (e.target.closest('.resize-handle')) return;
  if (e.target.closest('.speech-bubble')) return;
  mouseDownOnPet = true;
  isDragging = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

document.addEventListener('mousemove', (e) => {
  if (!mouseDownOnPet) return;
  if (!isDragging) {
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      isDragging = true;
      // Show drag animation
      if (hasCustomFrames('drag')) {
        const frames = petAnimations['drag'];
        showFrame(frames[Math.floor(Math.random() * frames.length)]);
      }
      // Tell main process to start polling cursor for window movement
      api.dragStart(e.screenX, e.screenY);
    }
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    api.dragEnd();
    returnToIdle();
  }
  mouseDownOnPet = false;
  isDragging = false;
});

// ============ Single-click with Tool ============
petContainer.addEventListener('click', async (e) => {
  if (activeToolId) {
    e.stopPropagation();
    await handleToolClick();
  }
});

// ============ Double-click → Random Animation ============
petContainer.addEventListener('dblclick', (e) => {
  e.preventDefault();
  interruptCurrentAction();
  // Collect all uploaded frames except action-type animations
  const allFrames = [];
  for (const emotion of Object.keys(petAnimations)) {
    if (emotion === 'move' || emotion === 'drag' || emotion === 'sing') continue;
    const frames = petAnimations[emotion];
    if (frames && frames.length > 0) {
      allFrames.push(...frames);
    }
  }
  if (allFrames.length > 0) {
    const randomFrame = allFrames[Math.floor(Math.random() * allFrames.length)];
    showFrame(randomFrame);
    // Return to default after animation plays
    _actionTimeout = setTimeout(() => returnToIdle(), ACTION_DURATION);
  }
});

// ============ Right-click → Native Context Menu ============
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  console.log('[menu] contextmenu fired');
  api.showContextMenu();
});

// ============ Drag to Resize Pet ============
const resizeHandle = document.getElementById('resize-handle');
let isResizing = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartScale = 1;

resizeHandle.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  isResizing = true;
  resizeStartX = e.screenX;
  resizeStartY = e.screenY;
  resizeStartScale = petScale;
  document.body.style.cursor = 'nwse-resize';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const dx = e.screenX - resizeStartX;
  const dy = e.screenY - resizeStartY;
  // Use diagonal distance for uniform scaling
  const dist = (dx + dy) / 2;
  const newScale = Math.max(PET_SCALE_MIN, Math.min(PET_SCALE_MAX, resizeStartScale + dist / 150));
  petScale = newScale;
  const spriteSize = Math.round(120 * petScale);
  petSprite.style.width = `${spriteSize}px`;
  petSprite.style.height = `${spriteSize}px`;
  const newW = Math.round(PET_SIZE.width * petScale);
  const newH = Math.round(PET_SIZE.height * petScale);
  api.resizeWindow(newW, newH);
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
  }
});

// Handle menu action from main process (tray or context menu)
api.onMenuAction(async (action) => {
  console.log('[menu] action:', action);
  if (action === 'chat') {
    openPanel('chat-panel');
  } else if (action === 'interact') {
    openPanel('interact-panel');
    loadInteractionsPanel();
  } else if (action === 'tools') {
    openPanel('tools-panel');
    loadToolsPanel();
  } else if (action.startsWith('play-interaction:')) {
    const id = action.replace('play-interaction:', '');
    playInteraction(id);
  } else if (action.startsWith('use-tool:')) {
    const id = action.replace('use-tool:', '');
    activateTool(id);
  } else if (action === 'settings') {
    openPanel('settings-panel');
    loadSettings();
  } else if (action === 'animations') {
    openPanel('animations-panel', ANIM_PANEL_SIZE);
    loadAnimationsPanel();
  } else if (action === 'playlist') {
    openPanel('playlist-panel');
    loadPlaylistPanel();
  } else if (action === 'sing-random') {
    singRandom();
  } else if (action === 'sing-pick') {
    openPanel('song-picker-panel');
    loadSongPickerPanel();
  } else if (action === 'stop-singing') {
    stopSinging();
    returnToIdle();
  } else if (action === 'skills') {
    openPanel('skills-panel');
    loadSkillsPanel();
  } else if (action === 'scheduled') {
    openPanel('scheduled-panel');
    loadScheduledPanel();
  } else if (action === 'quick-chat-settings') {
    openPanel('quick-chat-settings-panel');
    loadQuickChatSettings();
  } else if (action === 'shortcut-settings') {
    openPanel('shortcut-settings-panel');
    loadShortcutSettings();
  } else if (action === 'voice-settings') {
    openPanel('voice-settings-panel');
    loadVoiceSettings();
  } else if (action === 'roaming') {
    toggleRoaming();
  } else if (action === 'export-config') {
    const result = await api.exportConfig();
    if (result?.success) showBubble('✅ 配置已导出到: ' + result.path);
    else if (result?.error) showBubble('❌ 导出失败: ' + result.error);
  } else if (action === 'import-config') {
    const result = await api.importConfig();
    if (result?.success) showBubble('✅ 配置导入成功！重启后完全生效');
    else if (result?.error) showBubble('❌ 导入失败: ' + result.error);
  }
});

// Listen for quick-chat loading/result from main process
api.onQuickChatLoading(() => {
  showLoadingBubble();
});

api.onQuickChatResult(async (result) => {
  if (result.error) {
    hideLoadingBubble();
    showBubble(result.error);
  } else if (result.content) {
    if (voiceEnabled) {
      // Voice enabled: keep loading dots until both text and audio are ready
      const audio = await prepareVoiceAudio(result.content);
      hideLoadingBubble();
      showBubble(result.content);
      if (audio) audio.play().catch(() => { });
    } else {
      // Voice disabled: show text immediately
      hideLoadingBubble();
      showBubble(result.content);
    }
  } else {
    hideLoadingBubble();
  }
});

// ============ Panel Management ============
async function openPanel(panelId, size) {
  closeAllPanels(true);
  currentPanel = panelId;
  api.setIgnoreMouse(false); // Panel open → capture all mouse events
  const s = size || PANEL_SIZE;
  await api.resizeWindow(s.width, s.height);
  // Small frame delay to let the window settle before animating in
  requestAnimationFrame(() => {
    const panel = document.getElementById(panelId);
    panel.classList.remove('hidden');
    panel.classList.add('visible');
  });
}

function closeAllPanels(skipResize) {
  [chatPanel, interactPanel, toolsPanel, settingsPanel, animationsPanel, playlistPanel, songPickerPanel, skillsPanel, scheduledPanel, quickChatSettingsPanel, shortcutSettingsPanel, voiceSettingsPanel].forEach((p) => {
    if (p) p.classList.remove('visible');
  });
  currentPanel = null;
  api.setIgnoreMouse(true); // No panel → click-through transparent areas
}

document.querySelectorAll('.close-btn').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAllPanels();
    // Wait for fade-out animation before resizing window
    await new Promise((r) => setTimeout(r, 250));
    // If bubble is showing, resize to bubble size; otherwise pet size
    if (document.getElementById('speech-bubble')) {
      await api.resizeWindow(BUBBLE_WINDOW_SIZE.width, BUBBLE_WINDOW_SIZE.height);
    } else {
      await api.resizeWindow(PET_SIZE.width, PET_SIZE.height);
    }
  });
});


// ============ Chat ============
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function addChatMessage(role, content) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  if (role === 'user') {
    div.innerHTML = `<div class="bubble">${escapeHtml(content)}</div>`;
  } else {
    const { think, reply } = parseThinkTags(content);
    let html = `<div class="bubble markdown-body">${marked.parse(reply)}</div>`;
    if (think) {
      html += `<details class="think-block"><summary>💭 思考过程</summary><div class="think-content markdown-body">${marked.parse(think)}</div></details>`;
    }
    div.innerHTML = html;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function parseThinkTags(content) {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let think = '';
  let match;
  while ((match = thinkRegex.exec(content)) !== null) {
    think += match[1].trim() + '\n';
  }
  const reply = content.replace(thinkRegex, '').trim();
  return { think: think.trim(), reply };
}

function addThinkingBubble() {
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = 'thinking-bubble';
  div.innerHTML = `<div class="bubble thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function removeThinkingBubble() {
  const el = document.getElementById('thinking-bubble');
  if (el) el.remove();
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
  addThinkingBubble();

  const result = await api.sendChat(chatHistory);

  removeThinkingBubble();
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

// ============ Custom Interactions ============
async function loadInteractionsPanel() {
  const list = await api.getInteractions();
  const container = document.getElementById('interactions-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="padding:12px;color:#999;text-align:center;">暂无自定义互动，点击下方按钮添加</div>';
  } else {
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'interact-item';
      row.innerHTML = `
        <button class="interact-btn" data-interaction-id="${item.id}">${item.name}</button>
        <button class="remove-btn" data-remove-interaction="${item.id}">🗑</button>
      `;
      container.appendChild(row);
    });
  }

  // Play buttons
  container.querySelectorAll('[data-interaction-id]').forEach((btn) => {
    btn.addEventListener('click', () => playInteraction(btn.dataset.interactionId));
  });
  // Remove buttons
  container.querySelectorAll('[data-remove-interaction]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.removeInteraction(btn.dataset.removeInteraction);
      loadInteractionsPanel();
    });
  });
}

document.getElementById('add-interaction-btn').addEventListener('click', async () => {
  const name = await showInputDialog('输入互动名称');
  if (!name) return;
  const result = await api.createInteraction(name);
  if (result) loadInteractionsPanel();
});

async function playInteraction(id) {
  const assets = await api.getInteractionAssets(id);
  if (!assets) return;
  interruptCurrentAction();
  closeAllPanels();

  // Play animation (loop until audio ends)
  const audio = new Audio(assets.audioUrl);
  _actionAudio = audio;
  showFrame(assets.animationUrl);

  audio.addEventListener('ended', () => {
    _actionAudio = null;
    returnToIdle();
  });
  audio.addEventListener('error', () => {
    _actionAudio = null;
    returnToIdle();
  });
  audio.play().catch(() => { _actionAudio = null; returnToIdle(); });
}

// ============ Custom Tools ============
let activeToolId = null;
let activeToolCursorUrl = null;

async function loadToolsPanel() {
  document.getElementById('tools-grid-view').style.display = '';
  document.getElementById('tools-detail-view').style.display = 'none';
  document.getElementById('tools-panel-title').textContent = '🔧 工具管理';

  const list = await api.getTools();
  const container = document.getElementById('tools-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="tools-empty">暂无自定义工具<br><small>点击下方按钮添加</small></div>';
  } else {
    for (const item of list) {
      const assets = await api.getToolAssets(item.id);
      const isActive = activeToolId === item.id;
      const hasAnim = !!item.animationFile;
      const hasAudio = !!item.audioFile;
      const card = document.createElement('div');
      card.className = 'tool-card' + (isActive ? ' active' : '');
      card.innerHTML = `
        <div class="tool-card-top">
          <div class="tool-card-icon"${assets?.iconUrl ? ` style="background-image: url('${assets.iconUrl}')"` : ''}></div>
          <button class="tool-del-btn" data-tool-del="${item.id}" title="删除">✕</button>
        </div>
        <div class="tool-card-name">${item.name}</div>
        <div class="tool-card-badges">
          <span class="badge ${hasAnim ? 'badge-ok' : 'badge-none'}">${hasAnim ? '动画 ✓' : '动画'}</span>
          <span class="badge ${hasAudio ? 'badge-ok' : 'badge-none'}">${hasAudio ? '音效 ✓' : '音效'}</span>
        </div>
        <div class="tool-card-btns">
          <button class="tool-use-btn" data-tool-use="${item.id}">${isActive ? '✓ 使用中' : '使用'}</button>
          <button class="tool-edit-btn" data-tool-edit="${item.id}">编辑</button>
        </div>
      `;
      container.appendChild(card);
    }
  }

  // Use tool
  container.querySelectorAll('[data-tool-use]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); activateTool(btn.dataset.toolUse); });
  });
  // Edit tool
  container.querySelectorAll('[data-tool-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openToolDetail(btn.dataset.toolEdit); });
  });
  // Delete tool
  container.querySelectorAll('[data-tool-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (activeToolId === btn.dataset.toolDel) deactivateTool();
      await api.removeTool(btn.dataset.toolDel);
      loadToolsPanel();
    });
  });
}

async function openToolDetail(id) {
  const list = await api.getTools();
  const tool = list.find((t) => t.id === id);
  if (!tool) return;

  document.getElementById('tools-grid-view').style.display = 'none';
  document.getElementById('tools-detail-view').style.display = '';
  document.getElementById('tools-panel-title').textContent = `🔧 ${tool.name}`;

  const content = document.getElementById('tool-detail-content');
  content.innerHTML = `
    <div class="tool-detail-row">
      <span>动画 (WebP):</span>
      <span class="tool-detail-status">${tool.animationFile ? '✅ 已设置' : '❌ 未设置'}</span>
      <button id="tool-set-anim" class="small-btn">选择文件</button>
    </div>
    <div class="tool-detail-row">
      <span>音效:</span>
      <span class="tool-detail-status">${tool.audioFile ? '✅ 已设置' : '❌ 未设置'}</span>
      <button id="tool-set-audio" class="small-btn">选择文件</button>
    </div>
    <p class="tool-detail-hint">使用工具后，点击宠物将触发动画和音效</p>
  `;

  content.querySelector('#tool-set-anim').addEventListener('click', async () => {
    const result = await api.updateToolAnimation(id);
    if (result) openToolDetail(id);
  });
  content.querySelector('#tool-set-audio').addEventListener('click', async () => {
    const result = await api.updateToolAudio(id);
    if (result) openToolDetail(id);
  });
}

document.getElementById('tool-back-btn').addEventListener('click', () => {
  loadToolsPanel();
});

document.getElementById('add-tool-btn').addEventListener('click', async () => {
  const name = await showInputDialog('输入工具名称');
  if (!name) return;
  const result = await api.createTool(name);
  if (result) loadToolsPanel();
});

async function activateTool(id) {
  if (activeToolId === id) {
    deactivateTool();
    return;
  }
  const assets = await api.getToolAssets(id);
  if (!assets || !assets.iconDataUrl) return;
  activeToolId = id;
  activeToolCursorUrl = assets.iconDataUrl;
  // Use data URL for CSS cursor (custom protocol doesn't work with cursor)
  document.getElementById('pet-sprite').style.cursor = `url("${assets.iconDataUrl}") 16 16, pointer`;
  document.body.style.cursor = `url("${assets.iconDataUrl}") 16 16, pointer`;
  closeAllPanels();
}

function deactivateTool() {
  activeToolId = null;
  activeToolCursorUrl = null;
  document.getElementById('pet-sprite').style.cursor = '';
  document.body.style.cursor = '';
}

async function handleToolClick() {
  if (!activeToolId) return false;
  interruptCurrentAction();
  const assets = await api.getToolAssets(activeToolId);
  if (!assets) { deactivateTool(); return false; }

  // Need at least animation or audio to trigger
  if (!assets.animationUrl && !assets.audioUrl) { deactivateTool(); return true; }

  // Play tool animation and audio
  if (assets.animationUrl) showFrame(assets.animationUrl);

  if (assets.audioUrl) {
    const audio = new Audio(assets.audioUrl);
    _actionAudio = audio;
    audio.addEventListener('ended', () => { _actionAudio = null; returnToIdle(); deactivateTool(); });
    audio.addEventListener('error', () => { _actionAudio = null; returnToIdle(); deactivateTool(); });
    audio.play().catch(() => { _actionAudio = null; returnToIdle(); deactivateTool(); });
  } else {
    // No audio, just show animation for a few seconds
    _actionTimeout = setTimeout(() => { returnToIdle(); deactivateTool(); }, 5000);
  }
  return true;
}

// ============ Settings ============
async function loadSettings() {
  const settings = await api.getSettings();

  // System prompt
  systemPromptInput.value = settings.systemPrompt || '';

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

async function loadQuickChatSettings() {
  const settings = await api.getSettings();
  quickChatPlaceholderInput.value = settings.quickChatPlaceholder || DEFAULT_QUICK_CHAT_PLACEHOLDER;
}

saveQuickChatSettingsBtn.addEventListener('click', async () => {
  await api.setSettings({
    quickChatPlaceholder: quickChatPlaceholderInput.value.trim() || DEFAULT_QUICK_CHAT_PLACEHOLDER,
  });

  saveQuickChatSettingsBtn.textContent = '✓ 已保存';
  setTimeout(() => {
    saveQuickChatSettingsBtn.textContent = '保存设置';
  }, 1500);
});

async function loadShortcutSettings() {
  const settings = await api.getSettings();
  const shortcuts = settings.shortcuts || {};
  shortcutSettingsContent.innerHTML = '';

  for (const field of SHORTCUT_FIELDS) {
    const row = document.createElement('div');
    row.className = 'shortcut-item';
    row.innerHTML = `
      <label class="shortcut-label">${field.label}</label>
      <input type="text" class="shortcut-input" data-shortcut-key="${field.key}" placeholder="留空表示不设置" />
    `;
    row.querySelector('.shortcut-input').value = shortcuts[field.key] || '';
    shortcutSettingsContent.appendChild(row);
  }
}

saveShortcutSettingsBtn.addEventListener('click', async () => {
  const settings = await api.getSettings();
  const nextShortcuts = { ...(settings.shortcuts || {}) };

  shortcutSettingsContent.querySelectorAll('[data-shortcut-key]').forEach((input) => {
    nextShortcuts[input.dataset.shortcutKey] = input.value.trim();
  });

  await api.setSettings({ shortcuts: nextShortcuts });

  saveShortcutSettingsBtn.textContent = '✓ 已保存';
  setTimeout(() => {
    saveShortcutSettingsBtn.textContent = '保存快捷键';
  }, 1500);
});

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
    systemPrompt: systemPromptInput.value,
  });

  saveSettingsBtn.textContent = '✓ 已保存';
  setTimeout(() => {
    saveSettingsBtn.textContent = '保存设置';
  }, 1500);
});

// ============ Init ============
petSprite.classList.add('idle');
loadAllAnimations();

// ============ Animation Playback ============
async function loadAllAnimations() {
  petAnimations = await api.getAnimations();
  defaultImageURL = await api.getDefaultImage();
  // Always show default image
  if (defaultImageURL) {
    petSprite.style.backgroundImage = `url("${defaultImageURL}")`;
  }
}

function hasCustomFrames(emotion) {
  return petAnimations[emotion] && petAnimations[emotion].length > 0;
}

function playEmotion(emotion, duration) {
  stopAnimTimer();
  currentEmotion = emotion;
  animFrameIndex = 0;

  if (!hasCustomFrames(emotion)) {
    // CSS fallback
    petSprite.style.backgroundImage = defaultImageURL ? `url("${defaultImageURL}")` : '';
    petSprite.classList.remove('idle', 'bounce', 'anim-angry', 'anim-sad', 'anim-sleep');
    const cssMap = {
      happy: 'bounce',
      idle: 'idle',
      surprise: 'bounce',
      sleep: 'anim-sleep',
      angry: 'anim-angry',
      sad: 'anim-sad',
      move: 'bounce',
      scared: 'bounce',
    };
    petSprite.classList.add(cssMap[emotion] || 'bounce');
    if (duration) {
      setTimeout(() => returnToIdle(), duration);
    }
    return;
  }

  const frames = petAnimations[emotion];
  const randomFrame = frames[Math.floor(Math.random() * frames.length)];
  showFrame(randomFrame);
  if (duration) setTimeout(() => returnToIdle(), duration);
}

function showFrame(assetURL) {
  petSprite.classList.remove('idle', 'bounce', 'anim-angry', 'anim-sad', 'anim-sleep');
  // Append cache-buster to force WebP animation to restart from beginning
  const separator = assetURL.includes('?') ? '&' : '?';
  petSprite.style.backgroundImage = `url("${assetURL}${separator}_t=${Date.now()}")`;
}

function returnToIdle() {
  stopAnimTimer();
  currentEmotion = 'idle';
  // Always show default image as the base state
  petSprite.style.backgroundImage = defaultImageURL ? `url("${defaultImageURL}")` : '';
  petSprite.classList.remove('bounce', 'anim-angry', 'anim-sad', 'anim-sleep');
  petSprite.classList.add('idle');
}

function stopAnimTimer() {
  if (animTimer) { clearTimeout(animTimer); animTimer = null; }
}

// ============ Roaming ============
const ROAM_EMOTIONS = ['happy', 'idle', 'angry', 'sad', 'surprise', 'scared', 'sleep'];

async function toggleRoaming() {
  isRoaming = !isRoaming;
  await api.toggleRoaming(isRoaming);
  if (!isRoaming) {
    petSprite.style.transform = '';
    returnToIdle();
  }
}

// Listen for roaming state changes from main process
api.onRoamingState(({ moving, direction }) => {
  if (!isRoaming) {
    // Roaming stopped — ignore any stale state messages
    petSprite.style.transform = '';
    returnToIdle();
    return;
  }

  if (moving) {
    // Walking — show move animation, apply direction flip
    petSprite.style.transform = direction === -1 ? 'scaleX(-1)' : '';
    if (hasCustomFrames('move')) {
      const frames = petAnimations['move'];
      showFrame(frames[Math.floor(Math.random() * frames.length)]);
    } else {
      // CSS fallback for walking
      petSprite.style.backgroundImage = defaultImageURL ? `url("${defaultImageURL}")` : '';
      petSprite.classList.remove('idle', 'bounce', 'anim-angry', 'anim-sad', 'anim-sleep');
      petSprite.classList.add('bounce');
    }
  } else {
    // Stopped — play a random uploaded action, then continue walking
    const allFrames = [];
    for (const emotion of Object.keys(petAnimations)) {
      if (emotion === 'move' || emotion === 'drag' || emotion === 'sing') continue;
      const frames = petAnimations[emotion];
      if (frames && frames.length > 0) {
        allFrames.push(...frames);
      }
    }
    if (allFrames.length > 0) {
      const randomFrame = allFrames[Math.floor(Math.random() * allFrames.length)];
      showFrame(randomFrame);
    } else {
      returnToIdle();
    }
  }
});

// ============ Animations Settings Panel ============
const EMOTION_LABELS = {
  happy: '😊 开心', idle: '😐 空闲', move: '🚶 走路', drag: '✋ 拖拽', sing: '🎤 唱歌', angry: '😠 愤怒',
  sad: '😢 悲伤', surprise: '🎉 惊喜', scared: '😨 惊吓', sleep: '😴 睡觉',
};
const ACTION_EMOTIONS = ['move', 'drag', 'sing'];
const MOOD_EMOTIONS = ['happy', 'idle', 'angry', 'sad', 'surprise', 'scared', 'sleep'];
const EMOTIONS = [...ACTION_EMOTIONS, ...MOOD_EMOTIONS];

async function loadAnimationsPanel() {
  petAnimations = await api.getAnimations();
  defaultImageURL = await api.getDefaultImage();
  renderAnimationsPanel();
}

function renderAnimationsPanel() {
  animationsContent.innerHTML = '';

  // Default image section
  const defaultSection = document.createElement('div');
  defaultSection.className = 'anim-section';
  defaultSection.innerHTML = `
    <div class="anim-section-header">
      <span class="anim-section-title">🐾 默认形象</span>
      <button class="anim-add-btn" id="pick-default-btn">选择图片</button>
    </div>
    <div class="anim-grid">
      ${defaultImageURL
      ? `<div class="anim-card"><img src="${defaultImageURL}" class="anim-preview" draggable="false" /></div>`
      : '<div class="anim-empty">未设置，使用内置 SVG</div>'
    }
    </div>
    <div class="anim-hint">上传宠物的基础形象图片（webp/gif/png）</div>
  `;
  animationsContent.appendChild(defaultSection);

  defaultSection.querySelector('#pick-default-btn').addEventListener('click', async () => {
    const url = await api.pickDefaultImage();
    if (url) {
      defaultImageURL = url;
      // Apply immediately to pet sprite
      petSprite.style.backgroundImage = `url("${url}")`;
      renderAnimationsPanel();
    }
  });

  // Divider
  const divider = document.createElement('hr');
  divider.className = 'anim-divider';
  animationsContent.appendChild(divider);

  // Action category header
  const actionHeader = document.createElement('div');
  actionHeader.className = 'anim-category-header';
  actionHeader.textContent = '📦 动作类';
  animationsContent.appendChild(actionHeader);

  for (const emotion of ACTION_EMOTIONS) {
    renderEmotionSection(emotion);
  }

  // Mood category header
  const moodDivider = document.createElement('hr');
  moodDivider.className = 'anim-divider';
  animationsContent.appendChild(moodDivider);

  const moodHeader = document.createElement('div');
  moodHeader.className = 'anim-category-header';
  moodHeader.textContent = '💫 情绪类';
  animationsContent.appendChild(moodHeader);

  for (const emotion of MOOD_EMOTIONS) {
    renderEmotionSection(emotion);
  }

  function renderEmotionSection(emotion) {
    const section = document.createElement('div');
    section.className = 'anim-section';

    const header = document.createElement('div');
    header.className = 'anim-section-header';
    header.innerHTML = `
      <span class="anim-section-title">${EMOTION_LABELS[emotion]}</span>
      <button class="anim-add-btn" data-emotion="${emotion}">+ 添加</button>
    `;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'anim-grid';

    const frames = petAnimations[emotion] || [];
    if (frames.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anim-empty';
      empty.textContent = '暂无动作，点击添加';
      grid.appendChild(empty);
    } else {
      for (const assetURL of frames) {
        const card = document.createElement('div');
        card.className = 'anim-card';
        card.innerHTML = `
          <img src="${assetURL}" class="anim-preview" draggable="false" />
          <button class="anim-remove-btn" data-url="${assetURL}" title="删除">✕</button>
        `;
        grid.appendChild(card);
      }
    }

    section.appendChild(grid);
    animationsContent.appendChild(section);
  }

  // Bind add buttons
  animationsContent.querySelectorAll('.anim-add-btn[data-emotion]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const emotion = btn.dataset.emotion;
      await api.pickAnimationFiles(emotion);
      await loadAnimationsPanel();
      await loadAllAnimations();
    });
  });

  // Bind remove buttons
  animationsContent.querySelectorAll('.anim-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      await api.removeAnimation(url);
      await loadAnimationsPanel();
      await loadAllAnimations();
    });
  });
}

// ============ Singing / Playlist ============
let songList = []; // { name, url }
let currentAudio = null;
let isSinging = false;

async function loadPlaylistPanel() {
  songList = await api.getSongs();
  renderPlaylistPanel();
}

function renderPlaylistPanel() {
  playlistContent.innerHTML = '';

  const addBtn = document.createElement('button');
  addBtn.className = 'anim-add-btn';
  addBtn.textContent = '+ 添加歌曲';
  addBtn.style.marginBottom = '12px';
  addBtn.addEventListener('click', async () => {
    await api.pickSongs();
    await loadPlaylistPanel();
  });
  playlistContent.appendChild(addBtn);

  if (songList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'anim-empty';
    empty.textContent = '还没有歌曲，点击上方添加';
    playlistContent.appendChild(empty);
    return;
  }

  for (const song of songList) {
    const item = document.createElement('div');
    item.className = 'song-item';
    item.innerHTML = `
      <span class="song-name">🎵 ${song.name}</span>
      <button class="song-play-btn" title="播放">▶</button>
      <button class="song-delete-btn" title="删除">🗑</button>
    `;
    item.querySelector('.song-play-btn').addEventListener('click', () => {
      playSong(song);
      closeAllPanels();
      setTimeout(() => api.resizeWindow(PET_SIZE.width, PET_SIZE.height), 250);
    });
    item.querySelector('.song-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.removeSong(song.url);
      await loadPlaylistPanel();
    });
    playlistContent.appendChild(item);
  }
}

async function loadSongPickerPanel() {
  songList = await api.getSongs();
  songPickerContent.innerHTML = '';

  if (songList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'anim-empty';
    empty.textContent = '歌单为空，请先在歌单设置中添加歌曲';
    songPickerContent.appendChild(empty);
    return;
  }

  for (const song of songList) {
    const item = document.createElement('div');
    item.className = 'song-item';
    item.innerHTML = `
      <span class="song-name">🎵 ${song.name}</span>
      <button class="song-play-btn" title="播放">▶</button>
    `;
    item.querySelector('.song-play-btn').addEventListener('click', () => {
      playSong(song);
      closeAllPanels();
      setTimeout(() => api.resizeWindow(PET_SIZE.width, PET_SIZE.height), 250);
    });
    songPickerContent.appendChild(item);
  }
}

async function singRandom() {
  if (songList.length === 0) {
    songList = await api.getSongs();
  }
  if (songList.length === 0) return;
  const song = songList[Math.floor(Math.random() * songList.length)];
  playSong(song);
}

function playSong(song) {
  stopSinging();
  isSinging = true;
  currentAudio = new Audio(song.url);
  currentAudio.play();

  // Show sing animation and keep it looping
  startSingAnimation();

  currentAudio.addEventListener('ended', () => {
    isSinging = false;
    if (singAnimInterval) { clearInterval(singAnimInterval); singAnimInterval = null; }
    returnToIdle();
  });
}

let singAnimInterval = null;
function startSingAnimation() {
  if (singAnimInterval) clearInterval(singAnimInterval);
  if (hasCustomFrames('sing')) {
    const frames = petAnimations['sing'];
    showFrame(frames[Math.floor(Math.random() * frames.length)]);
    // Cycle through sing frames
    if (frames.length > 1) {
      singAnimInterval = setInterval(() => {
        showFrame(frames[Math.floor(Math.random() * frames.length)]);
      }, 500);
    }
  } else {
    petSprite.classList.remove('idle', 'anim-angry', 'anim-sad', 'anim-sleep');
    petSprite.classList.add('bounce');
  }
}

function stopSinging() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (singAnimInterval) { clearInterval(singAnimInterval); singAnimInterval = null; }
  isSinging = false;
}

// ============ Skills Panel ============
let editingSkillId = null;

async function loadSkillsPanel() {
  const skills = await api.getSkills();
  renderSkillsList(skills);
}

function renderSkillsList(skills) {
  skillsContent.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'skills-toolbar';
  toolbar.innerHTML = `
    <button class="anim-add-btn" id="new-skill-btn">+ 新建</button>
    <button class="anim-add-btn" id="upload-skill-btn">📄 导入MD</button>
  `;
  skillsContent.appendChild(toolbar);

  toolbar.querySelector('#new-skill-btn').addEventListener('click', () => {
    editingSkillId = null;
    renderSkillEditor('', '');
  });

  toolbar.querySelector('#upload-skill-btn').addEventListener('click', async () => {
    const skill = await api.pickSkillFile();
    if (skill) loadSkillsPanel();
  });

  if (skills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'anim-empty';
    empty.textContent = '还没有技能，点击新建或导入';
    skillsContent.appendChild(empty);
    return;
  }

  for (const skill of skills) {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `
      <span class="skill-name">📝 ${escapeHtml(skill.name)}</span>
      <button class="skill-edit-btn" title="编辑">✏️</button>
      <button class="skill-remove-btn" title="删除">🗑</button>
    `;
    item.querySelector('.skill-edit-btn').addEventListener('click', () => {
      editingSkillId = skill.id;
      renderSkillEditor(skill.name, skill.content);
    });
    item.querySelector('.skill-remove-btn').addEventListener('click', async () => {
      await api.removeSkill(skill.id);
      loadSkillsPanel();
    });
    skillsContent.appendChild(item);
  }
}

function renderSkillEditor(name, content) {
  skillsContent.innerHTML = '';

  const editor = document.createElement('div');
  editor.className = 'skill-editor';
  editor.innerHTML = `
    <button class="skill-back-btn anim-add-btn">← 返回列表</button>
    <div class="setting-group">
      <label>技能名称</label>
      <input type="text" class="skill-name-input" placeholder="例如：讲笑话" />
    </div>
    <div class="setting-group">
      <label>技能内容（Markdown）</label>
      <textarea class="skill-content-input" rows="15" placeholder="在这里编写技能内容..."></textarea>
    </div>
    <button class="save-btn skill-save-btn">保存技能</button>
  `;
  skillsContent.appendChild(editor);

  // Set values after DOM insertion to avoid escaping issues
  editor.querySelector('.skill-name-input').value = name;
  editor.querySelector('.skill-content-input').value = content;

  editor.querySelector('.skill-back-btn').addEventListener('click', () => {
    loadSkillsPanel();
  });

  editor.querySelector('.skill-save-btn').addEventListener('click', async () => {
    const nameVal = editor.querySelector('.skill-name-input').value.trim();
    const contentVal = editor.querySelector('.skill-content-input').value.trim();
    if (!nameVal) return;

    if (editingSkillId) {
      await api.updateSkill(editingSkillId, nameVal, contentVal);
    } else {
      await api.createSkill(nameVal, contentVal);
    }
    editingSkillId = null;
    loadSkillsPanel();
  });
}

// ============ Scheduled Tasks Panel ============
async function loadScheduledPanel() {
  const tasks = await api.getScheduledTasks();
  renderScheduledPanel(tasks);
}

function renderScheduledPanel(tasks) {
  scheduledContent.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'schedule-toolbar';
  toolbar.innerHTML = `<button class="anim-add-btn" id="new-schedule-btn">+ 添加定时任务</button>`;
  scheduledContent.appendChild(toolbar);

  toolbar.querySelector('#new-schedule-btn').addEventListener('click', () => {
    showScheduleForm();
  });

  const formArea = document.createElement('div');
  formArea.id = 'schedule-form-area';
  scheduledContent.appendChild(formArea);

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'anim-empty';
    empty.textContent = '还没有定时任务';
    scheduledContent.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement('div');
    item.className = 'schedule-item';
    item.innerHTML = `
      <div class="schedule-info">
        <span class="schedule-prompt">"${escapeHtml(task.prompt)}"</span>
        <span class="schedule-interval">每 ${task.intervalMinutes} 分钟</span>
      </div>
      <div class="schedule-actions">
        <button class="schedule-run-btn" title="立即执行">▶</button>
        <label class="toggle-switch">
          <input type="checkbox" ${task.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <button class="schedule-remove-btn" title="删除">🗑</button>
      </div>
    `;

    item.querySelector('.schedule-run-btn').addEventListener('click', async () => {
      const btn = item.querySelector('.schedule-run-btn');
      btn.textContent = '⏳';
      await api.runScheduledTask(task.id);
      btn.textContent = '▶';
    });

    item.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
      await api.toggleScheduledTask(task.id, e.target.checked);
    });

    item.querySelector('.schedule-remove-btn').addEventListener('click', async () => {
      await api.removeScheduledTask(task.id);
      loadScheduledPanel();
    });

    scheduledContent.appendChild(item);
  }
}

function showScheduleForm() {
  const formArea = document.getElementById('schedule-form-area');
  if (!formArea) return;

  formArea.innerHTML = `
    <div class="schedule-form">
      <div class="setting-group">
        <label>发送内容（Prompt）</label>
        <input type="text" id="schedule-prompt-input" placeholder="例如：生成炫神笑话" />
      </div>
      <div class="setting-group">
        <label>间隔时间（分钟）</label>
        <input type="number" id="schedule-interval-input" value="5" min="1" />
      </div>
      <div class="schedule-form-btns">
        <button class="save-btn" id="save-schedule-btn">保存</button>
        <button class="cancel-btn" id="cancel-schedule-btn">取消</button>
      </div>
    </div>
  `;

  formArea.querySelector('#save-schedule-btn').addEventListener('click', async () => {
    const prompt = formArea.querySelector('#schedule-prompt-input').value.trim();
    const interval = parseInt(formArea.querySelector('#schedule-interval-input').value) || 5;
    if (!prompt) return;
    await api.createScheduledTask(prompt, interval);
    loadScheduledPanel();
  });

  formArea.querySelector('#cancel-schedule-btn').addEventListener('click', () => {
    formArea.innerHTML = '';
  });
}

// ============ Speech Bubble ============
let bubbleFadeTimeout = null;
let bubbleRemoveTimeout = null;
const bubbleQueue = []; // queued contents waiting to be shown
const BUBBLE_WINDOW_SIZE = { width: 320, height: 420 };
const BUBBLE_FADE_DELAY_MS = 180000; // 3 minutes before fade starts
const BUBBLE_FADE_DURATION_MS = 30000; // 30s fade-out animation

function isBubbleVisible() {
  return !!document.getElementById('speech-bubble');
}

function showLoadingBubble() {
  hideBubble(); // clear any existing bubble first

  const bubble = document.createElement('div');
  bubble.id = 'speech-bubble';
  bubble.className = 'speech-bubble loading-bubble';
  bubble.innerHTML = `
    <div class="bubble-text bubble-loading">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;

  const appEl = document.getElementById('app');
  appEl.insertBefore(bubble, petContainer);
  makeInteractive(bubble);

  if (!currentPanel) {
    api.resizeWindow(BUBBLE_WINDOW_SIZE.width, BUBBLE_WINDOW_SIZE.height);
  }
}

function hideLoadingBubble() {
  const bubble = document.getElementById('speech-bubble');
  if (bubble && bubble.classList.contains('loading-bubble')) {
    bubble.remove();
  }
}

// ============ Input Dialog (replacement for unsupported prompt()) ============
function showInputDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'input-dialog-overlay';
    overlay.innerHTML = `
      <div class="input-dialog">
        <div class="input-dialog-title">${message}</div>
        <input type="text" class="input-dialog-input" autofocus />
        <div class="input-dialog-btns">
          <button class="input-dialog-cancel">取消</button>
          <button class="input-dialog-ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.input-dialog-input');
    input.focus();
    const close = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('.input-dialog-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('.input-dialog-ok').addEventListener('click', () => close(input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });
  });
}

function showBubble(content) {
  // If a loading bubble is showing, remove it first (don't queue)
  const existingBubble = document.getElementById('speech-bubble');
  if (existingBubble && existingBubble.classList.contains('loading-bubble')) {
    existingBubble.remove();
  } else if (isBubbleVisible()) {
    // If a content bubble is showing, queue this one
    bubbleQueue.push(content);
    return;
  }

  // Strip think tags — only show the reply
  const { reply } = parseThinkTags(content);

  const bubble = document.createElement('div');
  bubble.id = 'speech-bubble';
  bubble.className = 'speech-bubble';
  bubble.innerHTML = `
    <button class="bubble-close-btn" title="关闭">✕</button>
    <div class="bubble-text markdown-body">${marked.parse(reply)}</div>
    <button class="bubble-copy-btn" title="复制">📋 复制</button>
  `;

  const appEl = document.getElementById('app');
  appEl.insertBefore(bubble, petContainer);

  // Make interactive for click-through
  makeInteractive(bubble);

  bubble.querySelector('.bubble-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    hideBubble();
  });

  bubble.querySelector('.bubble-copy-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(reply);
    const btn = bubble.querySelector('.bubble-copy-btn');
    btn.textContent = '✓ 已复制';
    setTimeout(() => { if (btn.isConnected) btn.textContent = '📋 复制'; }, 1500);
  });

  // Expand window if no panel is open
  if (!currentPanel) {
    api.resizeWindow(BUBBLE_WINDOW_SIZE.width, BUBBLE_WINDOW_SIZE.height);
  }

  // Start fade after BUBBLE_FADE_DELAY_MS
  bubbleFadeTimeout = setTimeout(() => {
    bubble.classList.add('fading');
    bubbleRemoveTimeout = setTimeout(() => hideBubble(), BUBBLE_FADE_DURATION_MS);
  }, BUBBLE_FADE_DELAY_MS);
}

function hideBubble() {
  const bubble = document.getElementById('speech-bubble');
  if (!bubble) return;
  bubble.remove();
  if (bubbleFadeTimeout) { clearTimeout(bubbleFadeTimeout); bubbleFadeTimeout = null; }
  if (bubbleRemoveTimeout) { clearTimeout(bubbleRemoveTimeout); bubbleRemoveTimeout = null; }
  // Shrink window if no panel is open
  if (!currentPanel) {
    api.resizeWindow(PET_SIZE.width, PET_SIZE.height);
  }
  // Show next queued bubble after a short delay
  if (bubbleQueue.length > 0) {
    const next = bubbleQueue.shift();
    setTimeout(() => showBubble(next), 500);
  }
}

// Listen for scheduled task results
api.onScheduledResult(async ({ content }) => {
  if (voiceEnabled) {
    showLoadingBubble();
    const audio = await prepareVoiceAudio(content);
    hideLoadingBubble();
    showBubble(content);
    if (audio) audio.play().catch(() => { });
  } else {
    showBubble(content);
  }
});

// ============ Video Bubble ============
const VIDEO_BUBBLE_SIZE = { width: 420, height: 480 };

function showVideoBubble(embedUrl, title) {
  // Remove any existing bubble first
  hideBubble();
  hideVideoBubble();

  const bubble = document.createElement('div');
  bubble.id = 'video-bubble';
  bubble.className = 'speech-bubble video-bubble';
  bubble.innerHTML = `
    <button class="bubble-close-btn" title="关闭">✕</button>
    <div class="video-title">${title || 'B站视频'}</div>
    <div class="video-container">
      <iframe
        src="${embedUrl}"
        scrolling="no"
        border="0"
        frameborder="no"
        framespacing="0"
        allowfullscreen="true"
      ></iframe>
    </div>
  `;

  const appEl = document.getElementById('app');
  appEl.insertBefore(bubble, petContainer);

  makeInteractive(bubble);

  bubble.querySelector('.bubble-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    hideVideoBubble();
  });

  if (!currentPanel) {
    api.resizeWindow(VIDEO_BUBBLE_SIZE.width, VIDEO_BUBBLE_SIZE.height);
  }
}

function hideVideoBubble() {
  const bubble = document.getElementById('video-bubble');
  if (!bubble) return;
  bubble.remove();
  if (!currentPanel && !isBubbleVisible()) {
    api.resizeWindow(PET_SIZE.width, PET_SIZE.height);
  }
}

api.onPlayVideo(({ embedUrl, title }) => {
  showVideoBubble(embedUrl, title);
});

// ============ Voice Settings ============
const voiceSettingsPanel = document.getElementById('voice-settings-panel');
if (voiceSettingsPanel) makeInteractive(voiceSettingsPanel);
let voiceEnabled = false;

// Load voice enabled state on init
(async () => {
  try {
    const vs = await api.voiceGetSettings();
    voiceEnabled = vs.enabled;
  } catch { /* ignore */ }
})();

api.onVoiceEnabledChanged((enabled) => {
  voiceEnabled = enabled;
});

async function prepareVoiceAudio(text) {
  if (!voiceEnabled) return null;
  try {
    // Strip think tags first (same logic as bubble display)
    const { reply } = parseThinkTags(text);
    // Strip markdown/html for cleaner speech
    const plainText = reply.replace(/<[^>]+>/g, '').replace(/[#*_`~\[\]()]/g, '').trim();
    if (!plainText) return null;
    const result = await api.voiceSpeak(plainText);
    if (result.audioPath) {
      const audio = new Audio(`pet-asset://file/${encodeURIComponent(result.audioPath)}`);
      // Wait for audio to be loadable
      await new Promise((resolve) => {
        audio.addEventListener('canplaythrough', resolve, { once: true });
        audio.addEventListener('error', resolve, { once: true });
        audio.load();
      });
      return audio;
    }
  } catch { /* voice not available, silent fallback */ }
  return null;
}

async function loadVoiceSettings() {
  const content = document.getElementById('voice-settings-content');
  if (!content) return;
  content.innerHTML = '<p style="color:#aaa;">加载中...</p>';

  try {
    const settings = await api.voiceGetSettings();
    let models = [];
    let voices = [];
    try {
      const modelsResult = await api.voiceGetModels();
      models = modelsResult?.models || [];
    } catch { /* service not available */ }
    try {
      const voicesResult = await api.voiceGetVoices();
      voices = voicesResult?.voices || [];
    } catch { /* service not available */ }

    // Fallback: always show at least edge_tts if service returned nothing
    if (models.length === 0) {
      models = [
        { id: 'edge_tts', name: 'Edge TTS (在线)', installed: true, downloaded: true, size_hint: '0MB', description: '微软在线语音合成，无需下载' },
        { id: 'qwen_tts_0.6b', name: 'Qwen3-TTS 0.6B (本地)', installed: true, downloaded: false, size_hint: '~1.2GB', description: 'Qwen3-TTS 0.6B 本地语音合成+克隆' },
        { id: 'qwen_tts_1.7b', name: 'Qwen3-TTS 1.7B (本地-高质量)', installed: true, downloaded: false, size_hint: '~3.5GB', description: 'Qwen3-TTS 1.7B 高质量语音合成+克隆' },
      ];
    }

    let html = `
      <div class="voice-section">
        <h4>语音回复</h4>
        <label class="voice-toggle-label">
          <input type="checkbox" id="voice-enabled-checkbox" ${settings.enabled ? 'checked' : ''} />
          <span>开启语音回复功能</span>
        </label>
      </div>
      <div class="voice-section">
        <h4>语音引擎</h4>
        <div class="voice-models-list">
    `;

    for (const model of models) {
      const isSelected = settings.modelId === model.id;
      html += `
        <div class="voice-model-item ${isSelected ? 'selected' : ''}">
          <div class="voice-model-info">
            <span class="voice-model-name">${model.name}</span>
            <span class="voice-model-desc">${model.description || ''}</span>
          </div>
          <span class="voice-model-size">${model.size_hint}</span>
          <div class="voice-model-actions">
            ${model.downloaded
          ? `<button class="voice-select-btn ${isSelected ? 'active' : ''}" data-model-id="${model.id}">${isSelected ? '✓ 使用中' : '选择'}</button>`
          : `<button class="voice-download-btn" data-model-id="${model.id}">下载</button>`
        }
          </div>
        </div>
      `;
    }

    html += `
        </div>
        <p class="voice-model-path-hint">📂 本地模型下载位置: ~/.cache/huggingface/hub</p>
      </div>
      <div class="voice-section">
        <h4>声线选择</h4>
        <select id="voice-select" class="voice-select">
          <option value="">默认声线</option>
    `;

    // Filter voices based on selected engine
    const edgeVoices = voices.filter(v => v.type === 'edge_tts');
    const qwenVoices = voices.filter(v => v.type === 'qwen_tts');
    const customVoices = voices.filter(v => v.type === 'custom');
    const isQwenEngine = settings.modelId?.startsWith('qwen_tts');

    if (settings.modelId === 'edge_tts') {
      html += '<optgroup label="Edge TTS 预设声线">';
      for (const voice of edgeVoices) {
        html += `<option value="${voice.id}" ${settings.selectedVoiceId === voice.id ? 'selected' : ''}>${voice.name}</option>`;
      }
      html += '</optgroup>';
    } else if (isQwenEngine) {
      html += '<optgroup label="Qwen3-TTS 预设声线">';
      for (const voice of qwenVoices) {
        html += `<option value="${voice.id}" ${settings.selectedVoiceId === voice.id ? 'selected' : ''}>${voice.name}</option>`;
      }
      html += '</optgroup>';
      if (customVoices.length > 0) {
        html += '<optgroup label="自定义声线 (克隆)">';
        for (const voice of customVoices) {
          html += `<option value="${voice.id}" ${settings.selectedVoiceId === voice.id ? 'selected' : ''}>${voice.name}</option>`;
        }
        html += '</optgroup>';
      }
    }

    html += `
        </select>
    `;

    // Upload button always available (file saved locally)
    html += `<button id="voice-upload-btn" class="voice-upload-btn">📁 上传语音样本 (用于声线克隆)</button>`;

    html += `
      </div>
      <div class="voice-section" id="voice-list-section">
        <h4>自定义声线</h4>
        <div class="voice-list">
    `;

    if (customVoices.length === 0) {
      html += '<p style="color:#888;">暂无自定义声线，上传 3 秒以上语音样本即可克隆声线</p>';
    } else {
      for (const voice of customVoices) {
        html += `
          <div class="voice-item">
            <span>${voice.name}</span>
            <button class="voice-delete-btn" data-voice-id="${voice.id}">删除</button>
          </div>
        `;
      }
    }

    html += '</div></div>';
    content.innerHTML = html;

    // Bind events
    document.getElementById('voice-enabled-checkbox')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await api.voiceSetSettings({ enabled });
      voiceEnabled = enabled;
    });

    document.getElementById('voice-select')?.addEventListener('change', async (e) => {
      await api.voiceSetSettings({ selectedVoiceId: e.target.value });
    });

    document.getElementById('voice-upload-btn')?.addEventListener('click', async () => {
      const result = await api.voiceUploadSample();
      if (result && !result.error) {
        loadVoiceSettings();
      } else if (result?.error) {
        alert('上传失败: ' + result.error);
      }
    });

    content.querySelectorAll('.voice-select-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.modelId;
        await api.voiceSelectModel(modelId);
        await api.voiceSetSettings({ modelId });
        loadVoiceSettings();
      });
    });

    content.querySelectorAll('.voice-download-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const modelId = btn.dataset.modelId;
        btn.disabled = true;
        btn.textContent = '下载中...';
        // Show progress hint near the button
        const item = btn.closest('.voice-model-item');
        let progressEl = item.querySelector('.voice-download-progress');
        if (!progressEl) {
          progressEl = document.createElement('div');
          progressEl.className = 'voice-download-progress';
          item.appendChild(progressEl);
        }
        progressEl.textContent = '正在下载模型，可能需要几分钟...';

        const result = await api.voiceDownloadModel(modelId);
        if (result?.error) {
          btn.textContent = '下载失败';
          progressEl.textContent = '❌ ' + result.error;
          progressEl.style.color = '#e44';
          setTimeout(() => { btn.textContent = '重试'; btn.disabled = false; }, 3000);
        } else {
          progressEl.textContent = '✓ 下载完成！';
          progressEl.style.color = '#4caf50';
          setTimeout(() => loadVoiceSettings(), 1000);
        }
      });
    });

    content.querySelectorAll('.voice-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('确认删除该声线？')) {
          await api.voiceDeleteVoice(btn.dataset.voiceId);
          loadVoiceSettings();
        }
      });
    });
  } catch (err) {
    content.innerHTML = `<p style="color:#f66;">加载失败: ${err.message || '语音服务未启动'}</p>
      <p style="color:#aaa;font-size:12px;">请确保已运行 start.sh 或手动启动语音服务</p>`;
  }
}
