import { BrowserWindow, ipcMain, Menu, app, dialog, screen, globalShortcut, clipboard } from 'electron';
import { copyFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { is } from '@electron-toolkit/utils';
import Store from 'electron-store';
import { AppSettings, IPC_CHANNELS, ChatMessage, PetEmotion, PetAnimations, Skill, ScheduledTask, MenuShortcuts, VoiceSettings, CustomInteraction, CustomTool } from '@xuanshen/shared';
import { chatWithAI } from './ai';
import { startVoiceService, stopVoiceService, voiceGetModels, voiceDownloadModel, voiceSelectModel, voiceGetVoices, voiceUploadSample, voiceDeleteVoice, voiceSpeak, isVoiceServiceRunning } from './voice';

function getAnimationsDir(): string {
  const dir = join(app.getPath('userData'), 'pet-animations');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getEmotionDir(emotion: PetEmotion): string {
  const dir = join(getAnimationsDir(), emotion);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function toAssetURL(filePath: string): string {
  // Encode the path so Windows backslashes and colons don't break the URL
  const encoded = encodeURIComponent(filePath);
  return `pet-asset://file/${encoded}`;
}

export function setupIPC(win: BrowserWindow, store: Store<AppSettings>): void {
  const shortcutActionMap: Record<keyof MenuShortcuts, string> = {
    quickChat: 'quick-chat',
    chat: 'chat',
    interact: 'interact',
    settings: 'settings',
    animations: 'animations',
    skills: 'skills',
    playlist: 'playlist',
    scheduled: 'scheduled',
    roaming: 'roaming',
    video: 'video',
  };

  let quickChatWin: BrowserWindow | null = null;

  function createQuickChatWindow() {
    const display = screen.getPrimaryDisplay().workArea;
    const width = Math.min(680, Math.max(480, display.width - 200));
    const height = 110;
    const x = Math.round(display.x + (display.width - width) / 2);
    const y = Math.round(display.y + (display.height - height) / 2);

    quickChatWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/quick-chat.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    quickChatWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      quickChatWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/quick-chat.html`);
    } else {
      quickChatWin.loadFile(join(__dirname, '../renderer/quick-chat.html'));
    }

    quickChatWin.once('ready-to-show', () => {
      quickChatWin?.show();
      quickChatWin?.focus();
    });

    quickChatWin.on('closed', () => {
      quickChatWin = null;
    });

    quickChatWin.on('blur', () => {
      // Auto-close when losing focus
      if (quickChatWin && !quickChatWin.isDestroyed()) {
        quickChatWin.close();
      }
    });
  }

  function showQuickChat() {
    if (quickChatWin && !quickChatWin.isDestroyed()) {
      quickChatWin.focus();
      return;
    }
    createQuickChatWindow();
  }

  function closeQuickChat() {
    if (quickChatWin && !quickChatWin.isDestroyed()) {
      quickChatWin.close();
      quickChatWin = null;
    }
  }

  function sendMenuAction(action: string) {
    if (action === 'quick-chat') {
      showQuickChat();
      return;
    }
    if (action === 'video') {
      showVideoInput();
      return;
    }
    win.webContents.send('menu:action', action);
  }

  function registerGlobalShortcuts(shortcuts: MenuShortcuts) {
    globalShortcut.unregisterAll();
    for (const key of Object.keys(shortcutActionMap) as (keyof MenuShortcuts)[]) {
      const accelerator = shortcuts[key]?.trim();
      if (!accelerator) continue;
      try {
        globalShortcut.register(accelerator, () => {
          sendMenuAction(shortcutActionMap[key]);
        });
      } catch {
        // Ignore invalid or unavailable accelerators.
      }
    }
  }

  // Helper: build system prompt with skills injected
  function buildSystemPromptWithSkills(): string {
    const settings = store.store;
    let prompt = settings.systemPrompt;
    const skills = settings.skills || [];
    if (skills.length > 0) {
      prompt += '\n\n## 你掌握的技能\n\n' + skills.map((s) => `### ${s.name}\n${s.content}`).join('\n\n');
    }
    return prompt;
  }
  // Mouse event forwarding (click-through transparent areas)
  ipcMain.on('window:set-ignore-mouse', (_event, ignore: boolean) => {
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return store.store;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, settings: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value);
    }
    registerGlobalShortcuts(store.store.shortcuts);
    return store.store;
  });

  ipcMain.handle('quick-chat:send', async (_event, text: string) => {
    closeQuickChat();
    // Tell pet window to show loading bubble
    win.webContents.send('quick-chat:loading');

    const settings = store.store;
    const provider = settings.providers.find((p) => p.id === settings.currentProvider);
    if (!provider || !provider.apiKey) {
      win.webContents.send('quick-chat:result', { error: '请先在设置中配置 API Key' });
      return;
    }
    const systemPrompt = buildSystemPromptWithSkills();
    const messages: ChatMessage[] = [{ role: 'user', content: text }];
    try {
      const reply = await chatWithAI(provider, messages, systemPrompt);
      win.webContents.send('quick-chat:result', { content: reply });
    } catch (err: any) {
      win.webContents.send('quick-chat:result', { error: err.message || '请求失败' });
    }
  });

  ipcMain.handle('quick-chat:close', () => {
    closeQuickChat();
  });

  // Chat
  ipcMain.handle(
    IPC_CHANNELS.CHAT_SEND,
    async (_event, messages: ChatMessage[]) => {
      const settings = store.store;
      const provider = settings.providers.find((p) => p.id === settings.currentProvider);
      if (!provider || !provider.apiKey) {
        return { error: '请先在设置中配置 API Key' };
      }
      try {
        const systemPrompt = buildSystemPromptWithSkills();
        const reply = await chatWithAI(provider, messages, systemPrompt);
        return { content: reply };
      } catch (err: any) {
        return { error: err.message || '请求失败' };
      }
    }
  );

  // Window drag — legacy fallback (single move)
  ipcMain.on('window:move', (_event, { dx, dy }: { dx: number; dy: number }) => {
    if (dx === 0 && dy === 0) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy, false);
  });

  // Window drag — main-process cursor polling (no IPC flooding)
  let dragInterval: ReturnType<typeof setInterval> | null = null;
  let dragCursorX = 0;
  let dragCursorY = 0;

  ipcMain.on('window:drag-start', (_event, { screenX, screenY }: { screenX: number; screenY: number }) => {
    if (dragInterval) return; // already dragging
    dragCursorX = screenX;
    dragCursorY = screenY;
    // Poll cursor position at ~120Hz — no IPC needed during drag
    dragInterval = setInterval(() => {
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - dragCursorX;
      const dy = cursor.y - dragCursorY;
      if (dx !== 0 || dy !== 0) {
        const [wx, wy] = win.getPosition();
        win.setPosition(wx + dx, wy + dy, false);
        dragCursorX = cursor.x;
        dragCursorY = cursor.y;
      }
    }, 8);
  });

  ipcMain.on('window:drag-end', () => {
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
  });

  // Window resize for panels — keep bottom edge and horizontal center anchored
  ipcMain.handle('window:resize', (_event, { width, height }: { width: number; height: number }) => {
    const [x, y] = win.getPosition();
    const [oldWidth, oldHeight] = win.getSize();
    const dx = oldWidth - width;
    const dy = oldHeight - height;
    win.setBounds({ x: x + Math.round(dx / 2), y: y + dy, width, height });
  });

  // ============ Pet Animations ============
  // Pick webp files for a given emotion
  ipcMain.handle('animations:pick', async (_event, emotion: PetEmotion) => {
    const result = await dialog.showOpenDialog(win, {
      title: `选择动作文件 (${emotion})`,
      filters: [{ name: 'WebP / GIF 图片', extensions: ['webp', 'gif', 'png', 'apng'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const emotionDir = getEmotionDir(emotion);
    const added: string[] = [];
    for (const src of result.filePaths) {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(src)}`;
      const dest = join(emotionDir, filename);
      copyFileSync(src, dest);
      added.push(toAssetURL(dest));
    }
    return added;
  });

  // Get all animations grouped by emotion (returns pet-asset:// URLs)
  ipcMain.handle('animations:get', () => {
    const result: Record<PetEmotion, string[]> = {
      happy: [], idle: [], move: [], drag: [], sing: [], angry: [],
      sad: [], surprise: [], scared: [], sleep: [],
    };
    for (const emotion of Object.keys(result) as PetEmotion[]) {
      const dir = getEmotionDir(emotion);
      try {
        result[emotion] = readdirSync(dir)
          .filter((f) => /\.(webp|gif|png|apng)$/i.test(f))
          .map((f) => toAssetURL(join(dir, f)));
      } catch {
        result[emotion] = [];
      }
    }
    return result;
  });

  // Remove a specific animation file (receives pet-asset:// URL, convert back)
  ipcMain.handle('animations:remove', (_event, assetURL: string) => {
    try {
      const url = new URL(assetURL);
      const filePath = decodeURIComponent(url.pathname.slice(1));
      if (existsSync(filePath)) unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Pick default pet image (overwrite any existing default)
  ipcMain.handle('animations:pickDefault', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择默认宠物图片',
      filters: [{ name: '图片', extensions: ['webp', 'gif', 'png', 'svg'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const dir = getAnimationsDir();
    // Delete any existing default files first
    try {
      const oldFiles = readdirSync(dir).filter((f) => f.startsWith('default'));
      for (const f of oldFiles) unlinkSync(join(dir, f));
    } catch { /* ignore */ }
    const src = result.filePaths[0];
    const filename = `default${extname(src)}`;
    const dest = join(dir, filename);
    copyFileSync(src, dest);
    return `${toAssetURL(dest)}?t=${Date.now()}`;
  });

  // Get default pet image
  ipcMain.handle('animations:getDefault', () => {
    const dir = getAnimationsDir();
    try {
      const files = readdirSync(dir).filter((f) => f.startsWith('default'));
      if (files.length > 0) return toAssetURL(join(dir, files[0]));
    } catch { /* ignore */ }
    return null;
  });

  // ============ Songs / Playlist ============
  function getSongsDir(): string {
    const dir = join(app.getPath('userData'), 'pet-songs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  ipcMain.handle('songs:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '添加歌曲',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const dir = getSongsDir();
    const added: string[] = [];
    for (const src of result.filePaths) {
      const filename = `${Date.now()}-${basename(src)}`;
      const dest = join(dir, filename);
      copyFileSync(src, dest);
      added.push(toAssetURL(dest));
    }
    return added;
  });

  ipcMain.handle('songs:get', () => {
    const dir = getSongsDir();
    try {
      return readdirSync(dir)
        .filter((f) => /\.(mp3|wav|ogg|flac|m4a)$/i.test(f))
        .map((f) => ({ name: f.replace(/^\d+-/, ''), url: toAssetURL(join(dir, f)) }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('songs:remove', (_event, assetURL: string) => {
    try {
      const filePath = decodeURIComponent(new URL(assetURL).pathname);
      if (existsSync(filePath)) unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // ============ Custom Interactions ============
  function getInteractionsDir(): string {
    const dir = join(app.getPath('userData'), 'pet-interactions');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  ipcMain.handle('interactions:get', () => {
    return store.get('interactions', []) as CustomInteraction[];
  });

  ipcMain.handle('interactions:create', async (_event, name: string) => {
    // Pick animation file (webp)
    const animResult = await dialog.showOpenDialog(win, {
      title: '选择互动动画 (WebP)',
      filters: [{ name: '动画', extensions: ['webp', 'gif', 'apng'] }],
      properties: ['openFile'],
    });
    if (animResult.canceled || animResult.filePaths.length === 0) return null;

    // Pick audio file
    const audioResult = await dialog.showOpenDialog(win, {
      title: '选择互动音效',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }],
      properties: ['openFile'],
    });
    if (audioResult.canceled || audioResult.filePaths.length === 0) return null;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = getInteractionsDir();
    const animExt = extname(animResult.filePaths[0]);
    const audioExt = extname(audioResult.filePaths[0]);
    const animFile = `${id}-anim${animExt}`;
    const audioFile = `${id}-audio${audioExt}`;

    copyFileSync(animResult.filePaths[0], join(dir, animFile));
    copyFileSync(audioResult.filePaths[0], join(dir, audioFile));

    const interaction: CustomInteraction = { id, name, animationFile: animFile, audioFile };
    const list = (store.get('interactions', []) as CustomInteraction[]).slice();
    list.push(interaction);
    store.set('interactions', list);
    return interaction;
  });

  ipcMain.handle('interactions:remove', (_event, id: string) => {
    const list = (store.get('interactions', []) as CustomInteraction[]).slice();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    const item = list[idx];
    const dir = getInteractionsDir();
    try { unlinkSync(join(dir, item.animationFile)); } catch { }
    try { unlinkSync(join(dir, item.audioFile)); } catch { }
    list.splice(idx, 1);
    store.set('interactions', list);
    return true;
  });

  ipcMain.handle('interactions:get-assets', (_event, id: string) => {
    const list = store.get('interactions', []) as CustomInteraction[];
    const item = list.find((i) => i.id === id);
    if (!item) return null;
    const dir = getInteractionsDir();
    return {
      animationUrl: toAssetURL(join(dir, item.animationFile)),
      audioUrl: toAssetURL(join(dir, item.audioFile)),
    };
  });

  // ============ Custom Tools ============
  function getToolsDir(): string {
    const dir = join(app.getPath('userData'), 'pet-tools');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  ipcMain.handle('tools:get', () => {
    return store.get('tools', []) as CustomTool[];
  });

  ipcMain.handle('tools:create', async (_event, name: string) => {
    // Pick icon image (cursor)
    const iconResult = await dialog.showOpenDialog(win, {
      title: '选择工具图标 (显示为鼠标)',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (iconResult.canceled || iconResult.filePaths.length === 0) return null;

    // Pick animation file (webp played on click)
    const animResult = await dialog.showOpenDialog(win, {
      title: '选择点击宠物时播放的动画 (WebP)',
      filters: [{ name: '动画', extensions: ['webp', 'gif', 'apng'] }],
      properties: ['openFile'],
    });
    if (animResult.canceled || animResult.filePaths.length === 0) return null;

    // Pick audio file
    const audioResult = await dialog.showOpenDialog(win, {
      title: '选择点击宠物时播放的音效',
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }],
      properties: ['openFile'],
    });
    if (audioResult.canceled || audioResult.filePaths.length === 0) return null;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = getToolsDir();
    const iconExt = extname(iconResult.filePaths[0]);
    const animExt = extname(animResult.filePaths[0]);
    const audioExt = extname(audioResult.filePaths[0]);
    const iconFile = `${id}-icon${iconExt}`;
    const animFile = `${id}-anim${animExt}`;
    const audioFile = `${id}-audio${audioExt}`;

    copyFileSync(iconResult.filePaths[0], join(dir, iconFile));
    copyFileSync(animResult.filePaths[0], join(dir, animFile));
    copyFileSync(audioResult.filePaths[0], join(dir, audioFile));

    const tool: CustomTool = { id, name, iconFile, animationFile: animFile, audioFile };
    const list = (store.get('tools', []) as CustomTool[]).slice();
    list.push(tool);
    store.set('tools', list);
    return tool;
  });

  ipcMain.handle('tools:remove', (_event, id: string) => {
    const list = (store.get('tools', []) as CustomTool[]).slice();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const item = list[idx];
    const dir = getToolsDir();
    try { unlinkSync(join(dir, item.iconFile)); } catch { }
    try { unlinkSync(join(dir, item.animationFile)); } catch { }
    try { unlinkSync(join(dir, item.audioFile)); } catch { }
    list.splice(idx, 1);
    store.set('tools', list);
    return true;
  });

  ipcMain.handle('tools:get-assets', (_event, id: string) => {
    const list = store.get('tools', []) as CustomTool[];
    const item = list.find((t) => t.id === id);
    if (!item) return null;
    const dir = getToolsDir();
    return {
      iconUrl: toAssetURL(join(dir, item.iconFile)),
      animationUrl: toAssetURL(join(dir, item.animationFile)),
      audioUrl: toAssetURL(join(dir, item.audioFile)),
    };
  });

  // ============ Skills ============
  ipcMain.handle('skills:get', () => {
    return store.get('skills', []);
  });

  ipcMain.handle('skills:create', (_event, name: string, content: string) => {
    const skills = (store.get('skills', []) as Skill[]).slice();
    const skill: Skill = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      content,
    };
    skills.push(skill);
    store.set('skills', skills);
    return skill;
  });

  ipcMain.handle('skills:update', (_event, id: string, name: string, content: string) => {
    const skills = (store.get('skills', []) as Skill[]).slice();
    const idx = skills.findIndex((s) => s.id === id);
    if (idx >= 0) {
      skills[idx] = { ...skills[idx], name, content };
      store.set('skills', skills);
      return skills[idx];
    }
    return null;
  });

  ipcMain.handle('skills:remove', (_event, id: string) => {
    const skills = (store.get('skills', []) as Skill[]).slice();
    store.set('skills', skills.filter((s) => s.id !== id));
    return true;
  });

  ipcMain.handle('skills:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '导入技能文档',
      filters: [{ name: 'Markdown / 文本', extensions: ['md', 'txt'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = readFileSync(filePath, 'utf-8');
    const name = basename(filePath).replace(/\.(md|txt)$/, '') || '未命名技能';
    const skills = (store.get('skills', []) as Skill[]).slice();
    const skill: Skill = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      content,
    };
    skills.push(skill);
    store.set('skills', skills);
    return skill;
  });

  // ============ Scheduled Tasks ============
  const taskTimers = new Map<string, ReturnType<typeof setInterval>>();

  async function executeScheduledTask(task: ScheduledTask) {
    const settings = store.store;
    const provider = settings.providers.find((p) => p.id === settings.currentProvider);
    if (!provider || !provider.apiKey) return;
    const systemPrompt = buildSystemPromptWithSkills();
    const messages: ChatMessage[] = [{ role: 'user', content: task.prompt }];
    try {
      const reply = await chatWithAI(provider, messages, systemPrompt);
      win.webContents.send('scheduled:result', { content: reply });
    } catch { /* ignore scheduled task errors */ }
  }

  function startTaskTimer(task: ScheduledTask) {
    stopTaskTimer(task.id);
    if (!task.enabled) return;
    const timer = setInterval(() => executeScheduledTask(task), task.intervalMinutes * 60 * 1000);
    taskTimers.set(task.id, timer);
  }

  function stopTaskTimer(taskId: string) {
    const timer = taskTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      taskTimers.delete(taskId);
    }
  }

  // Start all enabled tasks on init
  const initialTasks = (store.get('scheduledTasks', []) as ScheduledTask[]);
  for (const task of initialTasks) {
    if (task.enabled) startTaskTimer(task);
  }

  ipcMain.handle('scheduled:get', () => {
    return store.get('scheduledTasks', []);
  });

  ipcMain.handle('scheduled:create', (_event, prompt: string, intervalMinutes: number) => {
    const tasks = (store.get('scheduledTasks', []) as ScheduledTask[]).slice();
    const task: ScheduledTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      intervalMinutes,
      enabled: true,
    };
    tasks.push(task);
    store.set('scheduledTasks', tasks);
    startTaskTimer(task);
    return task;
  });

  ipcMain.handle('scheduled:update', (_event, updatedTask: ScheduledTask) => {
    const tasks = (store.get('scheduledTasks', []) as ScheduledTask[]).slice();
    const idx = tasks.findIndex((t) => t.id === updatedTask.id);
    if (idx >= 0) {
      tasks[idx] = updatedTask;
      store.set('scheduledTasks', tasks);
      if (updatedTask.enabled) {
        startTaskTimer(updatedTask);
      } else {
        stopTaskTimer(updatedTask.id);
      }
      return tasks[idx];
    }
    return null;
  });

  ipcMain.handle('scheduled:remove', (_event, id: string) => {
    const tasks = (store.get('scheduledTasks', []) as ScheduledTask[]).slice();
    store.set('scheduledTasks', tasks.filter((t) => t.id !== id));
    stopTaskTimer(id);
    return true;
  });

  ipcMain.handle('scheduled:toggle', (_event, id: string, enabled: boolean) => {
    const tasks = (store.get('scheduledTasks', []) as ScheduledTask[]).slice();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      tasks[idx].enabled = enabled;
      store.set('scheduledTasks', tasks);
      if (enabled) {
        startTaskTimer(tasks[idx]);
      } else {
        stopTaskTimer(id);
      }
      return tasks[idx];
    }
    return null;
  });

  ipcMain.handle('scheduled:run-now', async (_event, id: string) => {
    const tasks = (store.get('scheduledTasks', []) as ScheduledTask[]);
    const task = tasks.find((t) => t.id === id);
    if (task) {
      await executeScheduledTask(task);
    }
  });

  // ============ Roaming ============
  let roamingTimeout: ReturnType<typeof setTimeout> | null = null;
  let roamingMoving = false;
  let roamingDirection = 1;
  let roamingEnabled = false;
  let roamingMoveInterval: ReturnType<typeof setInterval> | null = null;
  const ROAM_STEP = 2;
  const ROAM_MOVE_INTERVAL = 40;
  const ACTION_DURATION_MS = 9000;

  function roamingTick() {
    if (!roamingEnabled) return;

    if (roamingMoving) {
      // Was moving → stop and trigger random emotion
      roamingMoving = false;
      if (roamingMoveInterval) { clearInterval(roamingMoveInterval); roamingMoveInterval = null; }
      win.webContents.send('roaming:state', { moving: false, direction: roamingDirection });
      // Next tick: pause 9s for animation then move again
      const pause = ACTION_DURATION_MS;
      roamingTimeout = setTimeout(roamingTick, pause);
    } else {
      // Was stopped → start moving
      roamingMoving = true;
      // Maybe change direction
      if (Math.random() < 0.3) roamingDirection *= -1;
      win.webContents.send('roaming:state', { moving: true, direction: roamingDirection });
      // Move for 3-8s (walking most of the time)
      roamingMoveInterval = setInterval(() => {
        const [x, y] = win.getPosition();
        const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
        const [winW] = win.getSize();
        const newX = x + ROAM_STEP * roamingDirection;
        if (newX <= 0) { roamingDirection = 1; win.webContents.send('roaming:state', { moving: true, direction: 1 }); }
        else if (newX + winW >= screenWidth) { roamingDirection = -1; win.webContents.send('roaming:state', { moving: true, direction: -1 }); }
        win.setPosition(newX, y);
      }, ROAM_MOVE_INTERVAL);
      const moveDuration = 3000 + Math.random() * 5000;
      roamingTimeout = setTimeout(roamingTick, moveDuration);
    }
  }

  function stopRoaming() {
    roamingEnabled = false;
    roamingMoving = false;
    if (roamingTimeout) { clearTimeout(roamingTimeout); roamingTimeout = null; }
    if (roamingMoveInterval) { clearInterval(roamingMoveInterval); roamingMoveInterval = null; }
  }

  ipcMain.handle('roaming:toggle', (_event, enabled: boolean) => {
    if (enabled) {
      roamingEnabled = true;
      roamingDirection = Math.random() > 0.5 ? 1 : -1;
      roamingMoving = false;
      roamingTick();
    } else {
      stopRoaming();
      win.webContents.send('roaming:state', { moving: false, direction: 0 });
    }
  });

  // ============ Video Playback ============
  function parseBilibiliUrl(url: string): { bvid?: string; aid?: string; page?: number } | null {
    try {
      const bvMatch = url.match(/BV[A-Za-z0-9]+/);
      const avMatch = url.match(/av(\d+)/i);
      const pageMatch = url.match(/[?&]p=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1]) : 1;
      if (bvMatch) return { bvid: bvMatch[0], page };
      if (avMatch) return { aid: avMatch[1], page };
    } catch { /* ignore */ }
    return null;
  }

  function buildBilibiliEmbedUrl(parsed: { bvid?: string; aid?: string; page?: number }): string {
    const params = new URLSearchParams({
      autoplay: '1',
      high_quality: '1',
    });
    if (parsed.bvid) params.set('bvid', parsed.bvid);
    if (parsed.aid) params.set('aid', parsed.aid);
    if (parsed.page && parsed.page > 1) params.set('p', String(parsed.page));
    return `https://player.bilibili.com/player.html?${params.toString()}`;
  }

  let videoInputWin: BrowserWindow | null = null;

  function createVideoInputWindow() {
    const display = screen.getPrimaryDisplay().workArea;
    const width = Math.min(680, Math.max(480, display.width - 200));
    const height = 110;
    const x = Math.round(display.x + (display.width - width) / 2);
    const y = Math.round(display.y + (display.height - height) / 2);

    videoInputWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/video-input.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    videoInputWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      videoInputWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/video-input.html`);
    } else {
      videoInputWin.loadFile(join(__dirname, '../renderer/video-input.html'));
    }

    videoInputWin.once('ready-to-show', () => {
      videoInputWin?.show();
      videoInputWin?.focus();
    });

    videoInputWin.on('closed', () => {
      videoInputWin = null;
    });

    videoInputWin.on('blur', () => {
      if (videoInputWin && !videoInputWin.isDestroyed()) {
        videoInputWin.close();
      }
    });
  }

  function showVideoInput() {
    if (videoInputWin && !videoInputWin.isDestroyed()) {
      videoInputWin.focus();
      return;
    }
    createVideoInputWindow();
  }

  function closeVideoInput() {
    if (videoInputWin && !videoInputWin.isDestroyed()) {
      videoInputWin.close();
      videoInputWin = null;
    }
  }

  ipcMain.handle('video-input:clipboard', () => {
    try {
      const clipText = clipboard.readText().trim();
      if (clipText.includes('bilibili.com') || clipText.match(/BV[A-Za-z0-9]+/) || clipText.match(/av\d+/i)) {
        return clipText;
      }
    } catch { /* ignore */ }
    return '';
  });

  ipcMain.handle('video-input:send', (_event, url: string) => {
    closeVideoInput();
    const parsed = parseBilibiliUrl(url);
    if (parsed) {
      const embedUrl = buildBilibiliEmbedUrl(parsed);
      win.webContents.send('video:play', { embedUrl, title: parsed.bvid || `av${parsed.aid}` });
    } else {
      // Invalid URL → open chat panel and show error bubble
      win.webContents.send('menu:action', 'chat');
      win.webContents.send('quick-chat:result', { error: '❌ 无效的B站链接，请粘贴正确的 bilibili.com 视频链接' });
    }
  });

  ipcMain.handle('video-input:close', () => {
    closeVideoInput();
  });

  // ============ Voice TTS ============
  const VOICE_DATA_DIR = join(app.getPath('home'), '.xuanshen', 'voices');
  if (!existsSync(VOICE_DATA_DIR)) mkdirSync(VOICE_DATA_DIR, { recursive: true });

  const EDGE_TTS_VOICES = [
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女声-温柔)', type: 'edge_tts', lang: 'zh' },
    { id: 'zh-CN-YunxiNeural', name: '云希 (男声-阳光)', type: 'edge_tts', lang: 'zh' },
    { id: 'zh-CN-YunjianNeural', name: '云健 (男声-沉稳)', type: 'edge_tts', lang: 'zh' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓依 (女声-活泼)', type: 'edge_tts', lang: 'zh' },
    { id: 'zh-CN-YunyangNeural', name: '云扬 (男声-新闻)', type: 'edge_tts', lang: 'zh' },
    { id: 'zh-TW-HsiaoChenNeural', name: '曉臻 (女声-台湾)', type: 'edge_tts', lang: 'zh' },
    { id: 'en-US-JennyNeural', name: 'Jenny (Female-EN)', type: 'edge_tts', lang: 'en' },
    { id: 'en-US-GuyNeural', name: 'Guy (Male-EN)', type: 'edge_tts', lang: 'en' },
    { id: 'ja-JP-NanamiNeural', name: '七海 (女声-日语)', type: 'edge_tts', lang: 'ja' },
  ];

  const QWEN_SPEAKERS = [
    { id: 'qwen:Vivian', name: 'Vivian (女声-明亮)', type: 'qwen_tts', lang: 'zh' },
    { id: 'qwen:Serena', name: 'Serena (女声-温暖)', type: 'qwen_tts', lang: 'zh' },
    { id: 'qwen:Uncle_Fu', name: 'Uncle Fu (男声-沉稳)', type: 'qwen_tts', lang: 'zh' },
    { id: 'qwen:Dylan', name: 'Dylan (男声-北京)', type: 'qwen_tts', lang: 'zh' },
    { id: 'qwen:Eric', name: 'Eric (男声-四川)', type: 'qwen_tts', lang: 'zh' },
    { id: 'qwen:Ryan', name: 'Ryan (Male-EN)', type: 'qwen_tts', lang: 'en' },
    { id: 'qwen:Aiden', name: 'Aiden (Male-EN)', type: 'qwen_tts', lang: 'en' },
    { id: 'qwen:Ono_Anna', name: 'Ono Anna (女声-日语)', type: 'qwen_tts', lang: 'ja' },
    { id: 'qwen:Sohee', name: 'Sohee (女声-韩语)', type: 'qwen_tts', lang: 'ko' },
  ];

  function getLocalVoices() {
    const voices = [...EDGE_TTS_VOICES, ...QWEN_SPEAKERS];
    // Scan custom voices directory
    if (existsSync(VOICE_DATA_DIR)) {
      const files = readdirSync(VOICE_DATA_DIR);
      for (const f of files.sort()) {
        if (/\.(wav|mp3|flac|ogg|m4a)$/i.test(f)) {
          voices.push({
            id: `custom:${f}`,
            name: `🎙 ${f.replace(/\.[^.]+$/, '')}`,
            type: 'custom',
            lang: 'any',
          });
        }
      }
    }
    return voices;
  }

  ipcMain.handle('voice:get-models', async () => {
    // Try service first for accurate download status, fall back to local data
    try {
      if (!isVoiceServiceRunning()) await startVoiceService();
      return await voiceGetModels();
    } catch {
      // Service unavailable — return local fallback
      return {
        models: [
          { id: 'edge_tts', name: 'Edge TTS (在线)', installed: true, downloaded: true, size_hint: '0MB', description: '微软在线语音合成，无需下载，多种中/英/日声线' },
          { id: 'qwen_tts_0.6b', name: 'Qwen3-TTS 0.6B (本地)', installed: true, downloaded: false, size_hint: '~1.2GB', description: 'Qwen3-TTS 0.6B 本地语音合成+克隆' },
          { id: 'qwen_tts_1.7b', name: 'Qwen3-TTS 1.7B (本地-高质量)', installed: true, downloaded: false, size_hint: '~3.5GB', description: 'Qwen3-TTS 1.7B 高质量语音合成+克隆' },
        ],
      };
    }
  });

  ipcMain.handle('voice:download-model', async (_event, modelId: string) => {
    try {
      if (!isVoiceServiceRunning()) {
        const started = await startVoiceService();
        if (!started) return { error: '语音服务启动失败。请确保已安装 Python 3 和依赖: pip3 install edge-tts fastapi uvicorn soundfile' };
      }
      return await voiceDownloadModel(modelId);
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('voice:select-model', async (_event, modelId: string) => {
    // Update local store immediately (always works)
    const current = store.get('voice', { enabled: false, modelId: 'edge_tts', selectedVoiceId: '' }) as VoiceSettings;
    store.set('voice', { ...current, modelId });
    // Notify service if running (best effort)
    try {
      if (isVoiceServiceRunning()) await voiceSelectModel(modelId);
    } catch { /* ignore */ }
    return { status: 'ok', current_engine: modelId };
  });

  ipcMain.handle('voice:get-voices', async () => {
    // Return locally-computed voice list (no service needed)
    return { voices: getLocalVoices() };
  });

  ipcMain.handle('voice:upload-sample', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '上传语音样本',
      filters: [{ name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const srcPath = result.filePaths[0];
      const srcName = basename(srcPath);
      // Sanitize filename
      let safeName = srcName.replace(/[^a-zA-Z0-9._\- \u4e00-\u9fff]/g, '');
      if (!safeName) safeName = 'voice_sample.wav';
      let destPath = join(VOICE_DATA_DIR, safeName);
      const base = safeName.replace(/\.[^.]+$/, '');
      const ext = extname(safeName);
      let counter = 1;
      while (existsSync(destPath)) {
        destPath = join(VOICE_DATA_DIR, `${base}_${counter}${ext}`);
        counter++;
      }
      copyFileSync(srcPath, destPath);
      const finalName = basename(destPath);
      return { id: `custom:${finalName}`, name: finalName.replace(/\.[^.]+$/, ''), path: destPath };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('voice:delete-voice', async (_event, voiceId: string) => {
    if (!voiceId.startsWith('custom:')) return { error: 'Can only delete custom voices' };
    const filename = voiceId.replace('custom:', '');
    const filePath = join(VOICE_DATA_DIR, filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
      return { status: 'deleted' };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('voice:speak', async (_event, text: string) => {
    const voiceSettings = store.get('voice') as VoiceSettings;
    if (!voiceSettings?.enabled) return { error: '语音未启用' };
    try {
      if (!isVoiceServiceRunning()) {
        const started = await startVoiceService();
        if (!started) return { error: '语音服务启动失败。请确保已安装 Python 3 和依赖: pip3 install edge-tts fastapi uvicorn soundfile' };
      }
      const audioBuffer = await voiceSpeak(text, voiceSettings.selectedVoiceId || undefined, 'Auto', voiceSettings.modelId || 'edge_tts');
      // Write to temp file and return path for renderer to play
      const tmpPath = join(app.getPath('temp'), `xuanshen_speech_${Date.now()}.wav`);
      writeFileSync(tmpPath, audioBuffer);
      return { audioPath: tmpPath };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('voice:get-settings', () => {
    return store.get('voice', { enabled: false, modelId: 'edge_tts', selectedVoiceId: '' });
  });

  ipcMain.handle('voice:set-settings', (_event, settings: Partial<VoiceSettings>) => {
    const current = store.get('voice', { enabled: false, modelId: 'edge_tts', selectedVoiceId: '' }) as VoiceSettings;
    const updated = { ...current, ...settings };
    store.set('voice', updated);
    return updated;
  });

  // ============ Export / Import Pet Config Pack ============
  function collectFilesAsBase64(dir: string, extensions: RegExp): Record<string, string> {
    const result: Record<string, string> = {};
    if (!existsSync(dir)) return result;
    const walk = (currentDir: string, prefix: string) => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(currentDir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (extensions.test(entry.name)) {
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;
          result[key] = readFileSync(join(currentDir, entry.name)).toString('base64');
        }
      }
    };
    walk(dir, '');
    return result;
  }

  function restoreFilesFromBase64(files: Record<string, string>, destDir: string, overwrite = false) {
    for (const [relativePath, base64Data] of Object.entries(files)) {
      const destPath = join(destDir, ...relativePath.split('/'));
      if (!overwrite && existsSync(destPath)) continue;
      const destFolder = join(destPath, '..');
      if (!existsSync(destFolder)) mkdirSync(destFolder, { recursive: true });
      writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
    }
  }

  ipcMain.handle('config:export', async () => {
    const result = await dialog.showSaveDialog(win, {
      title: '导出宠物配置包',
      defaultPath: join(app.getPath('desktop'), 'xuanshen-pet-config.xpet'),
      filters: [{ name: '玄神配置包', extensions: ['xpet'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    try {
      const settings = store.store;

      const exportData = {
        version: 1,
        config: {
          systemPrompt: settings.systemPrompt,
          petSize: settings.petSize,
          petOpacity: settings.petOpacity,
          quickChatPlaceholder: settings.quickChatPlaceholder,
          skills: settings.skills,
          scheduledTasks: settings.scheduledTasks,
          voice: { modelId: settings.voice?.modelId, selectedVoiceId: settings.voice?.selectedVoiceId },
          interactions: settings.interactions || [],
          tools: settings.tools || [],
        },
        animations: collectFilesAsBase64(getAnimationsDir(), /\.(webp|gif|png|apng)$/i),
        voices: collectFilesAsBase64(VOICE_DATA_DIR, /\.(wav|mp3|flac|ogg|m4a)$/i),
        songs: collectFilesAsBase64(getSongsDir(), /\.(mp3|wav|ogg|flac|m4a)$/i),
        interactions: collectFilesAsBase64(getInteractionsDir(), /\.(webp|gif|apng|mp3|wav|ogg|flac|m4a)$/i),
        tools: collectFilesAsBase64(getToolsDir(), /\.(webp|gif|apng|png|jpg|jpeg|mp3|wav|ogg|flac|m4a)$/i),
      };

      writeFileSync(result.filePath, JSON.stringify(exportData), 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('config:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '导入宠物配置包',
      filters: [{ name: '玄神配置包', extensions: ['xpet'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    try {
      const raw = readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);

      if (!data.version || !data.config) {
        return { error: '无效的配置包文件' };
      }

      // 1. Import config
      const cfg = data.config;
      if (cfg.systemPrompt) store.set('systemPrompt', cfg.systemPrompt);
      if (cfg.petSize) store.set('petSize', cfg.petSize);
      if (cfg.petOpacity !== undefined) store.set('petOpacity', cfg.petOpacity);
      if (cfg.quickChatPlaceholder) store.set('quickChatPlaceholder', cfg.quickChatPlaceholder);
      if (cfg.skills) store.set('skills', cfg.skills);
      if (cfg.scheduledTasks) store.set('scheduledTasks', cfg.scheduledTasks);
      if (cfg.voice) {
        const currentVoice = store.get('voice') as VoiceSettings;
        store.set('voice', { ...currentVoice, modelId: cfg.voice.modelId || currentVoice.modelId, selectedVoiceId: cfg.voice.selectedVoiceId || currentVoice.selectedVoiceId });
      }

      // 2. Import animations
      if (data.animations && Object.keys(data.animations).length > 0) {
        restoreFilesFromBase64(data.animations, getAnimationsDir());
      }

      // 3. Import voices
      if (data.voices && Object.keys(data.voices).length > 0) {
        restoreFilesFromBase64(data.voices, VOICE_DATA_DIR);
      }

      // 4. Import songs
      if (data.songs && Object.keys(data.songs).length > 0) {
        restoreFilesFromBase64(data.songs, getSongsDir());
      }

      // 5. Import interactions
      if (data.interactions && Object.keys(data.interactions).length > 0) {
        restoreFilesFromBase64(data.interactions, getInteractionsDir());
      }
      if (cfg.interactions) store.set('interactions', cfg.interactions);

      // 6. Import tools
      if (data.tools && Object.keys(data.tools).length > 0) {
        restoreFilesFromBase64(data.tools, getToolsDir());
      }
      if (cfg.tools) store.set('tools', cfg.tools);

      // Restart scheduled task timers with new config
      const newTasks = store.get('scheduledTasks', []) as ScheduledTask[];
      for (const [id] of taskTimers) { stopTaskTimer(id); }
      for (const task of newTasks) { if (task.enabled) startTaskTimer(task); }

      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Native right-click context menu
  ipcMain.on('window:context-menu', () => {
    const isRoaming = roamingEnabled;
    const shortcuts = store.store.shortcuts;
    const menu = Menu.buildFromTemplate([
      {
        label: '⚡ 快速聊天',
        submenu: [
          {
            label: '打开输入框',
            accelerator: shortcuts.quickChat || undefined,
            click: () => sendMenuAction('quick-chat'),
          },
          {
            label: '设置占位文案',
            click: () => sendMenuAction('quick-chat-settings'),
          },
        ],
      },
      {
        label: '💬 聊天',
        accelerator: shortcuts.chat || undefined,
        click: () => win.webContents.send('menu:action', 'chat'),
      },
      {
        label: '🎮 互动',
        accelerator: shortcuts.interact || undefined,
        submenu: [
          {
            label: '管理互动',
            click: () => win.webContents.send('menu:action', 'interact'),
          },
          { type: 'separator' },
          ...((store.get('interactions', []) as CustomInteraction[]).map((interaction) => ({
            label: interaction.name,
            click: () => win.webContents.send('menu:action', `play-interaction:${interaction.id}`),
          }))),
        ],
      },
      {
        label: '🔧 工具',
        submenu: [
          {
            label: '管理工具',
            click: () => win.webContents.send('menu:action', 'tools'),
          },
          { type: 'separator' },
          ...((store.get('tools', []) as CustomTool[]).map((tool) => ({
            label: tool.name,
            click: () => win.webContents.send('menu:action', `use-tool:${tool.id}`),
          }))),
        ],
      },
      {
        label: '⚙️ 设置',
        accelerator: shortcuts.settings || undefined,
        click: () => win.webContents.send('menu:action', 'settings'),
      },
      {
        label: '🎭 动作设置',
        accelerator: shortcuts.animations || undefined,
        click: () => win.webContents.send('menu:action', 'animations'),
      },
      {
        label: '📚 技能',
        accelerator: shortcuts.skills || undefined,
        click: () => win.webContents.send('menu:action', 'skills'),
      },
      { type: 'separator' },
      {
        label: '🎵 歌单设置',
        accelerator: shortcuts.playlist || undefined,
        click: () => win.webContents.send('menu:action', 'playlist'),
      },
      {
        label: '🎤 唱歌',
        submenu: [
          {
            label: '🎲 随机播放',
            click: () => win.webContents.send('menu:action', 'sing-random'),
          },
          {
            label: '📋 选择歌曲',
            click: () => win.webContents.send('menu:action', 'sing-pick'),
          },
          { type: 'separator' },
          {
            label: '⏹ 停止播放',
            click: () => win.webContents.send('menu:action', 'stop-singing'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: '🎬 播放B站视频',
        accelerator: shortcuts.video || undefined,
        click: () => sendMenuAction('video'),
      },
      { type: 'separator' },
      {
        label: '⏰ 定时说话',
        accelerator: shortcuts.scheduled || undefined,
        click: () => win.webContents.send('menu:action', 'scheduled'),
      },
      {
        label: '⌨️ 快捷键配置',
        click: () => sendMenuAction('shortcut-settings'),
      },
      {
        label: '🔊 声音配置',
        submenu: [
          {
            label: '声线设置',
            click: () => win.webContents.send('menu:action', 'voice-settings'),
          },
          {
            label: '开启语音回复',
            type: 'checkbox',
            checked: (store.get('voice') as VoiceSettings)?.enabled ?? false,
            click: (menuItem) => {
              const current = store.get('voice', { enabled: false, modelId: 'edge_tts', selectedVoiceId: '' }) as VoiceSettings;
              current.enabled = menuItem.checked;
              store.set('voice', current);
              win.webContents.send('voice:enabled-changed', current.enabled);
            },
          },
        ],
      },
      {
        label: isRoaming ? '🚶 停止走动' : '🚶 随意走动',
        accelerator: shortcuts.roaming || undefined,
        click: () => win.webContents.send('menu:action', 'roaming'),
      },
      { type: 'separator' },
      {
        label: '📦 导入/导出',
        submenu: [
          {
            label: '📤 导出配置包',
            click: () => win.webContents.send('menu:action', 'export-config'),
          },
          {
            label: '📥 导入配置包',
            click: () => win.webContents.send('menu:action', 'import-config'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);
    menu.popup({ window: win });
  });

  registerGlobalShortcuts(store.store.shortcuts);
}
