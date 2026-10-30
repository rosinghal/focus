// DeepSeek through the Vercel AI SDK. The packages are ESM-only, like Baileys, hence the dynamic import.
const MODEL = 'deepseek-chat';
const REQUEST_TIMEOUT_MS = 45 * 1000;

const judge = async (apiKey, prompt) => {
  const [{ generateText }, { createDeepSeek }] = await Promise.all([import('ai'), import('@ai-sdk/deepseek')]);
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
  const { text } = await generateText({
    model: deepseek(MODEL),
    prompt,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return String(text ?? '');
};

module.exports = { MODEL, judge };
