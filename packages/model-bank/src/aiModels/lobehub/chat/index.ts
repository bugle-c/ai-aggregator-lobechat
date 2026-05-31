import type { AIChatModelCard } from '../../../types/aiModel';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { localChatModels } from './local';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { openaiChatModels } from './openai';
import { qwenChatModels } from './qwen';
import { xaiChatModels } from './xai';

export const lobehubChatModels: AIChatModelCard[] = [
  ...anthropicChatModels,
  ...googleChatModels,
  ...openaiChatModels,
  ...deepseekChatModels,
  ...xaiChatModels,
  ...minimaxChatModels,
  ...moonshotChatModels,
  ...qwenChatModels,
  ...localChatModels,
];

export { anthropicChatModels } from './anthropic';
export { deepseekChatModels } from './deepseek';
export { googleChatModels } from './google';
export { localChatModels } from './local';
export { minimaxChatModels } from './minimax';
export { moonshotChatModels } from './moonshot';
export { openaiChatModels } from './openai';
export { qwenChatModels } from './qwen';
export { xaiChatModels } from './xai';
