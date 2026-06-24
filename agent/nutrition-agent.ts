import { ToolLoopAgent, tool, stepCountIs, type InferAgentUIMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import {
  addMeal,
  getDay,
  setProfile,
  clearDay,
  totalsFor,
  type MealType,
  type MealEntry,
} from "@/lib/store";

// Google Gemini (vision + tool-calling). Reads GOOGLE_GENERATIVE_AI_API_KEY.
// Model is configurable via GEMINI_MODEL (no rebuild needed). Defaults to a
// free-tier-eligible flash model. Set GEMINI_MODEL=gemini-2.5-pro (needs billing)
// or gemini-3-pro-preview for higher accuracy.
const MODEL = google(process.env.GEMINI_MODEL || "gemini-2.5-flash");

export const INSTRUCTIONS = `You are an expert nutritionist, dietitian, food-recognition specialist, and calorie analyst operating inside a WhatsApp-style chat app. Your #1 goal is the MOST ACCURATE calorie estimate possible for everything the user eats. Accuracy beats speed.

# Core workflow for every food image / multiple images / text / voice transcription
1. ANALYZE: identify every visible food item, ingredients, cooking method, portion size, side dishes, sauces, beverages, oils/fats. Give a confidence score per item.
2. VERIFY PORTION: never assume serving size. Ask targeted questions when needed (full/half/restaurant/homemade plate, how many eggs, oil vs ghee, number of chapatis, cup size, how much rice).
3. USE CONTEXT: use previous meals (call getDailyLog), eating patterns, user country/region, and meal timing to improve accuracy.

# Memory & logging — use the tools, never ask users to re-enter meals
- When confident enough (overall confidence >= 80), call logMeal to persist it. This builds the running daily log.
- Before answering "what have I eaten" / summaries / remaining calories, call getDailyLog.
- If the user shares their country, calorie goal, or dietary goal, call setProfile.
- If the user asks to reset the day, call clearDay.
- Combine multiple images sent across the day into one unified daily record.

# Accuracy rules
- NEVER claim exact calories. Always give a Range (xxx–xxx kcal) and a Confidence %.
- If confidence < 80: ask clarifying questions BEFORE logging.
- If confidence < 60: say clearly "I need more information before providing a reliable calorie estimate." then ask.
- Pay special attention to Indian foods (dosa, idli, pongal, upma, chapati, parotta, biryani, meals, egg gravy, tea, coffee, street foods, sweets) — especially oil/ghee quantity, portion size, and restaurant vs homemade.

# After each meal you log, show a concise running summary (use the real numbers returned by the tool):
Today's Intake — Breakfast / Lunch / Dinner / Snacks kcal, Current Total, Remaining Calories.

# End-of-day report — when the user says "Daily Summary", "Today's Calories", "Show Today's Food", or "End Day Report": call getDailyLog and produce meals consumed, per-meal calories, totals, macros, most calorie-dense meal, a Health Score x/10, and a brief Weight Management Analysis.

# WhatsApp style — concise messages, emoji, short lines, e.g.:
🍽 Lunch Logged
Detected:
• 2 Chapati (90%)
• Egg Gravy, 2 eggs (88%)
Estimated Calories: 480–560 kcal
Macros: Protein 24g · Carbs 42g · Fat 20g
Today's Running Total: 1,240 kcal
Remaining: 760 kcal
Confidence: 89%

Reply like a friendly WhatsApp nutrition coach. Use plain text and emoji only — do NOT use markdown symbols like *, _, #, or backticks (they render as literal characters here). Use short lines and bullet dots (•). Do not use tables or headings. Invite the next meal photo when appropriate.`;

const foodItemSchema = z.object({
  name: z.string().describe("Food item name, e.g. 'Masala Dosa'"),
  quantity: z
    .string()
    .describe("Portion/serving, e.g. '1 plate', '2 chapati', '200ml cup'"),
  calories: z.number().describe("Best-estimate kcal for this portion"),
  protein: z.number().describe("grams"),
  carbs: z.number().describe("grams"),
  fat: z.number().describe("grams"),
  fiber: z.number().describe("grams"),
  sugar: z.number().describe("grams"),
  confidence: z.number().min(0).max(100),
});

const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

function dailySnapshot(meals: MealEntry[], goal: number) {
  const t = totalsFor(meals);
  const consumed = Math.round(t.calories);
  return {
    totals: {
      calories: consumed,
      protein: Math.round(t.protein),
      carbs: Math.round(t.carbs),
      fat: Math.round(t.fat),
      fiber: Math.round(t.fiber),
      sugar: Math.round(t.sugar),
    },
    byMealType: t.byMealType,
    dailyCalorieGoal: goal,
    remainingCalories: Math.round(goal - consumed),
    meals: meals.map((m) => ({
      mealType: m.mealType,
      time: m.timestamp,
      items: m.items.map((i) => `${i.quantity} ${i.name}`),
      calories: `${m.caloriesMin}-${m.caloriesMax} kcal`,
      confidence: m.confidence,
    })),
  };
}

/**
 * Build a nutrition agent whose tools are scoped to a single WhatsApp user.
 */
export function createNutritionAgent(userId: string) {
  return new ToolLoopAgent({
    model: MODEL,
    stopWhen: stepCountIs(12),
    instructions: INSTRUCTIONS,
    tools: {
      logMeal: tool({
        description:
          "Persist a meal to today's running log once you have a confident estimate (overall confidence >= 80). Returns the saved meal and updated daily totals. Do NOT call this if you still need to ask clarifying questions.",
        inputSchema: z.object({
          mealType: mealTypeSchema,
          items: z.array(foodItemSchema).min(1),
          caloriesMin: z.number(),
          caloriesMax: z.number(),
          confidence: z.number().min(0).max(100),
          notes: z.string().optional(),
        }),
        execute: async (input) => {
          const { meal, dayMeals, profile } = await addMeal(userId, {
            mealType: input.mealType as MealType,
            items: input.items,
            caloriesMin: input.caloriesMin,
            caloriesMax: input.caloriesMax,
            confidence: input.confidence,
            notes: input.notes,
          });
          return {
            saved: {
              id: meal.id,
              mealType: meal.mealType,
              time: meal.timestamp,
            },
            today: dailySnapshot(dayMeals, profile.dailyCalorieGoal),
          };
        },
      }),

      getDailyLog: tool({
        description:
          "Get all meals logged for a day (default today) with running totals, macros and remaining calories. Use before summaries, end-of-day reports, or 'what have I eaten' questions.",
        inputSchema: z.object({
          date: z.string().optional().describe("YYYY-MM-DD; omit for today"),
        }),
        execute: async ({ date }) => {
          const { date: day, meals, profile } = await getDay(userId, date);
          return {
            date: day,
            ...dailySnapshot(meals, profile.dailyCalorieGoal),
          };
        },
      }),

      setProfile: tool({
        description:
          "Save user profile to improve accuracy and remaining-calorie math: country (regional cuisine), dailyCalorieGoal (kcal), goal (weight loss / maintenance / muscle gain).",
        inputSchema: z.object({
          country: z.string().optional(),
          dailyCalorieGoal: z.number().optional(),
          goal: z.string().optional(),
        }),
        execute: async (patch) => ({ profile: await setProfile(userId, patch) }),
      }),

      clearDay: tool({
        description:
          "Delete all meals logged for a day (default today). Use when the user asks to reset/clear the day.",
        inputSchema: z.object({
          date: z.string().optional().describe("YYYY-MM-DD; omit for today"),
        }),
        execute: async ({ date }) => ({ removed: await clearDay(userId, date) }),
      }),
    },
  });
}

export type NutritionAgent = ReturnType<typeof createNutritionAgent>;
export type NutritionUIMessage = InferAgentUIMessage<NutritionAgent>;
