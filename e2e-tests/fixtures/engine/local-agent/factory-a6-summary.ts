import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Factory follow-up that writes the implementation summary",
  turns: [
    {
      text: `## Implementation summary

- The page lists the lunch menu.`,
    },
  ],
};
