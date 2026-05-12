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
let isFullscreen = false;

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

// ============ DOM Refs ============
const petContainer = document.getElementById('pet-container');
const petSprite = document.getElementById('pet-sprite');
const chatPanel = document.getElementById('chat-panel');
const interactPanel = document.getElementById('interact-panel');
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
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const modelInput = document.getElementById('model-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const systemPromptInput = document.getElementById('system-prompt-input');
const interactResponse = document.getElementById('interact-response');

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
for (const panel of [chatPanel, interactPanel, settingsPanel, animationsPanel, playlistPanel, songPickerPanel, skillsPanel, scheduledPanel]) {
  if (panel) makeInteractive(panel);
}

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
  if (e.target.closest('.resize-handle')) return;
  if (e.target.closest('.speech-bubble')) return;
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
    if (!isDragging) {
      isDragging = true;
      // Show drag animation
      if (hasCustomFrames('drag')) {
        const frames = petAnimations['drag'];
        showFrame(frames[Math.floor(Math.random() * frames.length)]);
      }
    }
    api.moveWindow(dx, dy);
    dragStartX = e.screenX;
    dragStartY = e.screenY;
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    returnToIdle();
  }
  mouseDownOnPet = false;
  isDragging = false;
});

// ============ Double-click → Random Animation ============
petContainer.addEventListener('dblclick', (e) => {
  e.preventDefault();
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
    setTimeout(() => returnToIdle(), ACTION_DURATION);
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
api.onMenuAction((action) => {
  console.log('[menu] action:', action);
  if (action === 'chat') {
    openPanel('chat-panel');
  } else if (action === 'interact') {
    openPanel('interact-panel');
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
  } else if (action === 'fullscreen') {
    toggleFullscreen();
  } else if (action === 'roaming') {
    toggleRoaming();
  }
});

async function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  await api.toggleFullscreen(isFullscreen);
}

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
  [chatPanel, interactPanel, settingsPanel, animationsPanel, playlistPanel, songPickerPanel, skillsPanel, scheduledPanel].forEach((p) => {
    p.classList.remove('visible');
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

    // Map interaction to emotion
    const emotionMap = { pet: 'happy', feed: 'happy', play: 'surprise', sleep: 'sleep' };
    const emotion = emotionMap[action] || 'happy';
    playEmotion(emotion, ACTION_DURATION);
  });
});

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
  petSprite.style.backgroundImage = `url("${assetURL}")`;
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
  if (!isRoaming && direction === 0) {
    // Roaming stopped
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

function showBubble(content) {
  // If a bubble is already showing, queue this one
  if (isBubbleVisible()) {
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
api.onScheduledResult(({ content }) => {
  showBubble(content);
});
