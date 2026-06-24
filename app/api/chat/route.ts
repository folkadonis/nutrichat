import { createAgentUIStreamResponse } from "ai";
import {
  createNutritionAgent,
  type NutritionUIMessage,
} from "@/agent/nutrition-agent";

// Tools persist meals to .data/log.json, so run on Node.js.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, userId }: { messages: NutritionUIMessage[]; userId?: string } =
    await req.json();

  const agent = createNutritionAgent(
    typeof userId === "string" && userId ? userId : "web",
  );

  return createAgentUIStreamResponse({ agent, uiMessages: messages });
}
