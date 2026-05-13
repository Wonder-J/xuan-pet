import Store from 'electron-store';
import { AppSettings, DEFAULT_PROVIDERS } from '@xuanshen/shared';

export function createStore(): Store<AppSettings> {
  const defaultQuickChatShortcut = process.platform === 'darwin'
    ? 'Control+Command+X'
    : 'Control+Shift+X';
  const defaultVideoShortcut = process.platform === 'darwin'
    ? 'Control+Command+W'
    : 'Control+Shift+W';

  return new Store<AppSettings>({
    name: 'xuanshen-settings',
    defaults: {
      currentProvider: 'openai',
      providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, apiKey: '' })),
      systemPrompt:
        '你是一个可爱的桌面宠物助手「玄神」，性格活泼友善。请用简短、可爱的语气回答用户的问题。回答尽量简洁，不超过100字。',
      petSize: 150,
      petOpacity: 1,
      quickChatPlaceholder: '你想问龙哥什么',
      skills: [],
      scheduledTasks: [],
      shortcuts: {
        quickChat: defaultQuickChatShortcut,
        chat: '',
        interact: '',
        settings: '',
        animations: '',
        skills: '',
        playlist: '',
        scheduled: '',
        roaming: '',
        fullscreen: '',
        video: defaultVideoShortcut,
      },
    },
  });
}
