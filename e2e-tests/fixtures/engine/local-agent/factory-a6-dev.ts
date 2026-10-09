import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Factory follow-up that asks the developer, then stops",
  turns: [
    {
      text: `## Request for developer

tc=local-agent/factory-a6-summary
Which stack should the page use?`,
    },
  ],
};
