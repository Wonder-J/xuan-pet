import { AIProviderConfig, ChatMessage } from '@xuanshen/shared';
import { net } from 'electron';

export async function chatWithAI(
  provider: AIProviderConfig,
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const systemMessage: ChatMessage = {
    role: 'system',
    content: systemPrompt,
  };

  const body = JSON.stringify({
    model: provider.model,
    messages: [systemMessage, ...messages],
    max_tokens: 300,
    temperature: 0.8,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let url = `${provider.baseUrl}/chat/completions`;

  // Provider-specific auth headers
  if (provider.id === 'anthropic') {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    url = `${provider.baseUrl}/messages`;

    // Anthropic uses a different format
    const anthropicBody = JSON.stringify({
      model: provider.model,
      max_tokens: 300,
      system: systemMessage.content,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return makeRequest(url, headers, anthropicBody).then((data) => {
      return data.content?.[0]?.text || '喵？我好像没听懂呢~';
    });
  }

  headers['Authorization'] = `Bearer ${provider.apiKey}`;

  const data = await makeRequest(url, headers, body);
  return data.choices?.[0]?.message?.content || '喵？我好像没听懂呢~';
}

function makeRequest(url: string, headers: Record<string, string>, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: 'POST',
    });

    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

    let responseData = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(json.error?.message || `HTTP ${response.statusCode}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error('解析响应失败'));
        }
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.write(body);
    request.end();
  });
}
