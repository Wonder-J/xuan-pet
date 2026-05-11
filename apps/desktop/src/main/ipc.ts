import { BrowserWindow, ipcMain, Menu, app, dialog, screen } from 'electron';
import { copyFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import Store from 'electron-store';
import { AppSettings, IPC_CHANNELS, ChatMessage, PetEmotion, PetAnimations } from '@xuanshen/shared';
import { chatWithAI } from './ai';

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
  return `pet-asset://file${filePath}`;
}

export function setupIPC(win: BrowserWindow, store: Store<AppSettings>): void {
  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return store.store;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, settings: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value);
    }
    return store.store;
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
        const reply = await chatWithAI(provider, messages, settings.systemPrompt);
        return { content: reply };
      } catch (err: any) {
        return { error: err.message || '请求失败' };
      }
    }
  );

  // Window drag — renderer sends screen-coord deltas
  ipcMain.on('window:move', (_event, { dx, dy }: { dx: number; dy: number }) => {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  });

  // Window resize for panels — keep bottom edge and horizontal center anchored
  ipcMain.handle('window:resize', (_event, { width, height }: { width: number; height: number }) => {
    const [x, y] = win.getPosition();
    const [oldWidth, oldHeight] = win.getSize();
    const dx = oldWidth - width;
    const dy = oldHeight - height;
    win.setBounds({ x: x + Math.round(dx / 2), y: y + dy, width, height });
  });

  // Fullscreen toggle
  ipcMain.handle('window:fullscreen', (_event, fullscreen: boolean) => {
    if (fullscreen) {
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      win.setFullScreen(true);
    } else {
      win.setFullScreen(false);
      win.setAlwaysOnTop(true, 'floating');
    }
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
      const filePath = decodeURIComponent(assetURL.replace('pet-asset://file', ''));
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
      const filename = `${Date.now()}-${src.split('/').pop()}`;
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

  // ============ Roaming ============
  let roamingTimeout: ReturnType<typeof setTimeout> | null = null;
  let roamingMoving = false;
  let roamingDirection = 1;
  let roamingEnabled = false;
  let roamingMoveInterval: ReturnType<typeof setInterval> | null = null;
  const ROAM_STEP = 2;
  const ROAM_MOVE_INTERVAL = 40;
  const ACTION_DURATION_MS = 2000;

  function roamingTick() {
    if (!roamingEnabled) return;

    if (roamingMoving) {
      // Was moving → stop and trigger random emotion
      roamingMoving = false;
      if (roamingMoveInterval) { clearInterval(roamingMoveInterval); roamingMoveInterval = null; }
      win.webContents.send('roaming:state', { moving: false, direction: roamingDirection });
      // Next tick: pause 2s for animation then move again
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

  // Native right-click context menu
  ipcMain.on('window:context-menu', () => {
    const isRoaming = roamingEnabled;
    const menu = Menu.buildFromTemplate([
      {
        label: '💬 聊天',
        click: () => win.webContents.send('menu:action', 'chat'),
      },
      {
        label: '🎮 互动',
        click: () => win.webContents.send('menu:action', 'interact'),
      },
      {
        label: '⚙️ 设置',
        click: () => win.webContents.send('menu:action', 'settings'),
      },
      {
        label: '🎭 动作设置',
        click: () => win.webContents.send('menu:action', 'animations'),
      },
      { type: 'separator' },
      {
        label: '🎵 歌单设置',
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
        label: isRoaming ? '🚶 停止走动' : '🚶 随意走动',
        click: () => win.webContents.send('menu:action', 'roaming'),
      },
      {
        label: win.isFullScreen() ? '↕️ 退出全屏' : '↕️ 全屏',
        click: () => win.webContents.send('menu:action', 'fullscreen'),
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);
    menu.popup({ window: win });
  });
}
