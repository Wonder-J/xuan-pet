import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    getClipboardUrl: () => ipcRenderer.invoke('video-input:clipboard'),
    sendVideoUrl: (url: string) => ipcRenderer.invoke('video-input:send', url),
    closeVideoInput: () => ipcRenderer.invoke('video-input:close'),
});
