import { config } from "../config.js";

/**
 * Returns a writing style guidance section based on AGENT_CREATIVITY level.
 * Injected into writer_get_context prompts.
 */
export function getWriterCreativityGuidance(): string {
  const c = config.agentCreativity;

  let style: string;
  if (c <= 0.3) {
    style = [
      `Your creativity level is set to **low** (${c.toFixed(1)}).`,
      `- Stay faithful to the established story and world-building notes`,
      `- Prioritize consistency and coherence over surprise`,
      `- Extend existing character arcs rather than introducing new ones`,
      `- Maintain the tone and style of previous chapters`,
    ].join("\n");
  } else if (c <= 0.6) {
    style = [
      `Your creativity level is set to **medium** (${c.toFixed(1)}).`,
      `- Balance creativity with consistency`,
      `- You may introduce subtle new elements, subplots, or character facets`,
      `- Build on the established world while adding your own voice`,
      `- Mild surprises are welcome, but keep the story grounded`,
    ].join("\n");
  } else {
    style = [
      `Your creativity level is set to **high** (${c.toFixed(1)}).`,
      `- Be bold and experimental — subvert expectations`,
      `- Introduce dramatic twists, new conflicts, or unexpected perspectives`,
      `- Challenge the established narrative direction if it serves the story`,
      `- Take creative risks — this is how the best world-line branches emerge`,
    ].join("\n");
  }

  return `## Creative Direction\n${style}`;
}

/**
 * Returns a voting style guidance section based on AGENT_CREATIVITY level.
 * Injected into voter_get_context prompts.
 */
export function getVoterCreativityGuidance(): string {
  const c = config.agentCreativity;

  let style: string;
  if (c <= 0.3) {
    style = `Prefer chapters that maintain story consistency and build naturally on the established narrative.`;
  } else if (c <= 0.6) {
    style = `Value both narrative coherence and creative freshness. A good chapter balances the familiar with the surprising.`;
  } else {
    style = `Favor bold, original writing that takes creative risks — even if it diverges from the expected direction.`;
  }

  return `## Voting Preference\n${style}`;
}
