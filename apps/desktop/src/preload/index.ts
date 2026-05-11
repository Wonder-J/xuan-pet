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
  toggleFullscreen: (fullscreen: boolean) =>
    ipcRenderer.invoke('window:fullscreen', fullscreen),

  // Context menu
  showContextMenu: () => ipcRenderer.send('window:context-menu'),

  // Pet Animations
  pickAnimationFiles: (emotion: string) => ipcRenderer.invoke('animations:pick', emotion),
  getAnimations: () => ipcRenderer.invoke('animations:get'),
  removeAnimation: (assetURL: string) => ipcRenderer.invoke('animations:remove', assetURL),
  pickDefaultImage: () => ipcRenderer.invoke('animations:pickDefault'),
  getDefaultImage: () => ipcRenderer.invoke('animations:getDefault'),

  // Songs / Playlist
  pickSongs: () => ipcRenderer.invoke('songs:pick'),
  getSongs: () => ipcRenderer.invoke('songs:get'),
  removeSong: (assetURL: string) => ipcRenderer.invoke('songs:remove', assetURL),

  // Roaming
  toggleRoaming: (enabled: boolean) => ipcRenderer.invoke('roaming:toggle', enabled),
  onRoamingState: (callback: (state: { moving: boolean; direction: number }) => void) =>
    ipcRenderer.on('roaming:state', (_event, state) => callback(state)),

  // Events from main process
  onMenuAction: (callback: (action: string) => void) =>
    ipcRenderer.on('menu:action', (_event, action) => callback(action)),
});
