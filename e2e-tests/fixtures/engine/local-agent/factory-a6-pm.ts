import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Factory run that asks the project manager, then stops",
  turns: [
    {
      text: `## Request for project-manager

tc=local-agent/factory-a6-dev
Which name should the page use?`,
    },
  ],
};
