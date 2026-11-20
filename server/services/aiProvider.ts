import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { getSettingsRecord } from '../database.ts';
import { sanitizeLogError } from '../middleware/security.ts';

export interface AiReadiness {
  configured: boolean;
  activeProvider: 'openai' | 'gemini' | 'none';
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  activeModel: string;
}

export function getAiReadiness(): AiReadiness {
  const settings = getSettingsRecord();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  const openaiConfigured = Boolean(openaiKey && openaiKey.length > 5 && !openaiKey.includes('MY_'));
  const geminiConfigured = Boolean(geminiKey && geminiKey.length > 5 && !geminiKey.includes('MY_'));

  let activeProvider: 'openai' | 'gemini' | 'none' = 'none';
  if (settings.ai_provider === 'openai') {
    activeProvider = openaiConfigured ? 'openai' : geminiConfigured ? 'gemini' : 'none';
  } else if (settings.ai_provider === 'gemini') {
    activeProvider = geminiConfigured ? 'gemini' : openaiConfigured ? 'openai' : 'none';
  } else {
    activeProvider = openaiConfigured ? 'openai' : geminiConfigured ? 'gemini' : 'none';
  }

  const activeModel =
    activeProvider === 'openai'
      ? settings.openai_model || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
      : activeProvider === 'gemini'
        ? 'gemini-4-hydrogen'
        : 'unconfigured';

  return {
    configured: activeProvider !== 'none',
    activeProvider,
    openaiConfigured,
    geminiConfigured,
    activeModel,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateStructuredJson<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchemaDescription?: string;
}): Promise<{ data: T; modelUsed: string }> {
  const readiness = getAiReadiness();
  if (!readiness.configured) {
    throw new Error(
      'AI provider is not configured on the server. Set OPENAI_API_KEY (or GEMINI_API_KEY) in your backend environment.'
    );
  }

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (readiness.activeProvider === 'openai') {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() });
        const completion = await client.chat.completions.create({
          model: readiness.activeModel,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('OpenAI returned an empty response.');
        }
        return {
          data: JSON.parse(content) as T,
          modelUsed: `openai:${readiness.activeModel}`,
        };
      }

      // Gemini fallback via server-side @google/genai
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY?.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.userPrompt,
        config: {
          systemInstruction: params.systemPrompt,
          responseMimeType: 'application/json',
        },
      });
      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Gemini returned an empty response.');
      }
      return {
        data: JSON.parse(rawText) as T,
        modelUsed: 'gemini:gemini-4-hydrogen',
      };
    } catch (err) {
      lastError = err;
      const msg = sanitizeLogError(err);
      console.error(`[AI JSON attempt ${attempt}/${maxAttempts}] ${msg}`);
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(
    `AI request failed after ${maxAttempts} attempts: ${sanitizeLogError(lastError)}`
  );
}

export async function generatePlainText(params: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ text: string; modelUsed: string }> {
  const readiness = getAiReadiness();
  if (!readiness.configured) {
    throw new Error(
      'AI provider is not configured on the server. Set OPENAI_API_KEY (or GEMINI_API_KEY) in your backend environment.'
    );
  }

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (readiness.activeProvider === 'openai') {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() });
        const completion = await client.chat.completions.create({
          model: readiness.activeModel,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        });
        const content = completion.choices[0]?.message?.content?.trim();
        if (!content) {
          throw new Error('OpenAI returned an empty text response.');
        }
        return {
          text: content,
          modelUsed: `openai:${readiness.activeModel}`,
        };
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY?.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.userPrompt,
        config: {
          systemInstruction: params.systemPrompt,
        },
      });
      const text = (response.text ?? '').trim();
      if (!text) {
        throw new Error('Gemini returned an empty text response.');
      }
      return {
        text,
        modelUsed: 'gemini:gemini-4-hydrogen',
      };
    } catch (err) {
      lastError = err;
      console.error(`[AI text attempt ${attempt}/${maxAttempts}] ${sanitizeLogError(err)}`);
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(
    `AI text generation failed after ${maxAttempts} attempts: ${sanitizeLogError(lastError)}`
  );
}
