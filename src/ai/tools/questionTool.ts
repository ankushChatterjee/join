// ============================================================================
// AI Agent - Question Tool (Vercel AI SDK)
// ============================================================================

import { tool } from "ai";
import { z } from "zod/v4";
import type { AgentContext } from "../agent";
import type { QuestionInfo } from "../types";

const QUESTION_TOOL_DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- The user can always add their own custom answer if none of the options fit
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

export const askQuestion = tool({
  description: QUESTION_TOOL_DESCRIPTION,
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe("Complete question"),
          header: z.string().describe("Very short label (max 30 chars)"),
          options: z
            .array(
              z.object({
                label: z.string().describe("Display text (1-5 words, concise)"),
                description: z.string().describe("Explanation of choice"),
              })
            )
            .min(1)
            .max(5)
            .describe("Available choices"),
          multiple: z
            .boolean()
            .optional()
            .describe("Allow selecting multiple choices"),
        })
      )
      .min(1)
      .max(5)
      .describe("Questions to ask"),
  }),
  execute: async (
    { questions },
    { toolCallId, experimental_context, abortSignal }
  ) => {
    const ctx = experimental_context as AgentContext | undefined;

    // Always enable custom answer option - user can always add their own take
    const normalizedQuestions: QuestionInfo[] = questions.map((q) => ({
      ...q,
      custom: true,
    }));

    if (ctx?.onRequestQuestion) {
      const answers = await new Promise<string[][]>((resolve, reject) => {
        ctx.onRequestQuestion!({
          toolCallId,
          questions: normalizedQuestions,
          resolve,
          reject,
        });
      });

      if (abortSignal?.aborted) {
        return "Question was dismissed.";
      }

      // Format response for agent
      const formatted = normalizedQuestions
        .map(
          (q, i) =>
            `"${q.question}"="${answers[i]?.join(", ") || "Unanswered"}"`
        )
        .join(", ");

      return `User answered: ${formatted}. Continue with these answers in mind.`;
    }

    return "No question handler available.";
  },
});
