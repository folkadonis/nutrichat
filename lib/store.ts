import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Minimal file-backed, per-user store for the WhatsApp nutrition agent.
 *
 * Keyed by WhatsApp id (the sender's phone number, `wa_id`). Holds each user's
 * profile, daily meal log, and a short rolling conversation history so the
 * agent has context across WhatsApp messages.
 *
 * Intentionally simple (single JSON file) so the bot runs with zero infra.
 * For production / scale, swap this module for a real database (e.g. a Vercel
 * Marketplace Postgres or Upstash Redis integration).
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodItem {
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  confidence: number; // 0-100
}

export interface MealEntry {
  id: string;
  timestamp: string; // ISO
  date: string; // YYYY-MM-DD
  mealType: MealType;
  items: FoodItem[];
  caloriesMin: number;
  caloriesMax: number;
  confidence: number; // 0-100
  notes?: string;
}

export interface Profile {
  country?: string;
  dailyCalorieGoal: number;
  goal?: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

interface UserRecord {
  profile: Profile;
  meals: MealEntry[];
  history: HistoryTurn[];
}

interface DB {
  users: Record<string, UserRecord>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "log.json");
const MAX_HISTORY = 24; // rolling window of turns kept for context

function defaultUser(): UserRecord {
  return { profile: { dailyCalorieGoal: 2000 }, meals: [], history: [] };
}

async function read(): Promise<DB> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DB>;
    return { users: parsed.users ?? {} };
  } catch {
    return { users: {} };
  }
}

async function write(db: DB): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function mutate<T>(
  userId: string,
  fn: (u: UserRecord) => T,
): Promise<T> {
  const db = await read();
  const user = db.users[userId] ?? defaultUser();
  const result = fn(user);
  db.users[userId] = user;
  await write(db);
  return result;
}

export function todayString(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function sum(items: FoodItem[], key: keyof FoodItem): number {
  return items.reduce((acc, it) => acc + (Number(it[key]) || 0), 0);
}

export interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  byMealType: Record<MealType, number>;
}

export function totalsFor(meals: MealEntry[]): DailyTotals {
  const byMealType: Record<MealType, number> = {
    breakfast: 0,
    lunch: 0,
    dinner: 0,
    snack: 0,
  };
  for (const m of meals) {
    byMealType[m.mealType] += Math.round((m.caloriesMin + m.caloriesMax) / 2);
  }
  return {
    calories: meals.reduce((a, m) => a + sum(m.items, "calories"), 0),
    protein: meals.reduce((a, m) => a + sum(m.items, "protein"), 0),
    carbs: meals.reduce((a, m) => a + sum(m.items, "carbs"), 0),
    fat: meals.reduce((a, m) => a + sum(m.items, "fat"), 0),
    fiber: meals.reduce((a, m) => a + sum(m.items, "fiber"), 0),
    sugar: meals.reduce((a, m) => a + sum(m.items, "sugar"), 0),
    byMealType,
  };
}

/* ----- profile ----- */
export async function getProfile(userId: string): Promise<Profile> {
  const db = await read();
  return db.users[userId]?.profile ?? defaultUser().profile;
}

export async function setProfile(
  userId: string,
  patch: Partial<Profile>,
): Promise<Profile> {
  return mutate(userId, (u) => {
    u.profile = { ...u.profile, ...patch };
    return u.profile;
  });
}

/* ----- meals ----- */
export async function addMeal(
  userId: string,
  entry: Omit<MealEntry, "id" | "timestamp" | "date"> & { date?: string },
): Promise<{ meal: MealEntry; dayMeals: MealEntry[]; profile: Profile }> {
  return mutate(userId, (u) => {
    const meal: MealEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      date: entry.date ?? todayString(),
      mealType: entry.mealType,
      items: entry.items,
      caloriesMin: entry.caloriesMin,
      caloriesMax: entry.caloriesMax,
      confidence: entry.confidence,
      notes: entry.notes,
    };
    u.meals.push(meal);
    return {
      meal,
      dayMeals: u.meals.filter((m) => m.date === meal.date),
      profile: u.profile,
    };
  });
}

export async function getDay(
  userId: string,
  date?: string,
): Promise<{ date: string; meals: MealEntry[]; profile: Profile }> {
  const db = await read();
  const u = db.users[userId] ?? defaultUser();
  const day = date ?? todayString();
  return {
    date: day,
    meals: u.meals.filter((m) => m.date === day),
    profile: u.profile,
  };
}

export async function clearDay(userId: string, date?: string): Promise<number> {
  return mutate(userId, (u) => {
    const day = date ?? todayString();
    const before = u.meals.length;
    u.meals = u.meals.filter((m) => m.date !== day);
    return before - u.meals.length;
  });
}

/* ----- conversation history ----- */
export async function getHistory(userId: string): Promise<HistoryTurn[]> {
  const db = await read();
  return db.users[userId]?.history ?? [];
}

export async function appendHistory(
  userId: string,
  turns: HistoryTurn[],
): Promise<void> {
  await mutate(userId, (u) => {
    u.history.push(...turns);
    if (u.history.length > MAX_HISTORY) {
      u.history = u.history.slice(-MAX_HISTORY);
    }
  });
}
