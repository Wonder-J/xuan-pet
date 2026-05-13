import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    getSettings: () => ipcRenderer.invoke('settings:get'),
    sendQuickChat: (text: string) => ipcRenderer.invoke('quick-chat:send', text),
    closeQuickChat: () => ipcRenderer.invoke('quick-chat:close'),
});
