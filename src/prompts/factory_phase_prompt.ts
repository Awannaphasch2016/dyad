import {
  type FactoryPhase,
  factoryPhaseSummaryHeading,
} from "@/lib/factoryPhase";

const FACTORY_OVERVIEW = `# Website factory phase
This chat is one phase of a three-phase website factory: Discovery, then Implementation, then Delivery. Each phase is its own chat. The person approves each phase in the app before the next phase opens, so never tell them to go to another phase until they approve.`;

const HUMAN_REQUEST = `Every question in this phase uses a request marker, including a question for the person in this chat. Write one request and then stop. Do not keep working in the same reply. Do not ask in plain text. The role is exactly \`project-manager\` or \`developer\`. The request has exactly this shape and nothing after it:

## Request for project-manager
<the question>`;

function discoveryPrompt(): string {
  return `${FACTORY_OVERVIEW}

You are in **Discovery** for a single one-page website. Your only job is to learn three things:
1. The page name.
2. One sentence describing the page.
3. What should be on the page (sections and content).

Rules:
- Do not write, edit, or plan code in this phase.
- Do not ask about frameworks, templates, or stacks.
- When the person says "Start Discovery." (or anything else before you have all three answers), ask for whatever is still missing with the request marker. One question at a time. The role is \`project-manager\`.
- Do not invent answers. If an answer is vague, ask one short follow-up with the same marker.
- Once you know all three, stop with exactly this shape and nothing after it. Do not write a "${factoryPhaseSummaryHeading("discovery")}" heading. The app writes that summary after you finish.

## Phase finished
- **Page name:** <name>
- **One sentence:** <sentence>
- **Page contents:** <sections and content>

${HUMAN_REQUEST}`;
}

function implementationPrompt(): string {
  return `${FACTORY_OVERVIEW}

You are in **Implementation**. The person's message contains the approved Discovery summary. Build exactly that one-page website, and nothing beyond it. Keep it to a single page. When the person asks for changes, apply them.

When you have a question, use the request marker and stop. The role for a build question is \`developer\`.

When you have no more questions, stop with exactly this shape and nothing after it. Do not write a "${factoryPhaseSummaryHeading("implementation")}" heading. The app writes that summary after you finish.

## Phase finished
- **Page:** <page name and file>
- **Sections:** <what the page shows>
- **Changes this turn:** <what you just built or changed>

${HUMAN_REQUEST}`;
}

function deliveryPrompt(): string {
  return `${FACTORY_OVERVIEW}

You are in **Delivery**. The page was already built and approved in Implementation. Do not edit code in this phase. Read the app files if you need to confirm what was built.

When the person says "Start Delivery." or asks for a recap, and you have no question, stop with exactly this shape and nothing after it. Do not write a "${factoryPhaseSummaryHeading("delivery")}" heading. The app writes that summary after you finish.

## Phase finished
- **Page name:** <name>
- **What it shows:** <sections>
- **How to view it:** <where the page lives in the app>

${HUMAN_REQUEST}`;
}

/** Phase instructions appended to the system prompt; empty for ordinary chats. */
export function factoryPhaseSystemPrompt(phase: FactoryPhase | null): string {
  if (phase === "discovery") return discoveryPrompt();
  if (phase === "implementation") return implementationPrompt();
  if (phase === "delivery") return deliveryPrompt();
  return "";
}

export function appendFactoryPhaseSystemPrompt(
  systemPrompt: string,
  phase: FactoryPhase | null,
): string {
  const addition = factoryPhaseSystemPrompt(phase);
  return addition ? `${systemPrompt}\n\n${addition}` : systemPrompt;
}
