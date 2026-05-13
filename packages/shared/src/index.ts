export interface AIProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface Skill {
  id: string;
  name: string;
  content: string;
}

export interface ScheduledTask {
  id: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
}

export interface MenuShortcuts {
  quickChat: string;
  chat: string;
  interact: string;
  settings: string;
  animations: string;
  skills: string;
  playlist: string;
  scheduled: string;
  roaming: string;
  fullscreen: string;
}

export interface AppSettings {
  currentProvider: string;
  providers: AIProviderConfig[];
  systemPrompt: string;
  petSize: number;
  petOpacity: number;
  quickChatPlaceholder: string;
  skills: Skill[];
  scheduledTasks: ScheduledTask[];
  shortcuts: MenuShortcuts;
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

export const PET_EMOTIONS = [
  'happy',
  'idle',
  'move',
  'drag',
  'sing',
  'angry',
  'sad',
  'surprise',
  'scared',
  'sleep',
] as const;

export type PetEmotion = (typeof PET_EMOTIONS)[number];

export const PET_EMOTION_LABELS: Record<PetEmotion, string> = {
  happy: '😊 开心',
  idle: '😐 空闲',
  move: '🚶 走路',
  drag: '✋ 拖拽',
  sing: '🎤 唱歌',
  angry: '😠 愤怒',
  sad: '😢 悲伤',
  surprise: '🎉 惊喜',
  scared: '😨 惊吓',
  sleep: '😴 睡觉',
};

export type PetAnimations = Record<PetEmotion, string[]>;
