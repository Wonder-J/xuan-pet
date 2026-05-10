export interface AIProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppSettings {
  currentProvider: string;
  providers: AIProviderConfig[];
  petSize: number;
  petOpacity: number;
}

export const DEFAULT_PROVIDERS: Omit<AIProviderConfig, 'apiKey'>[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'zhipu',
    name: '智谱AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
];

export const IPC_CHANNELS = {
  CHAT_SEND: 'chat:send',
  CHAT_REPLY: 'chat:reply',
  CHAT_STREAM: 'chat:stream',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PET_ACTION: 'pet:action',
} as const;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
