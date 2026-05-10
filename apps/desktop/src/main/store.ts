import Store from 'electron-store';
import { AppSettings, DEFAULT_PROVIDERS } from '@xuanshen/shared';

export function createStore(): Store<AppSettings> {
  return new Store<AppSettings>({
    name: 'xuanshen-settings',
    defaults: {
      currentProvider: 'openai',
      providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, apiKey: '' })),
      petSize: 150,
      petOpacity: 1,
    },
  });
}
