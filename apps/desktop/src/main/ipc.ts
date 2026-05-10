import { BrowserWindow, ipcMain, Menu, app } from 'electron';
import Store from 'electron-store';
import { AppSettings, IPC_CHANNELS, ChatMessage } from '@xuanshen/shared';
import { chatWithAI } from './ai';

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
        const reply = await chatWithAI(provider, messages);
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

  // Native right-click context menu
  ipcMain.on('window:context-menu', () => {
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
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);
    menu.popup({ window: win });
  });
}
