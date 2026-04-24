import type { ModelProviderCard } from '@/types/llm';

// WaveSpeed AI — image/video/audio inference aggregator.
// docs: https://wavespeed.ai/docs
const WaveSpeed: ModelProviderCard = {
  chatModels: [],
  checkModel: 'wavespeed-ai/z-image/turbo',
  description:
    'WaveSpeed AI — fast inference aggregator for image, video and audio. Includes exclusive access to ByteDance Seedream/Seedance, Alibaba Wan, Google Veo/Nano Banana, OpenAI Sora, Kuaishou Kling and more.',
  id: 'wavespeed',
  modelsUrl: 'https://wavespeed.ai/models',
  name: 'WaveSpeed AI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: { placeholder: 'https://api.wavespeed.ai/api/v3' },
    sdkType: 'openai',
    showDeployName: false,
    showModelFetcher: false,
  },
  url: 'https://wavespeed.ai',
};

export default WaveSpeed;
