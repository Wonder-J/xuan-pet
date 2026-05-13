import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: any) => ipcRenderer.invoke('settings:set', settings),

  // Chat
  sendChat: (messages: any[]) => ipcRenderer.invoke('chat:send', messages),

  // Window
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('window:set-ignore-mouse', ignore),
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

  // Skills
  getSkills: () => ipcRenderer.invoke('skills:get'),
  createSkill: (name: string, content: string) => ipcRenderer.invoke('skills:create', name, content),
  updateSkill: (id: string, name: string, content: string) =>
    ipcRenderer.invoke('skills:update', id, name, content),
  removeSkill: (id: string) => ipcRenderer.invoke('skills:remove', id),
  pickSkillFile: () => ipcRenderer.invoke('skills:pick'),

  // Scheduled Tasks
  getScheduledTasks: () => ipcRenderer.invoke('scheduled:get'),
  createScheduledTask: (prompt: string, intervalMinutes: number) =>
    ipcRenderer.invoke('scheduled:create', prompt, intervalMinutes),
  removeScheduledTask: (id: string) => ipcRenderer.invoke('scheduled:remove', id),
  toggleScheduledTask: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('scheduled:toggle', id, enabled),
  runScheduledTask: (id: string) => ipcRenderer.invoke('scheduled:run-now', id),
  onScheduledResult: (callback: (result: { content: string }) => void) =>
    ipcRenderer.on('scheduled:result', (_event, result) => callback(result)),

  // Roaming
  toggleRoaming: (enabled: boolean) => ipcRenderer.invoke('roaming:toggle', enabled),
  onRoamingState: (callback: (state: { moving: boolean; direction: number }) => void) =>
    ipcRenderer.on('roaming:state', (_event, state) => callback(state)),

  // Events from main process
  onQuickChatLoading: (callback: () => void) =>
    ipcRenderer.on('quick-chat:loading', () => callback()),
  onQuickChatResult: (callback: (result: { content?: string; error?: string }) => void) =>
    ipcRenderer.on('quick-chat:result', (_event, result) => callback(result)),
  onShortcutTriggered: (callback: (action: string) => void) =>
    ipcRenderer.on('shortcut:triggered', (_event, action) => callback(action)),
  onMenuAction: (callback: (action: string) => void) =>
    ipcRenderer.on('menu:action', (_event, action) => callback(action)),

  // Video
  onPlayVideo: (callback: (data: { embedUrl: string; title: string }) => void) =>
    ipcRenderer.on('video:play', (_event, data) => callback(data)),
});
