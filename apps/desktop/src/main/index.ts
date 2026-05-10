import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { setupIPC } from './ipc';
import { createStore } from './store';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 200,
    height: 250,
    x: screenWidth - 250,
    y: screenHeight - 300,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');

  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    app.dock.hide();
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Debug: open devtools in dev mode
  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADkSURBVDiNpZMxDoJAEEX/LAQKKxsTE2wsvIAHsLXwCF7A+3gBj2BhZ2Njg4WFEBMLCmGdYpddFlj8yWRn5v/ZzOwsoEdKqR7HMbTWEEIgTVOstUJKuet0AIBSCnEco6oq5HkOIcQiYF0h07YtiqKAlBJKKXie9xJgjMkWAbz8PM+htQYAeJ73GEBB55xDSoksy5BlGYIg+A2glBrkeY6iKFCWJYQQ8H3/B0A39X5d11BKQWsN3/fheV4fgHP+VNc1sixDVVUwxsD3fdi2jUMPdEn4vo8wDFGWJYwxsCwLh/wGNldsTfyFeL8AAAAASUVORK5CYII='
  );

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '💬 聊天',
      click: () => mainWindow?.webContents.send('menu:action', 'chat'),
    },
    {
      label: '🎮 互动',
      click: () => mainWindow?.webContents.send('menu:action', 'interact'),
    },
    {
      label: '⚙️ 设置',
      click: () => mainWindow?.webContents.send('menu:action', 'settings'),
    },
    { type: 'separator' },
    {
      label: '显示宠物',
      click: () => mainWindow?.show(),
    },
    {
      label: '隐藏宠物',
      click: () => mainWindow?.hide(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('玄神 - AI桌面宠物');
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  const store = createStore();
  createWindow();
  createTray();
  setupIPC(mainWindow!, store);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
