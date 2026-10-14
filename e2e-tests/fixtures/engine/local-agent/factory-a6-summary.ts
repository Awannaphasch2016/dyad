import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Factory follow-up that writes the implementation summary",
  turns: [
    {
      text: `## Phase finished

- The page lists the lunch menu.`,
    },
  ],
};
