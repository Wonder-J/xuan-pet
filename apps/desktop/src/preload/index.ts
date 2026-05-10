import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: any) => ipcRenderer.invoke('settings:set', settings),

  // Chat
  sendChat: (messages: any[]) => ipcRenderer.invoke('chat:send', messages),

  // Window
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', { dx, dy }),
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.invoke('window:resize', { width, height }),

  // Context menu
  showContextMenu: () => ipcRenderer.send('window:context-menu'),

  // Events from main process
  onMenuAction: (callback: (action: string) => void) =>
    ipcRenderer.on('menu:action', (_event, action) => callback(action)),
});
