import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';

/**
 * Initialise the builtin agents that back the home "starter" modes
 * (Create Agent / Create Group / Write). These hooks MUST keep running while
 * the home input is mounted so the starter modes triggered from the
 * quick-action cards have their agents ready.
 *
 * Extracted from StarterList so InputArea can keep the init logic alive
 * without rendering the (now-removed) redundant starter buttons.
 */
export const useInitStarterAgents = () => {
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.agentBuilder);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.groupAgentBuilder);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);
};
