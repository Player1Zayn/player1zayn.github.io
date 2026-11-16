import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors()); // Allow all origins for maximum compatibility with AI Studio and GX.games
app.use(express.json());

// Supabase Setup (Lazy Initialization)
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!url || !key) {
      const missing = [];
      if (!url) missing.push("SUPABASE_URL");
      if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
      console.error(`[CRITICAL] Missing environment variables: ${missing.join(", ")}`);
      throw new Error(`CRITICAL ERROR: ${missing.join(" and ")} are missing. Please add them to your Render.com dashboard under 'Environment'.`);
    }
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

const JWT_SECRET = process.env.JWT_SECRET || "banana_secret_monkey_business";
const activeCrashGames = new Map<string, { betAmount: bigint, crashPoint: number }>();
const activeHiloGames = new Map<string, { betAmount: bigint, firstCard: { rank: string, suit: string, value: number } }>();
const activeMinesGames = new Map<string, { betAmount: bigint, mineCount: number, mines: number[], revealed: number[], currentMultiplier: number }>();
const activeBlackjackGames = new Map<string, {
  baseBet: bigint;
  totalBet: bigint;
  deck: { rank: string; suit: string }[];
  playerHand: { rank: string; suit: string }[];
  dealerHand: { rank: string; suit: string }[];
  splitHands: { rank: string; suit: string }[][];
  activeHand: number;
  isDoubleDown: boolean;
}>();
const activeVideoPokerGames = new Map<string, {
  betAmount: bigint;
  deck: { rank: string; suit: string }[];
  initialHand: { rank: string; suit: string }[];
}>();
const activeHorseOdds = new Map<string, number[]>();
const userSonarCooldowns = new Map<string, number>();
const lastLossForInsurance = new Map<string, { amount: bigint; at: number }>();
const lastInsuranceClaimAt = new Map<string, number>();
const lastClickerExportAt = new Map<string, number>();
const rouletteGreenStreak = new Map<string, number>();

const TREE_DATA: Record<number, { cost: number; reward: number; ticks: number; name: string; reqAllTrees: boolean }> = {
  1:  { cost: 100,      reward: 2,     ticks: 5,  name: 'Common Sapling', reqAllTrees: false },
  2:  { cost: 500,      reward: 8,     ticks: 4,  name: 'Bronze Palm',    reqAllTrees: false },
  3:  { cost: 2500,     reward: 25,    ticks: 5,  name: 'Silver Grove',   reqAllTrees: false },
  4:  { cost: 10000,    reward: 70,    ticks: 7,  name: 'Gold Plantation',reqAllTrees: true  },
  5:  { cost: 40000,    reward: 160,   ticks: 8,  name: 'Jade Canopy',    reqAllTrees: true  },
  6:  { cost: 150000,   reward: 360,   ticks: 9,  name: 'Sapphire Oasis', reqAllTrees: true  },
  7:  { cost: 500000,   reward: 700,   ticks: 10, name: 'Amethyst Ancient',reqAllTrees: true },
  8:  { cost: 1500000,  reward: 1320,  ticks: 12, name: 'Ruby Colossus',  reqAllTrees: true  },
  9:  { cost: 4000000,  reward: 2400,  ticks: 15, name: 'Celestial Tree', reqAllTrees: true  },
  10: { cost: 10000000, reward: 4800,  ticks: 20, name: 'Primordial God-Tree', reqAllTrees: true }
};

const GADGET_DATA = [
  { title: 'Failsafe', cost: 50000, locked: false },
  { title: 'Increased Chance', cost: 10000, locked: false },
  { title: 'Speed reload', cost: 20000, locked: false },
  { title: 'Banana Streak', cost: 100000, locked: false },
  { title: 'Dealer Peek', cost: 250000, locked: false },
  { title: 'Mega Bet', cost: 500000, locked: false },
  { title: 'Instant Cases', cost: 75000, locked: false },
  { title: 'Sonar Radar', cost: 175000, locked: false },
  { title: 'Bumper Cushion', cost: 250000, locked: false },
  { title: 'Coming Soon', cost: 0, locked: true }
];

const SERVER_THEMES = [
  { id: 0, name: 'Classic Tropical', levelReq: 1, costBananas: 0, costCoins: 0 },
  { id: 1, name: 'Factory Theme', levelReq: 10, costBananas: 5000000, costCoins: 500 },
  { id: 2, name: 'Futuristic Theme', levelReq: 20, costBananas: 25000000, costCoins: 1500 },
  { id: 3, name: 'Ocean Theme', levelReq: 30, costBananas: 100000000, costCoins: 3500 },
  { id: 4, name: 'Extreme Tropical', levelReq: 40, costBananas: 500000000, costCoins: 10000 }
];

const SERVER_SHOP_ITEMS = [
  { id: 'banana_cloak', title: 'Banana Cloak', desc: 'Stops the Jungle Government from appearing for 15 minutes.', cost: 10, chance: 1.0, duration: 15 * 60 * 1000, icon: '🥷', prop: 'banana_cloak' },
  { id: 'xp_boost', title: 'XP-Boost', desc: 'Double XP gain for 10 minutes.', cost: 1, chance: 0.5, duration: 10 * 60 * 1000, icon: '⚡', prop: 'xp' },
  { id: 'speed_grove', title: 'Speed Grove', desc: 'Halves tree generation time for 2 minutes.', cost: 2, chance: 0.25, duration: 2 * 60 * 1000, icon: '🌪️', prop: 'speed' },
  { id: 'tree_discount', title: 'Tree Discount', desc: 'Tree purchases and upgrades cost 25% less for 5 minutes.', cost: 2, chance: 0.35, duration: 5 * 60 * 1000, icon: '🏷️', prop: 'discount' },
  { id: 'merchant_favor', title: 'Merchant Favor', desc: 'Coins cost 80,000 🍌 (normally 100k) for 10 minutes.', cost: 3, chance: 0.30, duration: 10 * 60 * 1000, icon: '🤝', prop: 'merchant' },
  { id: 'hyper_spin', title: 'Hyper Spin', desc: 'Roulette animation is instantly fast for 5 minutes.', cost: 1, chance: 0.40, duration: 5 * 60 * 1000, icon: '🎰', prop: 'fast_spin' },
  { id: 'dungeon_key', title: 'Dungeon Bypass', desc: "100% chance to enter Ludvig's Dungeon for 10 minutes.", cost: 4, chance: 0.65, duration: 10 * 60 * 1000, icon: '🗝️', prop: 'dungeon_key' }
];

const SERVER_QUEST_DEFS = [
  { id: 'easy_bet_count', tier: 'easy', reward: 2, icon: '🎲', title: 'Frequent Bettor', desc: 'Place 5 bets in any casino game', target: 5, eval: (e: string, amt: number) => e === 'bets_placed' ? amt : 0 },
  { id: 'easy_roulette_spin', tier: 'easy', reward: 2, icon: '🎡', title: 'Spin Doctor', desc: 'Spin the Roulette wheel 3 times', target: 3, eval: (e: string, amt: number) => e === 'roulette_spin' ? amt : 0 },
  { id: 'easy_slots_spin', tier: 'easy', reward: 2, icon: '🎰', title: 'Slot Explorer', desc: 'Spin the Slots machine 4 times', target: 4, eval: (e: string, amt: number) => e === 'slots_spin' ? amt : 0 },
  { id: 'easy_plinko_drop', tier: 'easy', reward: 2, icon: '🟡', title: 'Plinko Enthusiast', desc: 'Drop 3 Plinko balls', target: 3, eval: (e: string, amt: number) => e === 'plinko_drop' ? amt : 0 },
  { id: 'easy_win_bananas', tier: 'easy', reward: 2, icon: '🍌', title: 'Banana Collector', desc: 'Win a total of 5,000 🍌 from bets', target: 5000, eval: (e: string, amt: number) => e === 'win_amount' ? Math.floor(amt) : 0 },
  { id: 'easy_bj_play', tier: 'easy', reward: 2, icon: '🃏', title: 'Table Player', desc: 'Play 3 hands of Blackjack', target: 3, eval: (e: string, amt: number) => e === 'bj_play' ? amt : 0 },
  { id: 'easy_tree_buy', tier: 'easy', reward: 2, icon: '🌱', title: 'Jungle Gardener', desc: 'Buy or upgrade a Banana Tree', target: 1, eval: (e: string, amt: number) => e === 'tree_buy_upgrade' ? amt : 0 },
  { id: 'easy_banana_box', tier: 'easy', reward: 2, icon: '📦', title: 'Sweet Harvest', desc: 'Claim bananas from the Banana Box 1 time', target: 1, eval: (e: string, amt: number) => e === 'banana_box_claim' ? amt : 0 },
  { id: 'easy_hilo_correct', tier: 'easy', reward: 2, icon: '📈', title: 'Sharp Guess', desc: 'Guess correctly 2 times in Hi-Lo', target: 2, eval: (e: string, amt: number) => e === 'hilo_correct' ? amt : 0 },
  { id: 'easy_poker_play', tier: 'easy', reward: 2, icon: '♠️', title: 'Card Curious', desc: 'Play 2 hands of Video Poker', target: 2, eval: (e: string, amt: number) => e === 'poker_play' ? amt : 0 },
  { id: 'med_roulette_win', tier: 'medium', reward: 4, icon: '🎯', title: 'Wheel Whisperer', desc: 'Win 4 bets on the Roulette wheel', target: 4, eval: (e: string, amt: number) => e === 'roulette_win' ? amt : 0 },
  { id: 'med_slots_triple', tier: 'medium', reward: 4, icon: '🍒', title: 'Match Master', desc: 'Land a 3x match or Jackpot on Slots', target: 1, eval: (e: string, amt: number, m: any) => (e === 'slots_win' && (m?.isTriple || m?.isJackpot)) ? 1 : 0 },
  { id: 'med_bj_wins', tier: 'medium', reward: 4, icon: '👑', title: 'Blackjack Sharpshooter', desc: 'Win 3 hands of Blackjack', target: 3, eval: (e: string, amt: number) => e === 'bj_win' ? amt : 0 },
  { id: 'med_mines_clear', tier: 'medium', reward: 4, icon: '💣', title: 'Mine Sweeper', desc: 'Cash out in Mines with 3+ bananas revealed', target: 1, eval: (e: string, amt: number, m: any) => (e === 'mines_cashout' && (m?.gems || 0) >= 3) ? 1 : 0 },
  { id: 'med_plinko_mult', tier: 'medium', reward: 4, icon: '🔥', title: 'Bounce King', desc: 'Hit a 5x or higher multiplier in Plinko', target: 1, eval: (e: string, amt: number, m: any) => (e === 'plinko_mult' && (m?.mult || 0) >= 5) ? 1 : 0 },
  { id: 'med_crash_mult', tier: 'medium', reward: 4, icon: '🚀', title: 'Rocket Rider', desc: 'Cash out in Crash at 2.5x or higher', target: 1, eval: (e: string, amt: number, m: any) => (e === 'crash_cashout' && (m?.mult || 0) >= 2.5) ? 1 : 0 },
  { id: 'med_win_streak', tier: 'medium', reward: 4, icon: '⚡', title: 'On Fire', desc: 'Reach a win streak of 3 wins in a row', target: 1, eval: (e: string, amt: number, m: any) => (e === 'win_streak' && (m?.streak || 0) >= 3) ? 1 : 0 },
  { id: 'med_win_50k', tier: 'medium', reward: 4, icon: '💰', title: 'Mid-Stakes Winner', desc: 'Win a total of 50,000 🍌 across any games', target: 50000, eval: (e: string, amt: number) => e === 'win_amount' ? Math.floor(amt) : 0 },
  { id: 'med_case_open', tier: 'medium', reward: 4, icon: '🎁', title: 'Case Opener', desc: 'Open 3 Banana Cases', target: 3, eval: (e: string, amt: number) => e === 'case_open' ? amt : 0 },
  { id: 'med_poker_win', tier: 'medium', reward: 4, icon: '💎', title: 'Poker Tactician', desc: 'Win 3 hands of Video Poker', target: 3, eval: (e: string, amt: number) => e === 'poker_win' ? amt : 0 },
  { id: 'hard_roulette_green', tier: 'hard', reward: 6, icon: '💚', title: 'Green Miracle', desc: 'Land on GREEN in Roulette', target: 1, eval: (e: string, amt: number, m: any) => (e === 'roulette_win' && m?.isGreen) ? 1 : 0 },
  { id: 'hard_slots_jackpot', tier: 'hard', reward: 6, icon: '💰', title: 'Jackpot Hunter', desc: 'Hit a MONEY BAG 💰 Jackpot on Slots', target: 1, eval: (e: string, amt: number, m: any) => (e === 'slots_win' && m?.isJackpot) ? 1 : 0 },
  { id: 'hard_crash_5x', tier: 'hard', reward: 6, icon: '🛸', title: 'To The Moon', desc: 'Cash out in Crash at 5.0x or higher', target: 1, eval: (e: string, amt: number, m: any) => (e === 'crash_cashout' && (m?.mult || 0) >= 5) ? 1 : 0 },
  { id: 'hard_plinko_10x', tier: 'hard', reward: 6, icon: '🌠', title: 'Gravity Defier', desc: 'Hit a 10x or higher multiplier in Plinko', target: 1, eval: (e: string, amt: number, m: any) => (e === 'plinko_mult' && (m?.mult || 0) >= 10) ? 1 : 0 },
  { id: 'hard_bj_natural', tier: 'hard', reward: 6, icon: '✨', title: 'Ace & King', desc: 'Get a natural Blackjack (21 on first 2 cards)', target: 1, eval: (e: string, amt: number, m: any) => (e === 'bj_win' && m?.isNatural) ? 1 : 0 },
  { id: 'hard_mines_high', tier: 'hard', reward: 6, icon: '🧨', title: 'Bomb Squad Master', desc: 'Cash out in Mines with 7+ safe tiles revealed', target: 1, eval: (e: string, amt: number, m: any) => (e === 'mines_cashout' && (m?.gems || 0) >= 7) ? 1 : 0 },
  { id: 'hard_poker_flush', tier: 'hard', reward: 6, icon: '🎴', title: 'High Roller Hand', desc: 'Get a Flush, Full House or higher in Poker', target: 1, eval: (e: string, amt: number, m: any) => (e === 'poker_win' && m?.rank && ['FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH', 'ROYAL FLUSH'].includes(String(m.rank).toUpperCase())) ? 1 : 0 },
  { id: 'hard_mega_win', tier: 'hard', reward: 6, icon: '👑', title: 'Jungle Kingpin', desc: 'Win 500,000+ 🍌 in a single bet', target: 1, eval: (e: string, amt: number) => (e === 'win_amount' && amt >= 500000) ? 1 : 0 }
];

function parseNonNegativeBigInt(val: any): bigint | null {
  if (val === undefined || val === null || val === '') return 0n;
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

function getXpForLevelServer(l: number): number {
  if (l <= 1) return 100;
  return Math.floor(100 + (l - 1) * 80 + Math.pow(l - 1, 1.8) * 25);
}

function parseJsonSafe(raw: any, fallback: any) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function generateServerQuests() {
  const pickRandom = (arr: any[], count: number) => {
    const copy = [...arr];
    const out: any[] = [];
    for (let i = 0; i < count && copy.length > 0; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  };
  const chosen = [
    ...pickRandom(SERVER_QUEST_DEFS.filter(q => q.tier === 'easy'), 2),
    ...pickRandom(SERVER_QUEST_DEFS.filter(q => q.tier === 'medium'), 2),
    ...pickRandom(SERVER_QUEST_DEFS.filter(q => q.tier === 'hard'), 1)
  ];
  return chosen.map(def => ({
    id: def.id,
    tier: def.tier,
    reward: def.reward,
    icon: def.icon,
    title: def.title,
    desc: def.desc,
    target: def.target,
    progress: 0,
    completed: false,
    claimed: false
  }));
}

function ensureUserMeta(inventoryObj: any) {
  const now = Date.now();
  const inv = (inventoryObj && typeof inventoryObj === 'object') ? inventoryObj : {};
  if (!inv._meta || typeof inv._meta !== 'object') inv._meta = {};
  const meta = inv._meta;
  if (!meta.boosts || typeof meta.boosts !== 'object') meta.boosts = {};
  if (!meta.lastHarvestAt || typeof meta.lastHarvestAt !== 'number') meta.lastHarvestAt = now;
  if (!meta.shop || typeof meta.shop !== 'object' || !Array.isArray(meta.shop.stock) || meta.shop.stock.length !== SERVER_SHOP_ITEMS.length || now > (meta.shop.refreshTime || 0)) {
    meta.shop = {
      stock: SERVER_SHOP_ITEMS.map(item => Math.random() < item.chance),
      purchased: Array(SERVER_SHOP_ITEMS.length).fill(false),
      refreshTime: now + 10 * 60 * 1000
    };
  }
  if (!meta.quests || typeof meta.quests !== 'object' || !Array.isArray(meta.quests.active) || meta.quests.active.length < 5 || now >= (meta.quests.refreshTimestamp || 0)) {
    meta.quests = {
      active: generateServerQuests(),
      refreshTimestamp: now + 3600000
    };
  }
  return { inv, meta };
}

function accrueTreeBoxFromElapsed(treesArr: number[], currentBox: bigint, meta: any): { newBox: bigint; gained: bigint } {
  const now = Date.now();
  const lastAt = Number(meta.lastHarvestAt || now);
  const elapsedSec = Math.max(0, Math.min(86400, (now - lastAt) / 1000)); // Cap idle accrual to 24h per jump
  meta.lastHarvestAt = now;
  if (elapsedSec < 0.25) return { newBox: currentBox, gained: 0n };

  const speedUntil = Number(meta.boosts?.speed || 0);
  const effectiveMultiplier = speedUntil > lastAt ? (speedUntil >= now ? 2.0 : 1.0 + Math.min(1.0, (speedUntil - lastAt) / (now - lastAt))) : 1.0;

  let perSec = 0;
  for (let i = 0; i < 20; i++) {
    const lvl = Number(treesArr[i] || 0);
    if (lvl > 0 && TREE_DATA[lvl]) {
      perSec += (TREE_DATA[lvl].reward / TREE_DATA[lvl].ticks);
    }
  }
  const gainedNum = Math.floor(perSec * elapsedSec * effectiveMultiplier);
  const gained = gainedNum > 0 ? BigInt(gainedNum) : 0n;
  return { newBox: currentBox + gained, gained };
}

function advanceServerQuests(meta: any, eventType: string, amount = 1, metadata: any = {}) {
  const quests = meta?.quests?.active;
  if (!Array.isArray(quests)) return;
  for (const q of quests) {
    if (q.completed) continue;
    const def = SERVER_QUEST_DEFS.find(d => d.id === q.id);
    if (!def) continue;
    const added = def.eval(eventType, amount, metadata);
    if (added > 0) {
      q.progress = Math.min(q.target, Number(q.progress || 0) + added);
      if (q.progress >= q.target) q.completed = true;
    }
  }
}

function buildBlackjackDeck() {
  const suits = ['H', 'D', 'C', 'S'];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const d: { rank: string; suit: string }[] = [];
  for (const s of suits) for (const r of ranks) d.push({ suit: s, rank: r });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function calcBjScore(hand: { rank: string; suit: string }[]): number {
  let sum = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { sum += 11; aces++; }
    else if (['J', 'Q', 'K'].includes(c.rank)) sum += 10;
    else sum += parseInt(c.rank, 10) || 0;
  }
  while (sum > 21 && aces > 0) { sum -= 10; aces--; }
  return sum;
}

function generateFairHorseOdds(): number[] {
  const rawWeights = Array.from({ length: 10 }, () => 8.5 + Math.random() * 3.0);
  const total = rawWeights.reduce((a, b) => a + b, 0);
  const normalized = rawWeights.map(w => Math.round((w / total) * 1000) / 10);
  const curSum = normalized.reduce((a, b) => a + b, 0);
  const diff = Math.round((100.0 - curSum) * 10) / 10;
  normalized[0] = Math.round((normalized[0] + diff) * 10) / 10;
  return normalized;
}

// Middleware to verify JWT
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  });
};

// --- API ROUTES ---

// Register
app.post("/api/register", async (req, res) => {
  const { name, id, password, starterCode } = req.body;

  if (!name || !id || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (name.length < 3 || name.length > 20) {
    return res.status(400).json({ error: "Name must be between 3 and 20 characters" });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: "Name can only contain letters, numbers, and underscores" });
  }

  try {
    const supabase = getSupabase();
    // Check if user exists
    const { data: existing } = await supabase.from('database').select('id').eq('name', name).maybeSingle();
    if (existing) {
      return res.status(400).json({ error: "Name already taken" });
    }

    let initialScore = 0;
    let initialCoins = 0;

    if (starterCode && typeof starterCode === 'string') {
      try {
        const { data: codeData, error: codeError } = await supabase.from('starter_codes').select('*').eq('code', starterCode.trim()).maybeSingle();
        if (codeError) throw codeError;
        
        if (codeData && codeData.active) {
          initialScore = Number(codeData.reward_bananas || 0);
          initialCoins = Number(codeData.reward_coins || 0);
        } else {
          return res.status(400).json({ error: "Invalid or inactive starter code" });
        }
      } catch (err: any) {
        if (err.code === 'PGRST116' || err.message?.includes('relation "starter_codes" does not exist')) {
            console.warn("Starter codes table does not exist yet.");
            return res.status(400).json({ error: "Starter codes not set up yet." });
        }
        return res.status(500).json({ error: "Error verifying starter code." });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { inv: initialInventoryObj } = ensureUserMeta({});
    const { error } = await supabase.from('database').insert({
      id,
      name,
      password: hashedPassword,
      score: initialScore,
      coins: initialCoins,
      banana_box: 0,
      level: 1,
      xp: 0,
      trees: JSON.stringify([1, ...Array(19).fill(0)]),
      gadgets: JSON.stringify(Array(10).fill(false)),
      unlocked_titles: JSON.stringify([]),
      equipped_title: null,
      inventory: JSON.stringify(initialInventoryObj),
      active_gadgets: JSON.stringify(Array(10).fill(false)),
      vladimir_quest_status: 0,
      banned: false
    });

    if (error) throw error;

    const token = jwt.sign({ userId: id, name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, id, name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase.from('database').select('*').eq('name', name).maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    let validPassword = false;
    try {
        // Try bcrypt comparison first
        validPassword = await bcrypt.compare(password, user.password);
    } catch (e) {
        // If it's not a valid bcrypt hash, it might be plain text
        validPassword = false;
    }

    // Migration logic: If bcrypt fails, check if it's a plain text match
    if (!validPassword && password === user.password) {
        validPassword = true;
        // Migrate to hashed password for future logins
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            await supabase.from('database').update({ password: hashedPassword }).eq('id', user.id);
            console.log(`Migrated user ${name} to hashed password.`);
        } catch (migrationError) {
            console.error("Failed to migrate password:", migrationError);
        }
    }

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    
    // Don't send password back to client
    const { password: _, ...userData } = user;
    const rawInv = parseJsonSafe(user.inventory, {});
    const { inv: syncedInv, meta } = ensureUserMeta(rawInv);
    const treesArr = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    const { newBox } = accrueTreeBoxFromElapsed(treesArr, BigInt(user.banana_box || 0), meta);
    await supabase.from('database').update({
      banana_box: String(newBox),
      inventory: JSON.stringify(syncedInv)
    }).eq('id', user.id);

    let userTheme = 0;
    let unlockedThemes = [0];
    if (syncedInv && syncedInv._theme !== undefined) userTheme = Number(syncedInv._theme);
    if (syncedInv && Array.isArray(syncedInv._unlocked_themes)) unlockedThemes = syncedInv._unlocked_themes;
    if (user.theme !== undefined && user.theme !== null) userTheme = Number(user.theme);
    if (user.unlocked_themes) {
      const dbThemes = parseJsonSafe(user.unlocked_themes, null);
      if (Array.isArray(dbThemes)) unlockedThemes = dbThemes;
    }
    userData.banana_box = String(newBox);
    userData.inventory = syncedInv;
    userData.theme = userTheme;
    userData.unlocked_themes = unlockedThemes;
    userData.meta = meta;
    res.json({ token, ...userData });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save Data (Strict: Preferences & Cosmetics ONLY — currencies/items/trees/levels/quests are server-authoritative)
app.post("/api/save", authenticateToken, async (req: any, res) => {
  const { userId, equipped_title, active_gadgets, theme } = req.body;

  if (userId && req.user.userId !== userId) {
    return res.status(403).json({ error: "Cannot save data for another user" });
  }
  const targetUserId = req.user.userId;

  try {
    const supabase = getSupabase();
    const { data: current, error: fetchError } = await supabase
      .from('database')
      .select('*')
      .eq('id', targetUserId)
      .maybeSingle();

    if (fetchError || !current) {
      return res.status(404).json({ error: "User not found" });
    }

    const unlockedTitles = parseJsonSafe(current.unlocked_titles, []);
    const unlockedGadgets = parseJsonSafe(current.gadgets, Array(10).fill(false));
    const currentInv = parseJsonSafe(current.inventory, {});
    const { inv: invObj, meta } = ensureUserMeta(currentInv);

    let safeUnlockedThemes: number[] = [0];
    if (Array.isArray(invObj._unlocked_themes)) safeUnlockedThemes = invObj._unlocked_themes.map(Number);
    if (current.unlocked_themes) {
      const dbThemes = parseJsonSafe(current.unlocked_themes, null);
      if (Array.isArray(dbThemes)) safeUnlockedThemes = dbThemes.map(Number);
    }
    if (!safeUnlockedThemes.includes(0)) safeUnlockedThemes.unshift(0);

    // 1. Validate equipped_title against server unlocked_titles
    let safeEquippedTitle = current.equipped_title || null;
    if (equipped_title === null) {
      safeEquippedTitle = null;
    } else if (typeof equipped_title === 'string' && Array.isArray(unlockedTitles) && unlockedTitles.includes(equipped_title)) {
      safeEquippedTitle = equipped_title;
    }

    // 2. Validate theme against server unlocked_themes
    let safeTheme = current.theme !== undefined && current.theme !== null ? Number(current.theme) : Number(invObj._theme || 0);
    if (theme !== undefined && theme !== null) {
      const reqTheme = Number(theme);
      if (safeUnlockedThemes.includes(reqTheme)) {
        safeTheme = reqTheme;
      }
    }
    invObj._theme = safeTheme;
    invObj._unlocked_themes = safeUnlockedThemes;

    // 3. Validate active_gadgets (max 2, must be owned on server, and not mid-round)
    let safeActiveGadgets = parseJsonSafe(current.active_gadgets, Array(10).fill(false));
    if (Array.isArray(active_gadgets) && !activeBlackjackGames.has(targetUserId) && !activeMinesGames.has(targetUserId) && !activeCrashGames.has(targetUserId) && !activeHiloGames.has(targetUserId) && !activeVideoPokerGames.has(targetUserId)) {
      const candidate = Array.from({ length: 10 }, (_, i) => Boolean(active_gadgets[i]) && Boolean(unlockedGadgets[i]));
      let count = 0;
      for (let i = 0; i < 10; i++) {
        if (candidate[i]) {
          count++;
          if (count > 2) candidate[i] = false;
        }
      }
      safeActiveGadgets = candidate;
    }

    const basePayload: any = {
      equipped_title: safeEquippedTitle,
      active_gadgets: JSON.stringify(safeActiveGadgets),
      inventory: JSON.stringify(invObj),
      updated_at: new Date().toISOString()
    };

    let { error: upsertError } = await supabase.from('database').update({
      ...basePayload,
      theme: safeTheme,
      unlocked_themes: JSON.stringify(safeUnlockedThemes)
    }).eq('id', targetUserId);

    if (upsertError && upsertError.code === 'PGRST204') {
      const retryResult = await supabase.from('database').update({ ...basePayload, theme: safeTheme }).eq('id', targetUserId);
      if (retryResult.error && retryResult.error.code === 'PGRST204') {
        const fallbackResult = await supabase.from('database').update(basePayload).eq('id', targetUserId);
        upsertError = fallbackResult.error;
      } else {
        upsertError = retryResult.error;
      }
    }

    if (upsertError) {
      return res.status(500).json({ error: upsertError.message });
    }

    const { data: updatedUser } = await supabase.from('database').select('*').eq('id', targetUserId).maybeSingle();
    if (updatedUser) {
      const { password: _, ...userData } = updatedUser;
      userData.score = String(userData.score);
      userData.coins = String(userData.coins);
      userData.xp = String(userData.xp);
      userData.banana_box = String(userData.banana_box);
      userData.theme = safeTheme;
      userData.unlocked_themes = safeUnlockedThemes;
      userData.meta = meta;
      return res.json({ success: true, user: userData });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Global Inventory Stats
app.get("/api/global-inventory", async (req, res) => {
  try {
    const supabase = getSupabase();
    // Fetch only inventory column to be efficient
    const { data, error } = await supabase.from('database').select('inventory');
    
    if (error) throw error;
    
    const totals: Record<string, number> = {};
    
    data.forEach((row: any) => {
      let inv = row.inventory;
      if (typeof inv === 'string') {
        try {
          inv = JSON.parse(inv);
        } catch (e) {
          inv = {};
        }
      }
      
      if (inv && typeof inv === 'object' && inv !== null) {
        for (const skinId in inv) {
          if (skinId.startsWith('_') || !SKINS_METADATA[skinId]) continue;
          const count = Number(inv[skinId]);
          if (!isNaN(count) && count > 0) {
            totals[skinId] = (totals[skinId] || 0) + count;
          }
        }
      }
    });
    
    res.json({ success: true, totals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Ban User
app.post("/api/ban", authenticateToken, async (req: any, res) => {
  // Ban feature temporarily disabled as requested
  res.json({ success: true, message: "Ban feature is currently disabled" });
});

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// --- GAME LOGIC CONSTANTS ---
const SLOT_ICONS = ['🍎', '🍉', '🥝', '🍐', '🍍', '🍇', '🍓', '🍊', '🍋', '🍌'];
const JACKPOT_ICON = '💰';

const SKINS = [
    // Common (36)
    { id: 'c1', name: 'Green Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c2', name: 'Blue Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c3', name: 'Red Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c4', name: 'Yellow Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c5', name: 'Orange Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c6', name: 'Purple Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c7', name: 'Pink Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c8', name: 'Brown Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c9', name: 'Black Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c10', name: 'White Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c11', name: 'Gray Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c12', name: 'Cyan Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c13', name: 'Magenta Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c14', name: 'Lime Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c15', name: 'Teal Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c16', name: 'Indigo Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c17', name: 'Violet Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c18', name: 'Silver Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c19', name: 'Bronze Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c20', name: 'Classic Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c21', name: 'Sky Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c22', name: 'Grass Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c23', name: 'Wood Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c24', name: 'Sand Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c25', name: 'Rock Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c26', name: 'Leaf Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c27', name: 'Mist Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c28', name: 'Coral Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c29', name: 'Autumn Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c30', name: 'Spring Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c31', name: 'Ash Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c32', name: 'Clay Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c33', name: 'Moss Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c34', name: 'Dune Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c35', name: 'Pebble Banana', rarity: 'Common', color: '#22c55e' },
    { id: 'c36', name: 'Twilight Banana', rarity: 'Common', color: '#22c55e' },

    // Rare (36)
    { id: 'r1', name: 'Spotted Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r2', name: 'Striped Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r3', name: 'Polka Dot Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r4', name: 'Camo Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r5', name: 'Zebra Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r6', name: 'Leopard Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r7', name: 'Tiger Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r8', name: 'Cheetah Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r9', name: 'Giraffe Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r10', name: 'Snake Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r11', name: 'Crocodile Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r12', name: 'Shark Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r13', name: 'Whale Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r14', name: 'Dolphin Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r15', name: 'Penguin Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r16', name: 'Panda Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r17', name: 'Koala Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r18', name: 'Sloth Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r19', name: 'Marble Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r20', name: 'Splattered Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r21', name: 'Tartan Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r22', name: 'Hexagon Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r23', name: 'Circuit Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r24', name: 'Pixel Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r25', name: 'Glitch Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r26', name: 'Neon Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r27', name: 'Pastel Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r28', name: 'Metallic Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r29', name: 'Amethyst Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r30', name: 'Topaz Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r31', name: 'Prismatic Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r32', name: 'Carbon Fiber Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r33', name: 'Chrome Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r34', name: 'Matrix Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r35', name: 'Magma Banana', rarity: 'Rare', color: '#3b82f6' },
    { id: 'r36', name: 'Frostbite Banana', rarity: 'Rare', color: '#3b82f6' },

    // Epic (26)
    { id: 'e1', name: 'Fire Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e2', name: 'Ice Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e3', name: 'Thunder Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e4', name: 'Wind Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e5', name: 'Earth Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e6', name: 'Water Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e7', name: 'Light Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e8', name: 'Dark Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e9', name: 'Spirit Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e10', name: 'Ghost Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e11', name: 'Solar Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e12', name: 'Lunar Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e13', name: 'Plasma Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e14', name: 'Radioactive Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e15', name: 'Cyber Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e16', name: 'Steampunk Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e17', name: 'Holographic Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e18', name: 'Ethereal Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e19', name: 'Void Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e20', name: 'Pulsing Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e21', name: 'Molten Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e22', name: 'Glacial Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e23', name: 'Tempest Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e24', name: 'Vortex Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e25', name: 'Chrono Banana', rarity: 'Epic', color: '#a855f7' },
    { id: 'e26', name: 'Gravity Banana', rarity: 'Epic', color: '#a855f7' },

    // Mythic (12)
    { id: 'm1', name: 'Galaxy Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm2', name: 'Nebula Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm3', name: 'Supernova Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm4', name: 'Black Hole Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm5', name: 'Cosmic Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm6', name: 'Dark Matter Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm7', name: 'Singularity Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm8', name: 'Quasar Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm9', name: 'Eclipse Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm10', name: 'Hypernova Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm11', name: 'Event Horizon Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm12', name: 'Celestial Dragon Banana', rarity: 'Mythic', color: '#ef4444' },

    // Legendary (9)
    { id: 'l1', name: 'Golden Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l2', name: 'Diamond Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l3', name: 'Rainbow Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l4', name: 'Emerald King Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l5', name: 'Ruby Sovereign Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l6', name: 'Sapphire Titan Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l7', name: 'Platinum Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l8', name: 'Obsidian Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l9', name: 'Sun God Banana', rarity: 'Legendary', color: '#facc15' },

    // Ominous (5) - Higher than Legendary!
    { id: 'o1', name: 'Eldritch Banana', rarity: 'Ominous', color: '#ffffff' },
    { id: 'o2', name: 'Abyssal Monarch Banana', rarity: 'Ominous', color: '#ffffff' },
    { id: 'o3', name: 'Doomsday Banana', rarity: 'Ominous', color: '#ffffff' },
    { id: 'o4', name: 'Void Sovereign Banana', rarity: 'Ominous', color: '#ffffff' },
    { id: 'o5', name: 'Blood Moon Banana', rarity: 'Ominous', color: '#ffffff' }
];

const CASE_COSTS: Record<string, bigint> = {
    'normal': 10000n,
    'booster': 100000n,
    'jungle': 500000n,
    'toverland': 2000000n,
    'cosmic': 50000000n,
    'abyssal': 750000000n,
    'void': 10000000000n
};

// --- PLINKO MULTIPLIER TABLES ---
const PLINKO_PAYOUTS: Record<number, Record<string, number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    gorilla: [60, 5, 1.0, 0.1, 0, 0.1, 1.0, 5, 60]
  },
  10: {
    low: [8.9, 3, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 3, 8.9],
    medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    gorilla: [150, 15, 2, 0.5, 0.1, 0, 0.1, 0.5, 2, 15, 150]
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    gorilla: [400, 40, 10, 2, 0.2, 0.1, 0, 0.1, 0.2, 2, 10, 40, 400]
  },
  14: {
    low: [13, 5, 1.9, 1.4, 1.3, 1.1, 1.0, 0.5, 1.0, 1.1, 1.3, 1.4, 1.9, 5, 13],
    medium: [58, 15, 7, 4, 1.9, 1.0, 0.5, 0.2, 0.5, 1.0, 1.9, 4, 7, 15, 58],
    high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    gorilla: [1000, 100, 25, 5, 1, 0.2, 0, 0, 0, 0.2, 1, 5, 25, 100, 1000]
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.3, 0.2, 0.2, 0.2, 0.3, 2, 4, 9, 26, 130, 1000],
    gorilla: [2500, 300, 60, 15, 4, 1, 0.1, 0, 0, 0, 0.1, 1, 4, 15, 60, 300, 2500]
  }
};

// Get Server Status
app.get("/api/server-status", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    // Auth Check for online status (update last active)
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      if (token) {
        try {
          const user = jwt.verify(token, JWT_SECRET) as any;
          if (user && user.userId) {
              await supabase.from('database').update({ updated_at: new Date().toISOString() }).eq('id', user.userId);
          }
        } catch(e) {}
      }
    }

    const { data, error } = await supabase
      .from('server_status')
      .select('server_ban')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
        // If table doesn't exist yet, default to false
        if (error.code === 'PGRST116' || error.message.includes('relation "server_status" does not exist')) {
            return res.json({ server_ban: false });
        }
        throw error;
    }
    
    res.json({ server_ban: data ? data.server_ban : false });
  } catch (error: any) {
    console.error("Server status error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Creator Code Claim
app.post("/api/creator-code/claim", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: "Invalid code" });
  }

  try {
    const supabase = getSupabase();
    
    // Fetch user
    const { data: user, error: userError } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (userError || !user) return res.status(404).json({ error: "User not found" });

    // Check balance limit (< 10,000,000 bananas)
    const currentScore = Number(user.score || 0);
    if (currentScore >= 10000000) {
      return res.status(400).json({ error: "Balance too high to use a creator code (must be under 10M)." });
    }

    // Check time limit (once per minute)
    const lastClaim = user.last_creator_code_claim ? new Date(user.last_creator_code_claim).getTime() : 0;
    const now = Date.now();
    if (now - lastClaim < 60 * 1000) {
      return res.status(400).json({ error: "Please wait 1 minute between claiming creator codes." });
    }

    // Fetch code
    const { data: codeData, error: codeError } = await supabase.from('creator_codes').select('*').eq('code', code.trim()).maybeSingle();
    
    if (codeError) {
        if (codeError.code === 'PGRST116' || codeError.message?.includes('relation "creator_codes" does not exist')) {
            return res.status(400).json({ error: "Creator codes not set up yet." });
        }
        throw codeError;
    }

    if (!codeData || !codeData.active) {
      return res.status(400).json({ error: "Invalid or inactive creator code." });
    }

    // Apply reward
    const rewardBananas = Number(codeData.reward_bananas || 0);
    const rewardCoins = Number(codeData.reward_coins || 0);

    const newScore = currentScore + rewardBananas;
    const newCoins = Number(user.coins || 0) + rewardCoins;

    const { error: updateError } = await supabase.from('database').update({
      score: newScore,
      coins: newCoins,
      last_creator_code_claim: new Date(now).toISOString()
    }).eq('id', userId);

    if (updateError) throw updateError;

    res.json({
      success: true,
      bananasAdded: rewardBananas,
      coinsAdded: rewardCoins,
      newScore: newScore
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Play Game (100% Server-authoritative result generation, progression & validation)
app.post("/api/play", authenticateToken, async (req: any, res) => {
    const {
      gameMode,
      betAmount,
      betColor,
      isBonusBet,
      bonusBetAmount,
      bonusBetSelection,
      activeGadgets: clientActiveGadgets,
      guess,
      caseType
    } = req.body;
    const userId = req.user.userId;

    try {
        const supabase = getSupabase();

        // Global Server Ban Check
        const { data: status } = await supabase.from('server_status').select('server_ban').eq('id', 1).maybeSingle();
        if (status?.server_ban) {
            return res.status(503).json({ error: "Game Offline. Try again later or contact Zayn." });
        }

        const { data: user, error: fetchError } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
        if (fetchError || !user) return res.status(404).json({ error: "User not found" });

        if (user.banned) {
            await supabase.from('database').update({ banned: false, ban_reason: null }).eq('id', userId);
        }

        let currentBananas = parseNonNegativeBigInt(user.score) ?? 0n;
        let winStreak = Math.max(0, Number(user.win_streak || 0));
        let userLevel = Math.max(1, Number(user.level || 1));
        let userXp = Math.max(0, Number(user.xp || 0));
        let vladimirStatus = Number(user.vladimir_quest_status || 0);

        const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
        const unlockTitleServer = (tid: string) => {
            if (!unlockedTitles.includes(tid)) unlockedTitles.push(tid);
        };

        const rawInventory = parseJsonSafe(user.inventory, {});
        const { inv: newInventory, meta } = ensureUserMeta(rawInventory);

        // Parse and validate bets strictly from DB / sanitized inputs (NEVER trust clientScore)
        const parsedBet = parseNonNegativeBigInt(betAmount ?? 0);
        const parsedBonus = parseNonNegativeBigInt(bonusBetAmount ?? 0);
        if (parsedBet === null || parsedBonus === null) {
            return res.status(400).json({ error: "Invalid bet amount." });
        }

        const ballCount = gameMode === 'plinko' ? Math.max(1, Math.min(10, Math.floor(Number(req.body.ballCount) || 1))) : 1;
        const bet = parsedBet;
        let bonusBet = (gameMode === 'slots' && isBonusBet) ? parsedBonus : 0n;
        if (gameMode === 'slots' && isBonusBet) {
            if (bonusBet <= 0n || bonusBet > bet / 2n) {
                return res.status(400).json({ error: "Bonus bet must be positive and at most 50% of base bet." });
            }
        } else {
            bonusBet = 0n;
        }

        let totalBet = (bet * BigInt(ballCount)) + bonusBet;

        const unlockedGadgets: boolean[] = parseJsonSafe(user.gadgets, Array(10).fill(false));
        const dbActiveGadgets: boolean[] = parseJsonSafe(user.active_gadgets, Array(10).fill(false));
        const requestedGadgets = Array.isArray(clientActiveGadgets) ? clientActiveGadgets : dbActiveGadgets;
        const activeGadgets: boolean[] = Array(10).fill(false);
        let activeGadgetCount = 0;
        for (let i = 0; i < 10; i++) {
            if (Boolean(requestedGadgets[i]) && Boolean(unlockedGadgets[i]) && !GADGET_DATA[i]?.locked) {
                if (activeGadgetCount < 2) {
                    activeGadgets[i] = true;
                    activeGadgetCount++;
                }
            }
        }

        const ZERO_BET_MODES = new Set([
            'cases', 'crash_cashout', 'crash_loss', 'hilo_guess',
            'mines_pick', 'mines_cashout',
            'poker_draw',
            'blackjack_hit', 'blackjack_stand', 'blackjack_double', 'blackjack_split'
        ]);

        const START_MODES_NEEDING_POSITIVE_BET = new Set([
            'roulette', 'slots', 'poker_start', 'crash_start', 'hilo_start',
            'mines_start', 'plinko', 'horseracing', 'blackjack_start'
        ]);

        if (START_MODES_NEEDING_POSITIVE_BET.has(gameMode) && bet <= 0n) {
            return res.status(400).json({ error: "Bet amount must be greater than 0." });
        }

        if (!ZERO_BET_MODES.has(gameMode)) {
            if (currentBananas < totalBet) {
                return res.status(400).json({
                    error: "Insufficient bananas for this bet.",
                    serverBalance: String(currentBananas),
                    attemptedBet: String(totalBet)
                });
            }
        }

        let winAmount = 0n;
        let resultData: any = {};
        let megaBetOutcome: 'win' | 'taxes' | 'none' = 'none';
        let isGameOutcomeResolved = true;
        let effectiveBet = totalBet;
        let resolvedGameCategory: string = gameMode;
        const balanceBeforePlay = currentBananas;

        if (gameMode === 'roulette') {
            if (!['red', 'black', 'green'].includes(String(betColor))) {
                return res.status(400).json({ error: "Invalid roulette color." });
            }
            const rand = Math.random();
            const pRed = activeGadgets[1] ? 0.42 : 0.46;
            const pBlack = activeGadgets[1] ? 0.42 : 0.46;

            let winningColor: 'red' | 'black' | 'green';
            if (rand < pRed) winningColor = 'red';
            else if (rand < pRed + pBlack) winningColor = 'black';
            else winningColor = 'green';

            resultData.winningColor = winningColor;
            advanceServerQuests(meta, 'roulette_spin', 1);
            advanceServerQuests(meta, 'bets_placed', 1);

            if (betColor === winningColor) {
                const mult = winningColor === 'green' ? 14n : 2n;
                winAmount = bet * mult;
                if (winningColor === 'green') {
                    const gStreak = (rouletteGreenStreak.get(userId) || 0) + 1;
                    rouletteGreenStreak.set(userId, gStreak);
                    if (gStreak >= 3) unlockTitleServer('lucky_one');
                } else {
                    rouletteGreenStreak.set(userId, 0);
                }
            } else {
                rouletteGreenStreak.set(userId, 0);
                winAmount = 0n;
            }
        } else if (gameMode === 'slots') {
            const slotCount = 6;
            const resultSlots: string[] = [];

            for (let i = 0; i < slotCount; i++) {
                const r = Math.random() * 100;
                const jackpotChance = 1.8;
                if (r < jackpotChance) {
                    resultSlots.push(JACKPOT_ICON);
                } else {
                    const lineStart = Math.floor(i / 3) * 3;
                    const symbolsInLine = resultSlots.slice(lineStart, i);
                    const duplicateChance = 0.16;
                    if (symbolsInLine.length > 0 && Math.random() < duplicateChance) {
                        const picked = symbolsInLine[Math.floor(Math.random() * symbolsInLine.length)];
                        resultSlots.push(picked);
                    } else {
                        resultSlots.push(SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)]);
                    }
                }
            }
            resultData.slots = resultSlots;
            advanceServerQuests(meta, 'slots_spin', 1);
            advanceServerQuests(meta, 'bets_placed', 1);

            let totalWinMultiplier = 0;
            let winType = 'none';

            const checkLine = (indices: number[]) => {
                const icons = indices.map(idx => resultSlots[idx]);
                if (icons.every(icon => icon === icons[0])) {
                    if (icons[0] === JACKPOT_ICON) {
                        winType = 'jackpot';
                        return 10;
                    }
                    if (winType === 'none' || winType === 'double') winType = 'triple';
                    return 3;
                }
                const counts: Record<string, number> = {};
                icons.forEach(icon => counts[icon] = (counts[icon] || 0) + 1);
                if (Object.values(counts).some(c => c >= 2)) {
                    if (winType === 'none') winType = 'double';
                    return 1;
                }
                return 0;
            };

            [[0, 1, 2], [3, 4, 5]].forEach(line => {
                totalWinMultiplier += checkLine(line);
            });

            resultData.winType = winType;
            winAmount = BigInt(Math.round(Number(bet) * totalWinMultiplier));

            if (isBonusBet && bonusBet > 0n && Array.isArray(bonusBetSelection) && bonusBetSelection.length === 3) {
                const checkBonus = (indices: number[]) => indices.every((idx, i) => resultSlots[idx] === bonusBetSelection[i]);
                if (checkBonus([0, 1, 2]) || checkBonus([3, 4, 5])) {
                    winAmount += bonusBet * 50n;
                    resultData.bonusWin = true;
                }
            }
        } else if (gameMode === 'blackjack_start') {
            if (activeBlackjackGames.has(userId)) {
                return res.status(400).json({ error: "A Blackjack hand is already active." });
            }
            const deck = buildBlackjackDeck();
            const playerHand = [deck.pop()!, deck.pop()!];
            const dealerHand = [deck.pop()!, deck.pop()!];
            const bjState = {
                baseBet: bet,
                totalBet: bet,
                deck,
                playerHand,
                dealerHand,
                splitHands: [] as { rank: string; suit: string }[][],
                activeHand: 0,
                isDoubleDown: false
            };

            advanceServerQuests(meta, 'bj_play', 1);
            advanceServerQuests(meta, 'bets_placed', 1);

            const pScore = calcBjScore(playerHand);
            const dScore = calcBjScore(dealerHand);
            if (pScore === 21) {
                isGameOutcomeResolved = true;
                effectiveBet = bet;
                if (dScore === 21) {
                    winAmount = bet;
                    resultData = { bjStatus: 'finished', bjResults: ['push'], playerHand, splitHands: [], dealerHand, pScore, dScore, isNatural: false };
                } else {
                    winAmount = (bet * 5n) / 2n;
                    unlockTitleServer('card_shark');
                    resultData = { bjStatus: 'finished', bjResults: ['blackjack'], playerHand, splitHands: [], dealerHand, pScore, dScore, isNatural: true };
                }
            } else {
                activeBlackjackGames.set(userId, bjState);
                winAmount = 0n;
                isGameOutcomeResolved = false;
                resultData = {
                    bjStatus: 'playing',
                    playerHand,
                    splitHands: [],
                    activeHand: 0,
                    dealerVisible: [dealerHand[0]],
                    dealerHiddenCount: 1,
                    pScore
                };
            }
        } else if (gameMode === 'blackjack_hit' || gameMode === 'blackjack_stand' || gameMode === 'blackjack_double' || gameMode === 'blackjack_split') {
            const bj = activeBlackjackGames.get(userId);
            if (!bj) return res.status(400).json({ error: "No active Blackjack game." });

            const finalizeDealerAndScore = () => {
                while (calcBjScore(bj.dealerHand) < 17 && bj.deck.length > 0) {
                    bj.dealerHand.push(bj.deck.pop()!);
                }
                const dScore = calcBjScore(bj.dealerHand);
                const hands = bj.splitHands.length > 0 ? bj.splitHands : [bj.playerHand];
                const perHandBet = bj.totalBet / BigInt(hands.length);
                const bjResults: string[] = [];
                let totalOut = 0n;
                for (const h of hands) {
                    const pS = calcBjScore(h);
                    if (pS > 21) {
                        bjResults.push('bust');
                    } else if (dScore > 21) {
                        bjResults.push('dealerBust');
                        totalOut += activeGadgets[4] ? (perHandBet * 5n) / 2n : perHandBet * 2n;
                    } else if (dScore > pS) {
                        bjResults.push('lose');
                    } else if (dScore < pS) {
                        bjResults.push('win');
                        totalOut += perHandBet * 2n;
                    } else {
                        bjResults.push('push');
                        totalOut += perHandBet;
                    }
                }
                activeBlackjackGames.delete(userId);
                isGameOutcomeResolved = true;
                effectiveBet = bj.totalBet;
                winAmount = totalOut;
                resultData = {
                    bjStatus: 'finished',
                    bjResults,
                    playerHand: bj.playerHand,
                    splitHands: bj.splitHands,
                    dealerHand: bj.dealerHand,
                    dScore,
                    totalBet: bj.totalBet.toString(),
                    isDoubleDown: bj.isDoubleDown
                };
            };

            if (gameMode === 'blackjack_split') {
                if (bj.splitHands.length > 0 || bj.playerHand.length !== 2) {
                    return res.status(400).json({ error: "Cannot split right now." });
                }
                if (bj.playerHand[0].rank !== bj.playerHand[1].rank && calcBjScore([bj.playerHand[0]]) !== calcBjScore([bj.playerHand[1]])) {
                    return res.status(400).json({ error: "Cards do not match value for Split." });
                }
                if (currentBananas < bj.baseBet) {
                    return res.status(400).json({ error: "Not enough bananas to Split!" });
                }
                totalBet = bj.baseBet;
                bj.totalBet += bj.baseBet;
                bj.splitHands = [
                    [bj.playerHand[0], bj.deck.pop()!],
                    [bj.playerHand[1], bj.deck.pop()!]
                ];
                bj.playerHand = [];
                bj.activeHand = 0;

                if (calcBjScore(bj.splitHands[0]) === 21) {
                    bj.activeHand = 1;
                    if (calcBjScore(bj.splitHands[1]) === 21) {
                        finalizeDealerAndScore();
                    }
                }
                if (activeBlackjackGames.has(userId)) {
                    winAmount = 0n;
                    isGameOutcomeResolved = false;
                    resultData = {
                        bjStatus: 'playing',
                        playerHand: [],
                        splitHands: bj.splitHands,
                        activeHand: bj.activeHand,
                        dealerVisible: [bj.dealerHand[0]],
                        dealerHiddenCount: 1,
                        totalBet: bj.totalBet.toString()
                    };
                }
            } else if (gameMode === 'blackjack_double') {
                if (bj.splitHands.length > 0 || bj.playerHand.length !== 2) {
                    return res.status(400).json({ error: "Cannot Double Down right now." });
                }
                if (currentBananas < bj.baseBet) {
                    return res.status(400).json({ error: "Not enough bananas to Double Down!" });
                }
                totalBet = bj.baseBet;
                bj.totalBet += bj.baseBet;
                bj.isDoubleDown = true;
                bj.playerHand.push(bj.deck.pop()!);
                if (calcBjScore(bj.playerHand) > 21) {
                    activeBlackjackGames.delete(userId);
                    isGameOutcomeResolved = true;
                    effectiveBet = bj.totalBet;
                    winAmount = 0n;
                    resultData = {
                        bjStatus: 'finished',
                        bjResults: ['bust'],
                        playerHand: bj.playerHand,
                        splitHands: [],
                        dealerHand: bj.dealerHand,
                        dScore: calcBjScore(bj.dealerHand),
                        totalBet: bj.totalBet.toString(),
                        isDoubleDown: true
                    };
                } else {
                    finalizeDealerAndScore();
                }
            } else if (gameMode === 'blackjack_hit') {
                totalBet = 0n;
                const hand = bj.splitHands.length > 0 ? bj.splitHands[bj.activeHand] : bj.playerHand;
                hand.push(bj.deck.pop()!);
                if (calcBjScore(hand) > 21) {
                    if (bj.splitHands.length > 0) {
                        if (bj.activeHand === 0) {
                            bj.activeHand = 1;
                            winAmount = 0n;
                            isGameOutcomeResolved = false;
                            resultData = {
                                bjStatus: 'playing',
                                playerHand: bj.playerHand,
                                splitHands: bj.splitHands,
                                activeHand: bj.activeHand,
                                dealerVisible: [bj.dealerHand[0]],
                                dealerHiddenCount: 1,
                                totalBet: bj.totalBet.toString()
                            };
                        } else {
                            finalizeDealerAndScore();
                        }
                    } else {
                        activeBlackjackGames.delete(userId);
                        isGameOutcomeResolved = true;
                        effectiveBet = bj.totalBet;
                        winAmount = 0n;
                        resultData = {
                            bjStatus: 'finished',
                            bjResults: ['bust'],
                            playerHand: bj.playerHand,
                            splitHands: [],
                            dealerHand: bj.dealerHand,
                            dScore: calcBjScore(bj.dealerHand),
                            totalBet: bj.totalBet.toString()
                        };
                    }
                } else {
                    winAmount = 0n;
                    isGameOutcomeResolved = false;
                    resultData = {
                        bjStatus: 'playing',
                        playerHand: bj.playerHand,
                        splitHands: bj.splitHands,
                        activeHand: bj.activeHand,
                        dealerVisible: [bj.dealerHand[0]],
                        dealerHiddenCount: 1,
                        totalBet: bj.totalBet.toString()
                    };
                }
            } else if (gameMode === 'blackjack_stand') {
                totalBet = 0n;
                if (bj.splitHands.length > 0 && bj.activeHand === 0) {
                    bj.activeHand = 1;
                    winAmount = 0n;
                    isGameOutcomeResolved = false;
                    resultData = {
                        bjStatus: 'playing',
                        playerHand: bj.playerHand,
                        splitHands: bj.splitHands,
                        activeHand: bj.activeHand,
                        dealerVisible: [bj.dealerHand[0]],
                        dealerHiddenCount: 1,
                        totalBet: bj.totalBet.toString()
                    };
                } else {
                    finalizeDealerAndScore();
                }
            }
            resolvedGameCategory = 'blackjack';
        } else if (gameMode === 'blackjack') {
            return res.status(400).json({ error: "Direct client Blackjack settlement is disabled. Use blackjack_start." });
        } else if (gameMode === 'poker_start') {
            if (activeVideoPokerGames.has(userId)) {
                return res.status(400).json({ error: "A Video Poker hand is already active." });
            }
            const deck = buildBlackjackDeck();
            const initialHand = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
            activeVideoPokerGames.set(userId, { betAmount: bet, deck, initialHand });
            winAmount = 0n;
            isGameOutcomeResolved = false;
            resultData = { initialHand };
            advanceServerQuests(meta, 'poker_play', 1);
            advanceServerQuests(meta, 'bets_placed', 1);
        } else if (gameMode === 'poker_draw') {
            const activeVp = activeVideoPokerGames.get(userId);
            if (!activeVp) return res.status(400).json({ error: "No active Video Poker hand." });
            activeVideoPokerGames.delete(userId);

            const heldArr = Array.isArray(req.body.pokerHeld) ? req.body.pokerHeld : [];
            const finalHand = activeVp.initialHand.map((card, i) => (heldArr[i] ? card : activeVp.deck.pop()!));

            const rankValues: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
            const ranksInHand = finalHand.map(c => rankValues[c.rank]).sort((a, b) => a - b);
            const suitsInHand = finalHand.map(c => c.suit);

            const isFlush = suitsInHand.every(s => s === suitsInHand[0]);
            let isStraight = false;
            if (ranksInHand[4] - ranksInHand[0] === 4 && new Set(ranksInHand).size === 5) isStraight = true;
            if (ranksInHand[4] === 14 && ranksInHand[3] === 5 && ranksInHand[2] === 4 && ranksInHand[1] === 3 && ranksInHand[0] === 2) isStraight = true;

            const counts: Record<number, number> = {};
            for (const r of ranksInHand) counts[r] = (counts[r] || 0) + 1;
            const countVals = Object.values(counts).sort((a, b) => b - a);

            let mult = 0n;
            let handName = "";
            if (isFlush && isStraight && ranksInHand[4] === 14 && ranksInHand[0] === 10) {
                mult = 800n; handName = "ROYAL FLUSH";
            } else if (isFlush && isStraight) {
                mult = 50n; handName = "STRAIGHT FLUSH";
            } else if (countVals[0] === 4) {
                mult = 25n; handName = "FOUR OF A KIND";
            } else if (countVals[0] === 3 && countVals[1] === 2) {
                mult = 9n; handName = "FULL HOUSE";
            } else if (isFlush) {
                mult = 6n; handName = "FLUSH";
            } else if (isStraight) {
                mult = 4n; handName = "STRAIGHT";
            } else if (countVals[0] === 3) {
                mult = 3n; handName = "THREE OF A KIND";
            } else if (countVals[0] === 2 && countVals[1] === 2) {
                mult = 2n; handName = "TWO PAIR";
            } else if (countVals[0] === 2) {
                const pairRank = parseInt(Object.keys(counts).find(k => counts[Number(k)] === 2) || "0", 10);
                if (pairRank >= 11) {
                    mult = 1n; handName = "JACKS OR BETTER";
                }
            }

            effectiveBet = activeVp.betAmount;
            totalBet = 0n; // Already deducted at poker_start
            winAmount = mult > 0n ? activeVp.betAmount * mult : 0n;
            resultData = { finalHand, handName, originalBet: activeVp.betAmount.toString() };
            isGameOutcomeResolved = true;
            if (["FULL HOUSE", "FOUR OF A KIND", "STRAIGHT FLUSH", "ROYAL FLUSH"].includes(handName)) {
                unlockTitleServer('card_shark');
            }
            resolvedGameCategory = 'poker';
        } else if (gameMode === 'poker') {
            return res.status(400).json({ error: "Direct client Poker settlement is disabled. Use poker_start." });
        } else if (gameMode === 'crash_start') {
            let crashPoint = 1.0;
            if (Math.random() >= 0.05) {
                crashPoint = parseFloat((1.00 / Math.random()).toFixed(2));
            }
            if (crashPoint > 1000) crashPoint = 1000;
            activeCrashGames.set(userId, { betAmount: totalBet, crashPoint });
            winAmount = 0n;
            resultData.crashPoint = crashPoint;
            isGameOutcomeResolved = false;
            advanceServerQuests(meta, 'crash_play', 1);
            advanceServerQuests(meta, 'bets_placed', 1);
        } else if (gameMode === 'crash_cashout') {
            const activeGame = activeCrashGames.get(userId);
            if (!activeGame) return res.status(400).json({ error: "No active crash game" });
            activeCrashGames.delete(userId);
            effectiveBet = activeGame.betAmount;

            const requestedMultiplier = Number(req.body.multiplier);
            if (!Number.isFinite(requestedMultiplier) || requestedMultiplier < 1.0) {
                return res.status(400).json({ error: "Invalid cashout multiplier." });
            }
            if (requestedMultiplier <= activeGame.crashPoint) {
                winAmount = BigInt(Math.round(Number(activeGame.betAmount) * requestedMultiplier));
                resultData.winAmount = winAmount.toString();
                resultData.status = 'win';
                resultData.multiplier = requestedMultiplier;
                if (requestedMultiplier >= 10.0) unlockTitleServer('rocket_rider');
            } else {
                winAmount = 0n;
                resultData.status = 'crash';
            }
            totalBet = 0n;
            isGameOutcomeResolved = true;
        } else if (gameMode === 'crash_loss') {
            const activeGame = activeCrashGames.get(userId);
            if (!activeGame) return res.status(400).json({ error: "No active crash game" });
            activeCrashGames.delete(userId);
            effectiveBet = activeGame.betAmount;
            winAmount = 0n;
            resultData = { status: 'crash' };
            totalBet = 0n;
            isGameOutcomeResolved = true;
        } else if (gameMode === 'hilo_start') {
            const ranks = [
                { r: '2', v: 2 }, { r: '3', v: 3 }, { r: '4', v: 4 }, { r: '5', v: 5 },
                { r: '6', v: 6 }, { r: '7', v: 7 }, { r: '8', v: 8 }, { r: '9', v: 9 },
                { r: '10', v: 10 }, { r: 'J', v: 11 }, { r: 'Q', v: 12 }, { r: 'K', v: 13 }, { r: 'A', v: 14 }
            ];
            const getRankWeight = (v: number) => (v >= 6 && v <= 9) ? 100 : 0;
            const totalWeight = ranks.reduce((sum, rank) => sum + getRankWeight(rank.v), 0);
            let randomWeight = Math.floor(Math.random() * totalWeight);
            let selectedRank = ranks[0];
            for (const rank of ranks) {
                const weight = getRankWeight(rank.v);
                if (randomWeight < weight) { selectedRank = rank; break; }
                randomWeight -= weight;
            }
            const suits = ['S', 'H', 'D', 'C'];
            const cardObj = { rank: selectedRank.r, suit: suits[Math.floor(Math.random() * suits.length)], value: selectedRank.v };
            activeHiloGames.set(userId, { betAmount: totalBet, firstCard: cardObj });
            winAmount = 0n;
            resultData.firstCard = cardObj;
            isGameOutcomeResolved = false;
            advanceServerQuests(meta, 'bets_placed', 1);
        } else if (gameMode === 'hilo_guess') {
            const activeGame = activeHiloGames.get(userId);
            if (!activeGame) return res.status(400).json({ error: "No active hilo game" });
            if (guess !== 'higher' && guess !== 'lower') {
                return res.status(400).json({ error: "Invalid guess." });
            }
            activeHiloGames.delete(userId);
            effectiveBet = activeGame.betAmount;

            const ranks = [
                { r: '2', v: 2 }, { r: '3', v: 3 }, { r: '4', v: 4 }, { r: '5', v: 5 },
                { r: '6', v: 6 }, { r: '7', v: 7 }, { r: '8', v: 8 }, { r: '9', v: 9 },
                { r: '10', v: 10 }, { r: 'J', v: 11 }, { r: 'Q', v: 12 }, { r: 'K', v: 13 }, { r: 'A', v: 14 }
            ];
            const suits = ['S', 'H', 'D', 'C'];
            const picked = ranks[Math.floor(Math.random() * ranks.length)];
            const cardObj = { rank: picked.r, suit: suits[Math.floor(Math.random() * suits.length)], value: picked.v };

            let won = false;
            let push = false;
            if (cardObj.value === activeGame.firstCard.value) push = true;
            else if (guess === 'higher' && cardObj.value > activeGame.firstCard.value) won = true;
            else if (guess === 'lower' && cardObj.value < activeGame.firstCard.value) won = true;

            if (push) {
                winAmount = activeGame.betAmount;
                resultData.status = 'push';
            } else if (won) {
                winAmount = activeGame.betAmount * 2n;
                resultData.status = 'win';
            } else {
                winAmount = 0n;
                resultData.status = 'loss';
            }
            resultData.winAmount = winAmount.toString();
            resultData.secondCard = cardObj;
            resultData.originalBet = activeGame.betAmount.toString();
            totalBet = 0n;
            isGameOutcomeResolved = true;
        } else if (gameMode === 'mines_start') {
            const rawMines = Number(req.body.mineCount) || 3;
            const mineCount = Math.max(1, Math.min(24, rawMines));
            const allIndices = Array.from({ length: 25 }, (_, i) => i);
            for (let i = allIndices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
            }
            const mines = allIndices.slice(0, mineCount);
            activeMinesGames.set(userId, { betAmount: totalBet, mineCount, mines, revealed: [], currentMultiplier: 1.0 });

            const lastSonar = userSonarCooldowns.get(userId) || 0;
            const sonarCooldownLeft = Math.max(0, 60000 - (Date.now() - lastSonar));
            winAmount = 0n;
            resultData = {
                status: 'started',
                mineCount,
                totalTiles: 25,
                sonarCooldownLeft,
                sonarEligible: mineCount <= 15 && sonarCooldownLeft === 0
            };
            isGameOutcomeResolved = false;
            advanceServerQuests(meta, 'bets_placed', 1);
        } else if (gameMode === 'mines_pick') {
            const activeGame = activeMinesGames.get(userId);
            if (!activeGame) return res.status(400).json({ error: "No active mines game" });

            const tileIndex = Number(req.body.tileIndex);
            if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= 25) {
                return res.status(400).json({ error: "Invalid tile index" });
            }
            if (activeGame.revealed.includes(tileIndex)) {
                return res.status(400).json({ error: "Tile already revealed" });
            }

            const totalTiles = 25;
            const safeTiles = totalTiles - activeGame.mineCount;

            let sonarTriggered = false;
            const now = Date.now();
            const lastSonar = userSonarCooldowns.get(userId) || 0;
            if (activeGadgets[7] && activeGame.revealed.length === 0 && activeGame.mineCount <= 15 && (now - lastSonar) >= 60000 && activeGame.mines.includes(tileIndex)) {
                const safeCandidates = Array.from({ length: 25 }, (_, i) => i).filter(idx => idx !== tileIndex && !activeGame.mines.includes(idx));
                if (safeCandidates.length > 0) {
                    const newMine = safeCandidates[Math.floor(Math.random() * safeCandidates.length)];
                    activeGame.mines = activeGame.mines.map((m: number) => m === tileIndex ? newMine : m);
                    sonarTriggered = true;
                    userSonarCooldowns.set(userId, now);
                }
            }

            if (activeGame.mines.includes(tileIndex)) {
                const originalBet = activeGame.betAmount;
                activeMinesGames.delete(userId);
                effectiveBet = originalBet;
                winAmount = 0n;
                resultData = {
                    status: 'bomb',
                    hitIndex: tileIndex,
                    mines: activeGame.mines,
                    revealed: activeGame.revealed,
                    winAmount: "0",
                    sonarProtected: false,
                    sonarCooldownLeft: Math.max(0, 60000 - (Date.now() - (userSonarCooldowns.get(userId) || 0)))
                };
                totalBet = 0n;
                isGameOutcomeResolved = true;
            } else {
                activeGame.revealed.push(tileIndex);
                const k = activeGame.revealed.length;
                let prob = 1.0;
                for (let i = 0; i < k; i++) prob *= (safeTiles - i) / (totalTiles - i);
                const mult = Math.max(1.01, parseFloat((0.97 / prob).toFixed(2)));
                activeGame.currentMultiplier = mult;

                let nextMult = mult;
                if (k < safeTiles) {
                    let nextProb = 1.0;
                    for (let i = 0; i < k + 1; i++) nextProb *= (safeTiles - i) / (totalTiles - i);
                    nextMult = Math.max(1.02, parseFloat((0.97 / nextProb).toFixed(2)));
                }

                const isCleared = activeGame.revealed.length >= safeTiles;
                const cooldownLeft = sonarTriggered ? 60000 : Math.max(0, 60000 - (Date.now() - (userSonarCooldowns.get(userId) || 0)));
                if (isCleared) {
                    const originalBet = activeGame.betAmount;
                    effectiveBet = originalBet;
                    winAmount = BigInt(Math.round(Number(originalBet) * mult));
                    activeMinesGames.delete(userId);
                    if (k >= 5) unlockTitleServer('mine_sweeper');
                    resultData = {
                        status: 'cleared',
                        tileIndex,
                        mines: activeGame.mines,
                        revealed: activeGame.revealed,
                        currentMultiplier: mult,
                        winAmount: winAmount.toString(),
                        sonarProtected: sonarTriggered,
                        sonarCooldownLeft: cooldownLeft
                    };
                    totalBet = 0n;
                    isGameOutcomeResolved = true;
                } else {
                    winAmount = 0n;
                    resultData = {
                        status: 'safe',
                        tileIndex,
                        revealedCount: k,
                        currentMultiplier: mult,
                        nextMultiplier: nextMult,
                        potentialWin: (BigInt(Math.round(Number(activeGame.betAmount) * mult))).toString(),
                        sonarProtected: sonarTriggered,
                        sonarCooldownLeft: cooldownLeft
                    };
                    totalBet = 0n;
                    isGameOutcomeResolved = false;
                }
            }
        } else if (gameMode === 'mines_cashout') {
            const activeGame = activeMinesGames.get(userId);
            if (!activeGame) return res.status(400).json({ error: "No active mines game" });
            if (activeGame.revealed.length === 0) return res.status(400).json({ error: "Cannot cashout without uncovering a tile" });

            const originalBet = activeGame.betAmount;
            activeMinesGames.delete(userId);
            effectiveBet = originalBet;
            winAmount = BigInt(Math.round(Number(originalBet) * activeGame.currentMultiplier));
            if (activeGame.revealed.length >= 5) unlockTitleServer('mine_sweeper');
            resultData = {
                status: 'cashout',
                mines: activeGame.mines,
                revealed: activeGame.revealed,
                finalMultiplier: activeGame.currentMultiplier,
                winAmount: winAmount.toString(),
                originalBet: originalBet.toString()
            };
            totalBet = 0n;
            isGameOutcomeResolved = true;
        } else if (gameMode === 'plinko') {
            const rawRows = Number(req.body.rows) || 12;
            const rows = [8, 10, 12, 14, 16].includes(rawRows) ? rawRows : 12;
            const rawRisk = String(req.body.risk || 'medium').toLowerCase();
            const risk = ['low', 'medium', 'high', 'gorilla'].includes(rawRisk) ? rawRisk : 'medium';
            const count = ballCount;

            const table = PLINKO_PAYOUTS[rows]?.[risk] || PLINKO_PAYOUTS[12]['medium'];
            const drops: any[] = [];
            let totalPlinkoWin = 0n;
            let maxMult = 0;

            for (let b = 0; b < count; b++) {
                const path: number[] = [];
                let slotIndex = 0;
                for (let r = 0; r < rows; r++) {
                    const step = Math.random() < 0.5 ? 0 : 1;
                    path.push(step);
                    if (step === 1) slotIndex++;
                }
                let mult = table[slotIndex] ?? 1.0;
                if (activeGadgets[8] && mult < 0.6) {
                    mult = Number((mult + 0.2).toFixed(2));
                }
                if (mult > maxMult) maxMult = mult;
                const ballWin = BigInt(Math.round(Number(bet) * mult));
                totalPlinkoWin += ballWin;
                drops.push({
                    path,
                    slotIndex,
                    multiplier: mult,
                    cushioned: activeGadgets[8] && (table[slotIndex] < 0.6),
                    winAmount: ballWin.toString()
                });
            }

            if (maxMult >= 100) unlockTitleServer('plinko_master');
            advanceServerQuests(meta, 'plinko_drop', count);
            advanceServerQuests(meta, 'bets_placed', 1);
            if (maxMult > 0) advanceServerQuests(meta, 'plinko_mult', 1, { mult: maxMult });

            winAmount = totalPlinkoWin;
            resultData = {
                drops,
                rows,
                risk,
                ballCount: count,
                multipliers: table,
                winAmount: winAmount.toString()
            };
        } else if (gameMode === 'horseracing') {
            const selectedHorse = Math.max(0, Math.min(9, Math.floor(Number(req.body.selectedHorse) || 0)));
            const chances = activeHorseOdds.get(userId) || generateFairHorseOdds();
            activeHorseOdds.set(userId, generateFairHorseOdds()); // Rotate odds for next race

            const available = chances.map((w, idx) => ({ idx, weight: w }));
            const finishOrder: number[] = [];
            while (available.length > 0) {
                const curTotal = available.reduce((sum, item) => sum + item.weight, 0);
                let rnd = Math.random() * curTotal;
                let pickedIndex = 0;
                for (let i = 0; i < available.length; i++) {
                    if (rnd < available[i].weight) { pickedIndex = i; break; }
                    rnd -= available[i].weight;
                }
                finishOrder.push(available[pickedIndex].idx);
                available.splice(pickedIndex, 1);
            }

            const winner = finishOrder[0];
            const second = finishOrder[1];
            const third = finishOrder[2];
            const placement = finishOrder.indexOf(selectedHorse) + 1;
            let mult = 0.0;
            if (placement === 1) { mult = 3.0; unlockTitleServer('derby_jockey'); }
            else if (placement === 2) mult = 2.0;
            else if (placement === 3) mult = 1.5;

            winAmount = BigInt(Math.floor(Number(bet) * mult));
            advanceServerQuests(meta, 'bets_placed', 1);
            resultData = {
                finishOrder,
                winner,
                second,
                third,
                selectedHorse,
                placement,
                multiplier: mult,
                winAmount: winAmount.toString(),
                nextOdds: activeHorseOdds.get(userId)
            };
        } else if (gameMode === 'cases') {
            if (!caseType || !(caseType in CASE_COSTS)) {
                return res.status(400).json({ error: "Invalid case type" });
            }
            const cost = CASE_COSTS[caseType];
            if (currentBananas < cost) return res.status(400).json({ error: "Not enough bananas" });
            const r = Math.random() * 100;
            let rarity = 'Common';

            if (caseType === 'void') {
                if (r < 4.5) rarity = 'Ominous';
                else if (r < 45.0) rarity = 'Legendary';
                else if (r < 85.0) rarity = 'Mythic';
                else rarity = 'Epic';
            } else if (caseType === 'abyssal') {
                if (r < 1.5) rarity = 'Ominous';
                else if (r < 30.0) rarity = 'Legendary';
                else if (r < 70.0) rarity = 'Mythic';
                else rarity = 'Epic';
            } else if (caseType === 'cosmic') {
                if (r < 0.5) rarity = 'Ominous';
                else if (r < 15.0) rarity = 'Legendary';
                else if (r < 50.0) rarity = 'Mythic';
                else if (r < 85.0) rarity = 'Epic';
                else rarity = 'Rare';
            } else if (caseType === 'toverland') {
                if (r < 0.05) rarity = 'Ominous';
                else if (r < 6.0) rarity = 'Legendary';
                else if (r < 24.0) rarity = 'Mythic';
                else if (r < 60.0) rarity = 'Epic';
                else if (r < 90.0) rarity = 'Rare';
                else rarity = 'Common';
            } else if (caseType === 'jungle') {
                if (r < 2.5) rarity = 'Legendary';
                else if (r < 12.5) rarity = 'Mythic';
                else if (r < 37.5) rarity = 'Epic';
                else if (r < 77.5) rarity = 'Rare';
                else rarity = 'Common';
            } else if (caseType === 'booster') {
                if (r < 1.0) rarity = 'Legendary';
                else if (r < 5.0) rarity = 'Mythic';
                else if (r < 20.0) rarity = 'Epic';
                else if (r < 60.0) rarity = 'Rare';
                else rarity = 'Common';
            } else {
                if (r < 0.1) rarity = 'Legendary';
                else if (r < 1.0) rarity = 'Mythic';
                else if (r < 6.0) rarity = 'Epic';
                else if (r < 30.0) rarity = 'Rare';
                else rarity = 'Common';
            }

            const skinPool = SKINS.filter(s => s.rarity === rarity);
            const selectedSkin = skinPool[Math.floor(Math.random() * skinPool.length)] || SKINS[0];
            winAmount = 0n;
            currentBananas -= cost;
            newInventory[selectedSkin.id] = (Number(newInventory[selectedSkin.id]) || 0) + 1;
            advanceServerQuests(meta, 'case_open', 1, { highestRarity: rarity });
            resultData.skin = selectedSkin;
            resultData.rarity = rarity;
            resultData.cost = String(cost);
        } else {
            return res.status(400).json({ error: "Unsupported game mode." });
        }

        // --- MEGA BET GADGET (GLOBAL) ---
        const isPushOutcome =
            resultData.status === 'push' ||
            (Array.isArray(resultData.bjResults) && resultData.bjResults.length === 1 && resultData.bjResults[0] === 'push');

        if (gameMode !== 'cases' && isGameOutcomeResolved && winAmount > 0n && !isPushOutcome && activeGadgets[5]) {
            const r = Math.random();
            if (r < 0.05) {
                winAmount = winAmount * 10n;
                megaBetOutcome = 'win';
            } else if (r < 0.30) {
                winAmount = 0n;
                megaBetOutcome = 'taxes';
            } else {
                megaBetOutcome = 'none';
            }
        }
        resultData.megaBet = megaBetOutcome;

        // Server-side tax penalty check (never from req.body)
        const serverTaxPenaltyActive = Number(meta.boosts?.tax_penalty || 0) > Date.now();

        let isWin = false;
        let isPush = false;
        let levelsGained = 0;

        if (gameMode !== 'cases' && isGameOutcomeResolved) {
            isWin = winAmount > effectiveBet;
            isPush = (winAmount === effectiveBet && effectiveBet > 0n);

            // Failsafe Gadget (Index 0)
            if (!isWin && !isPush && effectiveBet >= 100n && activeGadgets[0]) {
                if (Math.random() < 0.25) {
                    winAmount = effectiveBet;
                    isPush = true;
                    resultData.failsafeActivated = true;
                }
            }

            // Banana Streak Gadget (Index 3)
            if (activeGadgets[3] && winStreak >= 1 && isWin) {
                winAmount = winAmount * 2n;
                resultData.streakMultiplierApplied = true;
            }

            // Apply Tax Penalty on profit if active on server
            if (serverTaxPenaltyActive && winAmount > effectiveBet) {
                const profit = winAmount - effectiveBet;
                winAmount = effectiveBet + (profit / 2n);
            }

            if (isWin) {
                winStreak++;
                if (winStreak >= 5) unlockTitleServer('hot_streak');
                if (winStreak >= 10) unlockTitleServer('unstoppable');
                if (winAmount >= 1000000n) unlockTitleServer('big_winner');
                if (winAmount === 777n || effectiveBet === 777n) unlockTitleServer('lucky_seven');

                // Server-authoritative XP Award (only on actual win)
                const isBoosted = Number(meta.boosts?.xp || 0) > Date.now();
                const boostMultiplier = isBoosted ? 2 : 1;
                const baseLevelXp = 50 + (userLevel * 20) + (userLevel >= 25 ? (userLevel - 25) * 10 : 0) + (userLevel >= 50 ? (userLevel - 50) * 10 : 0);
                const xpBasis = Math.min(1e15, Number(winAmount > 0n ? winAmount : effectiveBet));
                const betBonus = xpBasis > 0 ? Math.floor(Math.min(userLevel * 35 + 500, Math.sqrt(xpBasis) * 2)) : 0;
                const winBonus = Math.floor(baseLevelXp * 0.5);
                const totalXpGain = Math.floor((baseLevelXp + betBonus + winBonus) * boostMultiplier);

                userXp += totalXpGain;
                while (userXp >= getXpForLevelServer(userLevel)) {
                    userXp -= getXpForLevelServer(userLevel);
                    userLevel++;
                    levelsGained++;
                }

                // Quest completion updates
                advanceServerQuests(meta, 'win_amount', Number(winAmount > 1000000000n ? 1000000000n : winAmount));
                advanceServerQuests(meta, 'win_streak', winStreak, { streak: winStreak });
                if (resolvedGameCategory === 'roulette') {
                    advanceServerQuests(meta, 'roulette_win', 1, { isGreen: resultData.winningColor === 'green' });
                } else if (resolvedGameCategory === 'slots') {
                    advanceServerQuests(meta, 'slots_win', 1, { isTriple: resultData.winType === 'triple', isJackpot: resultData.winType === 'jackpot' });
                } else if (resolvedGameCategory === 'blackjack') {
                    advanceServerQuests(meta, 'bj_win', 1, { isNatural: Boolean(resultData.isNatural), isDouble: Boolean(resultData.isDoubleDown) });
                } else if (resolvedGameCategory === 'poker') {
                    advanceServerQuests(meta, 'poker_win', 1, { rank: resultData.handName });
                } else if (resolvedGameCategory === 'crash_cashout') {
                    advanceServerQuests(meta, 'crash_cashout', 1, { mult: resultData.multiplier });
                } else if (resolvedGameCategory === 'hilo_guess') {
                    advanceServerQuests(meta, 'hilo_correct', 1);
                } else if (resolvedGameCategory === 'mines_cashout' || resolvedGameCategory === 'mines_pick') {
                    advanceServerQuests(meta, 'mines_cashout', 1, { gems: Array.isArray(resultData.revealed) ? resultData.revealed.length : 0 });
                }
            } else if (!isPush) {
                winStreak = 0;
                if (effectiveBet >= 100000n) unlockTitleServer('unlucky');
                if (effectiveBet === 777n) unlockTitleServer('lucky_seven');
                // Track loss for Insurance gadget (Speed reload)
                const lossAmt = effectiveBet > winAmount ? (effectiveBet - winAmount) : effectiveBet;
                if (lossAmt > 0n) {
                    lastLossForInsurance.set(userId, { amount: lossAmt, at: Date.now() });
                }
            }

            // Title milestones for bet size & roulette green all-in Vladimir quest
            if (effectiveBet > 0n) unlockTitleServer('newbie_monkey');
            if (effectiveBet >= 500000n) unlockTitleServer('high_roller');
            if (vladimirStatus === 1 && gameMode === 'roulette' && betColor === 'green' && !activeGadgets.some(Boolean) && balanceBeforePlay > 0n && bet >= balanceBeforePlay) {
                vladimirStatus = 2;
                resultData.vladimirCompleted = true;
            }
        } else if (!isGameOutcomeResolved && totalBet > 0n) {
            unlockTitleServer('newbie_monkey');
            if (totalBet >= 500000n) unlockTitleServer('high_roller');
        }

        resultData.winAmount = winAmount.toString();
        resultData.winStreak = winStreak;

        const newBananas = gameMode === 'cases' ? currentBananas : (currentBananas - totalBet + winAmount);

        if (newBananas >= 1000000n) unlockTitleServer('banana_millionaire');
        if (newBananas >= 100000000n) unlockTitleServer('banana_baron');
        if (newBananas >= 1000000000n) unlockTitleServer('banana_billionaire');
        if (userLevel >= 10) unlockTitleServer('apprentice_monkey');
        if (userLevel >= 25) unlockTitleServer('the_dedicated');
        if (userLevel >= 50) unlockTitleServer('veteran');
        if (userLevel >= 75) unlockTitleServer('grand_casino_monarch');
        if (userLevel >= 100) unlockTitleServer('the_myth_the_legend');

        const updatePayload: any = {
            score: String(newBananas),
            win_streak: winStreak,
            level: userLevel,
            xp: userXp,
            vladimir_quest_status: vladimirStatus,
            unlocked_titles: JSON.stringify(unlockedTitles),
            inventory: JSON.stringify(newInventory),
            updated_at: new Date().toISOString()
        };

        // Royal Banana Pass Progress
        let earnedRoyalXP = 0;
        if (gameMode !== 'cases' && isGameOutcomeResolved) {
            const isEligibleBet = currentBananas > 0n && effectiveBet >= currentBananas / 20n;
            if (winAmount > effectiveBet && isEligibleBet) {
                updatePayload.royal_xp = (user.royal_xp || 0) + 1;
                updatePayload.wins_since_royal_xp = 0;
                earnedRoyalXP = 1;
            }
        }

        const { error: updateError } = await supabase.from('database').update(updatePayload).eq('id', userId);
        if (updateError) throw updateError;

        res.json({
            success: true,
            winAmount: String(winAmount),
            newBalance: String(newBananas),
            winStreak,
            level: userLevel,
            xp: userXp,
            levelsGained,
            unlockedTitles,
            vladimirQuestStatus: vladimirStatus,
            inventory: newInventory,
            meta,
            result: resultData,
            royalXP: updatePayload.royal_xp ?? user.royal_xp ?? 0,
            earnedRoyalXP
        });

    } catch (error: any) {
        console.error("Play error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Current User Data (accrues elapsed Banana Box server-side)
app.get("/api/me", authenticateToken, async (req: any, res) => {
  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('database')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ error: "User not found" });

    const rawInv = parseJsonSafe(user.inventory, {});
    const { inv: syncedInv, meta } = ensureUserMeta(rawInv);
    const treesArr = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    const { newBox, gained } = accrueTreeBoxFromElapsed(treesArr, parseNonNegativeBigInt(user.banana_box) ?? 0n, meta);

    await supabase.from('database').update({
      banana_box: String(newBox),
      inventory: JSON.stringify(syncedInv)
    }).eq('id', user.id);

    const { password: _, ...userData } = user;
    let userTheme = 0;
    let unlockedThemes = [0];
    if (syncedInv._theme !== undefined) userTheme = Number(syncedInv._theme);
    if (Array.isArray(syncedInv._unlocked_themes)) unlockedThemes = syncedInv._unlocked_themes;
    if (user.theme !== undefined && user.theme !== null) userTheme = Number(user.theme);
    if (user.unlocked_themes) {
      const dbThemes = parseJsonSafe(user.unlocked_themes, null);
      if (Array.isArray(dbThemes)) unlockedThemes = dbThemes;
    }

    userData.banana_box = String(newBox);
    userData.inventory = syncedInv;
    userData.theme = userTheme;
    userData.unlocked_themes = unlockedThemes;
    userData.meta = meta;
    userData.accruedBoxGain = String(gained);
    res.json(userData);
  } catch (error: any) {
    console.error("/api/me API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- AUTHORITATIVE ECONOMY & PROGRESSION ROUTES ---

app.get("/api/horseracing/odds", authenticateToken, (req: any, res) => {
  const userId = req.user.userId;
  let odds = activeHorseOdds.get(userId);
  if (!odds) {
    odds = generateFairHorseOdds();
    activeHorseOdds.set(userId, odds);
  }
  res.json({ success: true, odds });
});

function hasActiveBetSession(userId: string): boolean {
  return activeBlackjackGames.has(userId) ||
    activeMinesGames.has(userId) ||
    activeCrashGames.has(userId) ||
    activeHiloGames.has(userId) ||
    activeVideoPokerGames.has(userId);
}

app.post("/api/tree/claim", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  if (hasActiveBetSession(userId)) {
    return res.status(400).json({ error: "Cannot claim bananas while a bet is active!" });
  }
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const treesArr = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const { newBox } = accrueTreeBoxFromElapsed(treesArr, parseNonNegativeBigInt(user.banana_box) ?? 0n, meta);

    if (newBox <= 0n) {
      return res.json({ success: true, claimedAmount: "0", newBalance: String(user.score || 0), bananaBox: "0", meta });
    }

    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + newBox;
    advanceServerQuests(meta, 'banana_box_claim', 1);

    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    if (newScore >= 1000000n && !unlockedTitles.includes('banana_millionaire')) unlockedTitles.push('banana_millionaire');
    if (newScore >= 100000000n && !unlockedTitles.includes('banana_baron')) unlockedTitles.push('banana_baron');
    if (newScore >= 1000000000n && !unlockedTitles.includes('banana_billionaire')) unlockedTitles.push('banana_billionaire');

    await supabase.from('database').update({
      score: String(newScore),
      banana_box: "0",
      inventory: JSON.stringify(inv),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', userId);

    res.json({ success: true, claimedAmount: String(newBox), newBalance: String(newScore), bananaBox: "0", unlockedTitles, meta });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tree/buy", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= 20) return res.status(400).json({ error: "Invalid tree slot" });
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Cannot buy trees during an active bet!" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const treesArr: number[] = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    while (treesArr.length < 20) treesArr.push(0);
    if (treesArr[idx] > 0) return res.status(400).json({ error: "Plot already has a tree." });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const { newBox } = accrueTreeBoxFromElapsed(treesArr, parseNonNegativeBigInt(user.banana_box) ?? 0n, meta);

    const hasDiscount = Number(meta.boosts?.discount || 0) > Date.now();
    const cost = BigInt(hasDiscount ? Math.floor(TREE_DATA[1].cost * 0.75) : TREE_DATA[1].cost);
    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;
    if (currentScore < cost) return res.status(400).json({ error: "Not enough bananas!" });

    const newScore = currentScore - cost;
    treesArr[idx] = 1;
    advanceServerQuests(meta, 'tree_buy_upgrade', 1);

    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    const addT = (t: string) => { if (!unlockedTitles.includes(t)) unlockedTitles.push(t); };
    addT('investor');
    addT('grove');
    const totalLvl = treesArr.reduce((a, b) => a + (Number(b) || 0), 0);
    if (totalLvl >= 10) addT('tree_planter');
    if (totalLvl >= 50) addT('tree_lord');
    if (totalLvl >= 100) addT('tree_god');

    await supabase.from('database').update({
      score: String(newScore),
      banana_box: String(newBox),
      trees: JSON.stringify(treesArr),
      inventory: JSON.stringify(inv),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', userId);

    res.json({ success: true, newBalance: String(newScore), bananaBox: String(newBox), trees: treesArr, unlockedTitles, meta });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tree/upgrade", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= 20) return res.status(400).json({ error: "Invalid tree slot" });
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Cannot upgrade trees during an active bet!" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const treesArr: number[] = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    while (treesArr.length < 20) treesArr.push(0);
    const curLvl = Number(treesArr[idx] || 0);
    const nextLvl = curLvl + 1;
    if (curLvl <= 0 || nextLvl > 10 || !TREE_DATA[nextLvl]) {
      return res.status(400).json({ error: "Tree is already at max level or not planted." });
    }
    if (TREE_DATA[nextLvl].reqAllTrees && !treesArr.every(t => Number(t) > 0)) {
      return res.status(400).json({ error: "Unlock all 20 tree plots first!" });
    }

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const { newBox } = accrueTreeBoxFromElapsed(treesArr, parseNonNegativeBigInt(user.banana_box) ?? 0n, meta);

    const hasDiscount = Number(meta.boosts?.discount || 0) > Date.now();
    const cost = BigInt(hasDiscount ? Math.floor(TREE_DATA[nextLvl].cost * 0.75) : TREE_DATA[nextLvl].cost);
    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;
    if (currentScore < cost) return res.status(400).json({ error: "Not enough bananas!" });

    const newScore = currentScore - cost;
    treesArr[idx] = nextLvl;
    advanceServerQuests(meta, 'tree_buy_upgrade', 1);

    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    const addT = (t: string) => { if (!unlockedTitles.includes(t)) unlockedTitles.push(t); };
    const totalLvl = treesArr.reduce((a, b) => a + (Number(b) || 0), 0);
    if (totalLvl >= 10) addT('tree_planter');
    if (totalLvl >= 50) addT('tree_lord');
    if (totalLvl >= 100) addT('tree_god');

    await supabase.from('database').update({
      score: String(newScore),
      banana_box: String(newBox),
      trees: JSON.stringify(treesArr),
      inventory: JSON.stringify(inv),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', userId);

    res.json({ success: true, newBalance: String(newScore), bananaBox: String(newBox), trees: treesArr, unlockedTitles, meta });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tree/sell", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 1 || idx >= 20) {
    return res.status(400).json({ error: "Cannot sell the starter tree plot 0!" });
  }
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Cannot sell trees during an active bet!" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const treesArr: number[] = parseJsonSafe(user.trees, [1, ...Array(19).fill(0)]);
    const curLvl = Number(treesArr[idx] || 0);
    if (curLvl <= 0) return res.status(400).json({ error: "No tree in this plot." });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const { newBox } = accrueTreeBoxFromElapsed(treesArr, parseNonNegativeBigInt(user.banana_box) ?? 0n, meta);

    let totalCost = 0;
    for (let l = 1; l <= curLvl; l++) totalCost += TREE_DATA[l]?.cost || 0;
    const refund = BigInt(Math.floor(totalCost * 0.25));
    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + refund;
    treesArr[idx] = 0;

    await supabase.from('database').update({
      score: String(newScore),
      banana_box: String(newBox),
      trees: JSON.stringify(treesArr),
      inventory: JSON.stringify(inv)
    }).eq('id', userId);

    res.json({ success: true, refund: String(refund), newBalance: String(newScore), bananaBox: String(newBox), trees: treesArr, meta });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/gadget/buy", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= GADGET_DATA.length || GADGET_DATA[idx].locked) {
    return res.status(400).json({ error: "Invalid or locked gadget." });
  }
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Cannot buy gadgets during an active bet!" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const unlocked: boolean[] = parseJsonSafe(user.gadgets, Array(10).fill(false));
    const active: boolean[] = parseJsonSafe(user.active_gadgets, Array(10).fill(false));
    if (unlocked[idx]) return res.status(400).json({ error: "Gadget already unlocked." });

    const cost = BigInt(GADGET_DATA[idx].cost);
    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;
    if (currentScore < cost) return res.status(400).json({ error: "Not enough bananas!" });

    const newScore = currentScore - cost;
    unlocked[idx] = true;
    const activeCount = active.filter(Boolean).length;
    if (activeCount < 2) active[idx] = true;

    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    const unlockedCount = unlocked.filter((g, i) => g && !GADGET_DATA[i]?.locked).length;
    if (unlockedCount >= 9 && !unlockedTitles.includes('extra_hand')) {
      unlockedTitles.push('extra_hand');
    }

    await supabase.from('database').update({
      score: String(newScore),
      gadgets: JSON.stringify(unlocked),
      active_gadgets: JSON.stringify(active),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', userId);

    res.json({ success: true, newBalance: String(newScore), gadgets: unlocked, active_gadgets: active, unlockedTitles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/gadget/toggle", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= GADGET_DATA.length || GADGET_DATA[idx].locked) {
    return res.status(400).json({ error: "Invalid gadget." });
  }
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Cannot toggle gadgets mid-round!" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('gadgets, active_gadgets').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const unlocked: boolean[] = parseJsonSafe(user.gadgets, Array(10).fill(false));
    const active: boolean[] = parseJsonSafe(user.active_gadgets, Array(10).fill(false));
    if (!unlocked[idx]) return res.status(400).json({ error: "You don't own this gadget." });

    if (active[idx]) {
      active[idx] = false;
    } else {
      if (active.filter(Boolean).length >= 2) {
        return res.status(400).json({ error: "You can only activate up to 2 gadgets at once." });
      }
      active[idx] = true;
    }

    await supabase.from('database').update({ active_gadgets: JSON.stringify(active) }).eq('id', userId);
    res.json({ success: true, active_gadgets: active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/shop/status", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory, coins').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    await supabase.from('database').update({ inventory: JSON.stringify(inv) }).eq('id', userId);
    res.json({ success: true, shop: meta.shop, boosts: meta.boosts, coins: Number(user.coins || 0) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/shop/buy", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= SERVER_SHOP_ITEMS.length) {
    return res.status(400).json({ error: "Invalid shop item." });
  }
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory, coins').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const item = SERVER_SHOP_ITEMS[idx];
    if (!meta.shop.stock[idx] || meta.shop.purchased[idx]) {
      return res.status(400).json({ error: "Item is out of stock or already purchased." });
    }
    const currentCoins = Number(user.coins || 0);
    if (currentCoins < item.cost) {
      return res.status(400).json({ error: "Not enough coins!" });
    }

    const newCoins = currentCoins - item.cost;
    meta.shop.purchased[idx] = true;
    const now = Date.now();
    if (item.id === 'banana_cloak') {
      meta.boosts.banana_cloak = now + item.duration;
    } else if (item.prop) {
      meta.boosts[item.prop] = now + item.duration;
    }

    await supabase.from('database').update({
      coins: newCoins,
      inventory: JSON.stringify(inv)
    }).eq('id', userId);

    res.json({ success: true, coins: newCoins, shop: meta.shop, boosts: meta.boosts, item });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/shop/exchange", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const amount = Math.floor(Number(req.body.amount) || 0);
  if (amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Invalid coin exchange amount." });
  }
  if (hasActiveBetSession(userId)) return res.status(400).json({ error: "Finish active bet before exchanging." });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, coins, inventory').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const hasMerchant = Number(meta.boosts?.merchant || 0) > Date.now();
    const costPerCoin = hasMerchant ? 80000n : 100000n;
    const totalCost = BigInt(amount) * costPerCoin;
    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;

    if (currentScore < totalCost) {
      return res.status(400).json({ error: `Not enough bananas! Need ${totalCost.toString()} 🍌.` });
    }

    const newScore = currentScore - totalCost;
    const newCoins = Number(user.coins || 0) + amount;
    await supabase.from('database').update({
      score: String(newScore),
      coins: newCoins
    }).eq('id', userId);

    res.json({ success: true, newBalance: String(newScore), coins: newCoins });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/quests/status", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    await supabase.from('database').update({ inventory: JSON.stringify(inv) }).eq('id', userId);
    res.json({ success: true, quests: meta.quests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quests/claim", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const idx = Number(req.body.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= 5) return res.status(400).json({ error: "Invalid quest index." });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    const q = meta.quests.active[idx];
    if (!q || !q.completed || q.claimed) {
      return res.status(400).json({ error: "Quest not completed or already claimed." });
    }

    q.claimed = true;
    const newLevel = Math.max(1, Number(user.level || 1)) + Number(q.reward || 2);
    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    const addT = (t: string) => { if (!unlockedTitles.includes(t)) unlockedTitles.push(t); };
    if (newLevel >= 10) addT('apprentice_monkey');
    if (newLevel >= 25) addT('the_dedicated');
    if (newLevel >= 50) addT('veteran');
    if (newLevel >= 75) addT('grand_casino_monarch');
    if (newLevel >= 100) addT('the_myth_the_legend');

    await supabase.from('database').update({
      level: newLevel,
      inventory: JSON.stringify(inv),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', userId);

    res.json({ success: true, level: newLevel, reward: q.reward, quests: meta.quests, unlockedTitles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quests/reroll", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory, coins').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    if (!meta.quests.active.every((q: any) => q.completed)) {
      return res.status(400).json({ error: "Complete all 5 quests before rerolling!" });
    }
    const currentCoins = Number(user.coins || 0);
    if (currentCoins < 50) {
      return res.status(400).json({ error: "Need 50 Coins to reroll quests!" });
    }

    const newCoins = currentCoins - 50;
    meta.quests = { active: generateServerQuests(), refreshTimestamp: Date.now() + 3600000 };
    await supabase.from('database').update({
      coins: newCoins,
      inventory: JSON.stringify(inv)
    }).eq('id', userId);

    res.json({ success: true, coins: newCoins, quests: meta.quests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/insurance/claim", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, gadgets, active_gadgets').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const gadgets: boolean[] = parseJsonSafe(user.gadgets, Array(10).fill(false));
    const activeGadgets: boolean[] = parseJsonSafe(user.active_gadgets, Array(10).fill(false));
    if (!gadgets[2] || !activeGadgets[2]) {
      return res.status(400).json({ error: "Speed reload gadget must be unlocked and equipped!" });
    }

    const now = Date.now();
    const lastClaim = lastInsuranceClaimAt.get(userId) || 0;
    if (now - lastClaim < 25000) {
      return res.status(400).json({ error: "Insurance is on cooldown!" });
    }
    const lastLoss = lastLossForInsurance.get(userId);
    if (!lastLoss || now - lastLoss.at > 5000 || lastLoss.amount <= 0n) {
      return res.status(400).json({ error: "Insurance window expired!" });
    }

    const refund = lastLoss.amount / 4n;
    lastLossForInsurance.delete(userId);
    lastInsuranceClaimAt.set(userId, now);

    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + refund;
    await supabase.from('database').update({ score: String(newScore) }).eq('id', userId);

    res.json({ success: true, refund: String(refund), newBalance: String(newScore), cooldownUntil: now + 25000 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tax/pay", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;
    const tax = (currentScore * 30n) / 100n;
    const newScore = currentScore - tax;
    await supabase.from('database').update({ score: String(newScore) }).eq('id', userId);

    res.json({ success: true, taxPaid: String(tax), newBalance: String(newScore) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tax/penalty", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv, meta } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    meta.boosts.tax_penalty = Date.now() + 600000;
    await supabase.from('database').update({ inventory: JSON.stringify(inv) }).eq('id', userId);
    res.json({ success: true, boosts: meta.boosts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/theme/unlock", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const themeId = Number(req.body.themeId);
  const themeDef = SERVER_THEMES.find(t => t.id === themeId);
  if (!themeDef) return res.status(400).json({ error: "Invalid theme." });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const userLevel = Number(user.level || 1);
    if (userLevel < themeDef.levelReq) {
      return res.status(400).json({ error: `Requires Level ${themeDef.levelReq}!` });
    }

    const { inv } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    let unlockedThemes: number[] = Array.isArray(inv._unlocked_themes) ? inv._unlocked_themes.map(Number) : [0];
    if (user.unlocked_themes) {
      const parsed = parseJsonSafe(user.unlocked_themes, null);
      if (Array.isArray(parsed)) unlockedThemes = parsed.map(Number);
    }
    if (!unlockedThemes.includes(0)) unlockedThemes.unshift(0);

    if (unlockedThemes.includes(themeId)) {
      return res.json({ success: true, unlocked_themes: unlockedThemes, theme: themeId });
    }

    const currentScore = parseNonNegativeBigInt(user.score) ?? 0n;
    const currentCoins = Number(user.coins || 0);
    if (currentScore < BigInt(themeDef.costBananas) || currentCoins < themeDef.costCoins) {
      return res.status(400).json({ error: "Insufficient Bananas or Coins for this theme!" });
    }

    const newScore = currentScore - BigInt(themeDef.costBananas);
    const newCoins = currentCoins - themeDef.costCoins;
    unlockedThemes.push(themeId);
    inv._unlocked_themes = unlockedThemes;
    inv._theme = themeId;

    const { error: upErr } = await supabase.from('database').update({
      score: String(newScore),
      coins: newCoins,
      inventory: JSON.stringify(inv),
      theme: themeId,
      unlocked_themes: JSON.stringify(unlockedThemes)
    }).eq('id', userId);

    if (upErr && upErr.code === 'PGRST204') {
      await supabase.from('database').update({
        score: String(newScore),
        coins: newCoins,
        inventory: JSON.stringify(inv)
      }).eq('id', userId);
    }

    res.json({ success: true, newBalance: String(newScore), coins: newCoins, unlocked_themes: unlockedThemes, theme: themeId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/theme/equip", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const themeId = Number(req.body.themeId);
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('inventory, unlocked_themes').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const { inv } = ensureUserMeta(parseJsonSafe(user.inventory, {}));
    let unlockedThemes: number[] = Array.isArray(inv._unlocked_themes) ? inv._unlocked_themes.map(Number) : [0];
    if (user.unlocked_themes) {
      const parsed = parseJsonSafe(user.unlocked_themes, null);
      if (Array.isArray(parsed)) unlockedThemes = parsed.map(Number);
    }
    if (!unlockedThemes.includes(themeId)) {
      return res.status(403).json({ error: "You have not unlocked this theme!" });
    }

    inv._theme = themeId;
    const { error: upErr } = await supabase.from('database').update({
      inventory: JSON.stringify(inv),
      theme: themeId
    }).eq('id', userId);
    if (upErr && upErr.code === 'PGRST204') {
      await supabase.from('database').update({ inventory: JSON.stringify(inv) }).eq('id', userId);
    }
    res.json({ success: true, theme: themeId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/vladimir/talk", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, level, vladimir_quest_status').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    const curStatus = Number(user.vladimir_quest_status || 0);
    if (curStatus >= 1) {
      return res.json({ success: true, vladimir_quest_status: curStatus });
    }
    if (Number(user.level || 1) < 15 || (parseNonNegativeBigInt(user.score) ?? 0n) >= 10000000000n) {
      return res.status(400).json({ error: "Requires Level 15+ and under 10B Bananas to accept Vladimir's pact." });
    }
    await supabase.from('database').update({ vladimir_quest_status: 1 }).eq('id', userId);
    res.json({ success: true, vladimir_quest_status: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clicker/export", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, vladimir_quest_status').eq('id', userId).maybeSingle();
    if (!user) return res.status(404).json({ error: "User not found" });

    if (Number(user.vladimir_quest_status || 0) < 2) {
      return res.status(403).json({ error: "Complete Vladimir Beh's pact first!" });
    }

    const now = Date.now();
    const lastExport = lastClickerExportAt.get(userId) || 0;
    if (now - lastExport < 15000) {
      return res.status(429).json({ error: "Smoothie export cooling down (wait 15s)." });
    }
    lastClickerExportAt.set(userId, now);

    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + 1000n;
    await supabase.from('database').update({ score: String(newScore) }).eq('id', userId);
    res.json({ success: true, added: "1000", newBalance: String(newScore) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Logs
app.get("/api/logs", authenticateToken, async (req: any, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add Log
app.post("/api/logs", authenticateToken, async (req: any, res) => {
  const { action, amount, balance_after, details } = req.body;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('logs').insert({
      user_id: req.user.userId,
      action,
      amount,
      balance_after,
      details
    });

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Debug Endpoint (Sanitized - never expose password hash)
app.get("/api/debug", authenticateToken, async (req: any, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('database')
      .select('id, name, score, coins, level, xp, updated_at')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error) throw error;
    res.json({ 
        userId: req.user.userId,
        dbData: data
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// Get User Profile
app.get("/api/profile/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('database')
      .select('id, name, score, coins, level, inventory, equipped_title, unlocked_titles')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      name: user.name,
      score: user.score,
      coins: user.coins,
      level: user.level,
      equipped_title: user.equipped_title,
      unlocked_titles: user.unlocked_titles ? JSON.parse(user.unlocked_titles) : [],
      inventory: user.inventory ? JSON.parse(user.inventory) : {}
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =================================================================
// 🍌 BANANA BANK MULTI-DENOMINATION ENGINE (SUPER HIGH BALANCES)
// =================================================================

const BANK_DENOMINATIONS: { col: string; mult: bigint }[] = [
  { col: 'c_100no', mult: BigInt("100000000000000000000000000000000") }, // 10^32 (100 Nonillion)
  { col: 'c_10no',  mult: BigInt("10000000000000000000000000000000") },  // 10^31 (10 Nonillion)
  { col: 'c_1no',   mult: BigInt("1000000000000000000000000000000") },   // 10^30 (1 Nonillion)
  { col: 'c_100oc', mult: BigInt("100000000000000000000000000000") },    // 10^29 (100 Octillion)
  { col: 'c_10oc',  mult: BigInt("10000000000000000000000000000") },     // 10^28 (10 Octillion)
  { col: 'c_1oc',   mult: BigInt("1000000000000000000000000000") },      // 10^27 (1 Octillion)
  { col: 'c_100sp', mult: BigInt("100000000000000000000000000") },       // 10^26 (100 Septillion)
  { col: 'c_10sp',  mult: BigInt("10000000000000000000000000") },        // 10^25 (10 Septillion)
  { col: 'c_1sp',   mult: BigInt("1000000000000000000000000") },         // 10^24 (1 Septillion)
  { col: 'c_100sx', mult: BigInt("100000000000000000000000") },          // 10^23 (100 Sextillion)
  { col: 'c_10sx',  mult: BigInt("10000000000000000000000") },           // 10^22 (10 Sextillion)
  { col: 'c_1sx',   mult: BigInt("1000000000000000000000") },            // 10^21 (1 Sextillion)
  { col: 'c_100qi', mult: BigInt("100000000000000000000") },             // 10^20 (100 Quintillion)
  { col: 'c_10qi',  mult: BigInt("10000000000000000000") },              // 10^19 (10 Quintillion)
  { col: 'c_1qi',   mult: BigInt("1000000000000000000") },               // 10^18 (1 Quintillion)
  { col: 'c_100qa', mult: BigInt("100000000000000000") },                // 10^17 (100 Quadrillion)
  { col: 'c_10qa',  mult: BigInt("10000000000000000") },                 // 10^16 (10 Quadrillion)
  { col: 'c_1qa',   mult: BigInt("1000000000000000") },                  // 10^15 (1 Quadrillion)
  { col: 'c_100t',  mult: BigInt("100000000000000") },                   // 10^14 (100 Trillion)
  { col: 'c_10t',   mult: BigInt("10000000000000") },                    // 10^13 (10 Trillion)
  { col: 'c_1t',    mult: BigInt("1000000000000") },                     // 10^12 (1 Trillion)
  { col: 'c_100b',  mult: BigInt("100000000000") },                      // 10^11 (100 Billion)
  { col: 'c_10b',   mult: BigInt("10000000000") },                       // 10^10 (10 Billion)
  { col: 'c_1b',    mult: BigInt("1000000000") },                        // 10^9 (1 Billion)
  { col: 'c_100m',  mult: BigInt("100000000") },                         // 10^8 (100 Million)
  { col: 'c_10m',   mult: BigInt("10000000") },                          // 10^7 (10 Million)
  { col: 'c_1m',    mult: BigInt("1000000") },                           // 10^6 (1 Million)
  { col: 'c_100k',  mult: BigInt("100000") },                            // 10^5 (100 Thousand)
  { col: 'c_10k',   mult: BigInt("10000") },                             // 10^4 (10 Thousand)
  { col: 'c_1k',    mult: BigInt("1000") },                              // 10^3 (1 Thousand)
  { col: 'c_100',   mult: BigInt("100") },                               // 10^2 (1 Hundred)
  { col: 'c_10',    mult: BigInt("10") },                                // 10^1 (10)
  { col: 'c_1',     mult: BigInt("1") }                                  // 10^0 (1)
];

function calculateTotalFromBankRow(row: any): bigint {
  if (!row) return BigInt(0);
  let total = BigInt(0);
  for (const item of BANK_DENOMINATIONS) {
    const count = BigInt(row[item.col] || 0);
    if (count > 0n) {
      total += count * item.mult;
    }
  }
  return total;
}

function decomposeBigIntToBankRow(total: bigint): Record<string, any> {
  const result: Record<string, any> = {};
  let rem = total;
  for (const item of BANK_DENOMINATIONS) {
    if (rem <= 0n) {
      result[item.col] = 0;
    } else {
      const count = rem / item.mult;
      result[item.col] = Number(count);
      rem = rem % item.mult;
    }
  }
  return result;
}

// Disk & memory fallback to guarantee Banana Bank balance survives server updates & restarts
const BANK_STORAGE_FILE = path.join(__dirname, "banana_bank_store.json");

function loadBankDiskStore(): Map<string, Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  try {
    if (fs.existsSync(BANK_STORAGE_FILE)) {
      const raw = fs.readFileSync(BANK_STORAGE_FILE, "utf-8");
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          map.set(k, v as Record<string, any>);
        }
      }
      console.log(`[BANK STORAGE] Loaded ${map.size} bank profiles from persistent disk storage.`);
    }
  } catch (e: any) {
    console.warn("[BANK STORAGE] Failed to load disk bank storage:", e.message);
  }
  return map;
}

function saveBankDiskStore(store: Map<string, Record<string, any>>) {
  try {
    const obj: Record<string, any> = {};
    for (const [k, v] of store.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(BANK_STORAGE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[BANK STORAGE] Failed to save disk bank storage:", e.message);
  }
}

const memoryBankStore = loadBankDiskStore();

// Hydrate Banana Bank from database on startup to survive container updates & restarts
async function hydrateMemoryBankStore() {
  try {
    const supabase = getSupabase();
    console.log("[BANK HYDRATION] Pre-loading all persistent Banana Bank records from database...");

    // 1. Try loading from banana_bank table
    try {
      const { data: bankRows, error: bankErr } = await supabase
        .from('banana_bank')
        .select('*');
      if (!bankErr && Array.isArray(bankRows)) {
        for (const row of bankRows) {
          if (row.user_id) {
            const total = calculateTotalFromBankRow(row);
            if (total > 0n) {
              const decomposed = decomposeBigIntToBankRow(total);
              memoryBankStore.set(row.user_id, decomposed);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[BANK HYDRATION] banana_bank table check:", e.message);
    }

    // 2. Load from database table's inventory column (_bank property)
    try {
      const { data: userRows, error: userErr } = await supabase
        .from('database')
        .select('id, inventory')
        .not('inventory', 'is', null);
      if (!userErr && Array.isArray(userRows)) {
        for (const u of userRows) {
          if (u.id && u.inventory) {
            try {
              const inv = typeof u.inventory === 'string' ? JSON.parse(u.inventory) : u.inventory;
              if (inv && inv._bank && typeof inv._bank === 'object') {
                const total = calculateTotalFromBankRow(inv._bank);
                const currentMem = memoryBankStore.get(u.id);
                const currentMemTotal = currentMem ? calculateTotalFromBankRow(currentMem) : 0n;
                if (total > currentMemTotal) {
                  const decomposed = decomposeBigIntToBankRow(total);
                  memoryBankStore.set(u.id, decomposed);
                }
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      console.warn("[BANK HYDRATION] database inventory check:", e.message);
    }

    saveBankDiskStore(memoryBankStore);
    console.log(`[BANK HYDRATION] Successfully hydrated ${memoryBankStore.size} active user bank profiles into memory & disk cache.`);
  } catch (err: any) {
    console.warn("[BANK HYDRATION NOTE]", err.message);
  }
}

hydrateMemoryBankStore().catch(() => {});

// Get Leaderboard (Combining in-game balance + Banana Bank balance!)
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { userId } = req.query;
    const supabase = getSupabase();
    
    // 1. Fetch top active users from 'database' table
    const { data: users, error: usersError } = await supabase
      .from('database')
      .select('id, name, score, level, coins, equipped_title, updated_at')
      .or('banned.eq.false,banned.is.null')
      .order('score', { ascending: false })
      .limit(100);

    if (usersError) {
      console.error("Supabase leaderboard users error:", usersError);
      throw usersError;
    }

    const candidateUsers = users || [];

    // 2. Fetch corresponding banana_bank balances
    const bankMap = new Map<string, bigint>();
    try {
      const allUserIds = candidateUsers.map(u => u.id);
      if (userId && typeof userId === 'string' && !allUserIds.includes(userId)) {
        allUserIds.push(userId);
      }

      if (allUserIds.length > 0) {
        const { data: bankRows, error: bankError } = await supabase
          .from('banana_bank')
          .select('*')
          .in('user_id', allUserIds);

        if (bankRows && !bankError) {
          for (const bRow of bankRows) {
            const bTotal = calculateTotalFromBankRow(bRow);
            bankMap.set(bRow.user_id, bTotal);
          }
        }
      }
    } catch (bankErr: any) {
      console.warn("[LEADERBOARD] banana_bank table fetch error or unmigrated:", bankErr.message);
    }

    // Merge in-memory bank store if available
    for (const [uid, bRow] of memoryBankStore.entries()) {
      if (!bankMap.has(uid)) {
        bankMap.set(uid, calculateTotalFromBankRow(bRow));
      }
    }

    // 3. Compute combined total score (pocket + bank) for each user
    const usersWithTotals = candidateUsers.map(u => {
      const pocketScore = BigInt(u.score || 0);
      const bankScore = bankMap.get(u.id) || 0n;
      const totalScore = pocketScore + bankScore;
      return {
        ...u,
        pocketScore: pocketScore.toString(),
        bankScore: bankScore.toString(),
        score: totalScore.toString(), // Primary score field represents Total Score
        totalScore: totalScore.toString()
      };
    });

    // 4. Sort descending by totalScore (using BigInt precision)
    usersWithTotals.sort((a, b) => {
      const diff = BigInt(b.score) - BigInt(a.score);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    // 5. Build final top 50 with rank
    let result = usersWithTotals.slice(0, 50).map((u, i) => ({ ...u, rank: i + 1 }));

    // 6. If userId is provided and not in top 50, fetch/include their position as tail
    if (userId && typeof userId === 'string' && userId !== '') {
      const isInTop50 = result.some(u => u.id === userId);
      
      if (!isInTop50) {
        const foundInCandidates = usersWithTotals.findIndex(u => u.id === userId);
        if (foundInCandidates !== -1) {
          result.push({
            ...usersWithTotals[foundInCandidates],
            isTail: true,
            rank: foundInCandidates + 1
          });
        } else {
          // Fetch specific user entry if not in top 100
          const { data: userEntry, error: userError } = await supabase
            .from('database')
            .select('id, name, score, level, coins, equipped_title, updated_at')
            .eq('id', userId)
            .maybeSingle();
            
          if (userEntry && !userError) {
            const pocketScore = BigInt(userEntry.score || 0);
            let bankScore = bankMap.get(userId) || 0n;
            if (!bankMap.has(userId)) {
              try {
                const { data: bRow } = await supabase
                  .from('banana_bank')
                  .select('*')
                  .eq('user_id', userId)
                  .maybeSingle();
                if (bRow) bankScore = calculateTotalFromBankRow(bRow);
              } catch {}
            }
            const totalScore = pocketScore + bankScore;
            
            result.push({
              ...userEntry,
              pocketScore: pocketScore.toString(),
              bankScore: bankScore.toString(),
              score: totalScore.toString(),
              totalScore: totalScore.toString(),
              isTail: true,
              rank: usersWithTotals.length + 1
            });
          }
        }
      }
    }
    
    res.json(result);
  } catch (error: any) {
    console.error("Leaderboard API error:", error);
    res.status(500).json({ error: error.message });
  }
});


// --- TRADING SYSTEM ---

let DYNAMIC_SKIN_VALUES: Record<string, number> = {};

async function refreshSkinValues() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('skin_values').select('id, value');
    if (error) throw error;
    
    if (data) {
      const newValues: Record<string, number> = {};
      data.forEach((item: any) => {
        const rarity = SKINS_METADATA[item.id] || 'Common';
        const minVal = rarity === 'Ominous' ? 100000000000 : Math.floor((DEFAULT_RARITY_VALUES[rarity] || 1000) * 0.1);
        newValues[item.id] = Math.max(minVal, Number(item.value));
      });
      DYNAMIC_SKIN_VALUES = newValues;
      console.log(`[SKIN VALUES] Refreshed ${data.length} skin values.`);
    }
  } catch (error) {
    console.error("[SKIN VALUES] Failed to refresh values:", error);
    // Fallback if table doesn't exist or error
    if (Object.keys(DYNAMIC_SKIN_VALUES).length === 0) {
      DYNAMIC_SKIN_VALUES = {}; // Fallback initialized below
    }
  }
}

let PREVIOUS_SKIN_SUPPLY: Record<string, number> = {};

async function updateDynamicSkinValues() {
  try {
    const supabase = getSupabase();
    // 1. Fetch all user inventories
    const { data: users, error } = await supabase.from('database').select('inventory');
    if (error) {
      console.error("[SKIN UPDATE] Failed to fetch inventories:", error);
      return;
    }
    
    // 2. Tally current supply
    const currentSupply: Record<string, number> = {};
    if (users) {
      for (const user of users) {
        if (user.inventory) {
          try {
            const inv = typeof user.inventory === 'string' ? JSON.parse(user.inventory) : user.inventory;
            for (const [skinId, count] of Object.entries(inv)) {
              if (skinId.startsWith('_') || !SKINS_METADATA[skinId]) continue;
              const num = Number(count);
              if (num > 0) currentSupply[skinId] = (currentSupply[skinId] || 0) + num;
            }
          } catch (e) {}
        }
      }
    }

    // 3. If it's the first run, just set previous supply and return
    if (Object.keys(PREVIOUS_SKIN_SUPPLY).length === 0) {
      PREVIOUS_SKIN_SUPPLY = currentSupply;
      return;
    }

    // 4. Calculate changes
    const updates: any[] = [];
    const processedSkins = new Set<string>();

    const processSkinChange = (skinId: string, currentCount: number, prevCount: number) => {
      processedSkins.add(skinId);
      const delta = currentCount - prevCount;
      if (delta === 0) return;

      // RULE: Skin values can NOT reduce when you get one (delta > 0), only get higher when you sell/trade (delta < 0)
      if (delta > 0) return;

      const rarity = SKINS_METADATA[skinId] || 'Common';
      const countSold = Math.abs(delta);
      let increase = 0;
      
      if (rarity === 'Ominous') increase = countSold * 5000000000;
      else if (rarity === 'Legendary') increase = countSold * 15000000;
      else if (rarity === 'Mythic') increase = countSold * 5000000;
      else if (rarity === 'Epic') increase = countSold * 150000;
      else if (rarity === 'Rare') increase = countSold * 15000;
      else if (rarity === 'Common') increase = countSold * 1500;
      
      const minCap = rarity === 'Ominous' ? 100000000000 : Math.floor((DEFAULT_RARITY_VALUES[rarity] || 1000) * 0.1);
      const currentValue = Math.max(minCap, DYNAMIC_SKIN_VALUES[skinId] || DEFAULT_RARITY_VALUES[rarity] || 1000);
      let newValue = currentValue + increase;
      newValue = Math.max(minCap, newValue);
      
      updates.push({ id: skinId, value: newValue });
    };

    for (const [skinId, currentCount] of Object.entries(currentSupply)) {
      const prevCount = PREVIOUS_SKIN_SUPPLY[skinId] || 0;
      processSkinChange(skinId, currentCount, prevCount);
    }
    
    // Handle skins that were completely removed (delta negative)
    for (const [skinId, prevCount] of Object.entries(PREVIOUS_SKIN_SUPPLY)) {
      if (!processedSkins.has(skinId) && prevCount > 0) {
        processSkinChange(skinId, 0, prevCount);
      }
    }

    // 5. Update DB and Memory
    if (updates.length > 0) {
       for (const update of updates) {
           await supabase.from('skin_values').update({ value: update.value }).eq('id', update.id);
       }
       await refreshSkinValues();
       console.log(`[SKIN UPDATE] Applied supply changes to ${updates.length} skins.`);
    }
    
    PREVIOUS_SKIN_SUPPLY = currentSupply;
    
  } catch (error) {
    console.error("[SKIN UPDATE] Error:", error);
  }
}

// Initial fallback values (matching SKINS rarity logic)
const DEFAULT_RARITY_VALUES: Record<string, number> = {
  'Common': 1000,
  'Rare': 15000,
  'Epic': 200000,
  'Mythic': 1000000,
  'Legendary': 10000000,
  'Ominous': 100000000000 // 100 B minimum value
};

const SKINS_METADATA: Record<string, string> = {};
SKINS.forEach(s => {
  SKINS_METADATA[s.id] = s.rarity;
  SKINS_METADATA[s.name] = s.rarity;
  SKINS_METADATA[s.id.toLowerCase()] = s.rarity;
  SKINS_METADATA[s.name.toLowerCase()] = s.rarity;
});

function getSkinMetadata(idOrName: any) {
  if (!idOrName) return null;
  const raw = typeof idOrName === 'object' && idOrName ? (idOrName.id || idOrName.name || '') : String(idOrName);
  if (!raw) return null;
  const clean = raw.trim();
  const cleanLower = clean.toLowerCase();
  const skin = SKINS.find(s => s.id === clean || s.name === clean || s.id.toLowerCase() === cleanLower || s.name.toLowerCase() === cleanLower);
  if (skin) return skin;
  if (cleanLower === 'ominous' || cleanLower === 'ominous banana' || cleanLower === 'ominous_banana' || cleanLower === 'o' || cleanLower === 'o1') return SKINS.find(s => s.id === 'o1') || null;
  if (cleanLower === 'ominous2' || cleanLower === 'o2') return SKINS.find(s => s.id === 'o2') || null;
  if (cleanLower === 'ominous3' || cleanLower === 'o3') return SKINS.find(s => s.id === 'o3') || null;
  if (cleanLower === 'ominous4' || cleanLower === 'o4') return SKINS.find(s => s.id === 'o4') || null;
  if (cleanLower === 'ominous5' || cleanLower === 'o5') return SKINS.find(s => s.id === 'o5') || null;
  return null;
}

function calculateTradeValue(skins: any[]) {
  if (!Array.isArray(skins)) return 0;
  return skins.reduce((total, id) => {
    const skin = getSkinMetadata(id);
    const rawId = typeof id === 'object' && id ? (id.id || '') : String(id);
    const rarity = skin?.rarity || SKINS_METADATA[rawId] || 'Common';
    const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
    const canonicalId = skin?.id || rawId;
    // 1. Try dynamic value from DB
    if (DYNAMIC_SKIN_VALUES[canonicalId] !== undefined) {
      return total + Math.max(minVal, DYNAMIC_SKIN_VALUES[canonicalId]);
    }
    // 2. Fallback to rarity defaults
    return total + minVal;
  }, 0);
}

// Global loop to update values based on supply changes every 1 minute
setInterval(updateDynamicSkinValues, 60 * 1000);

// Endpoint to get all skin values
app.get("/api/skin-values", async (req, res) => {
  // Ensure we have some values, if not try to refresh
  if (Object.keys(DYNAMIC_SKIN_VALUES).length === 0) {
    await refreshSkinValues();
  }
  const result: Record<string, number> = {};
  SKINS.forEach(s => {
    const minVal = s.rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[s.rarity] || 1000);
    const curr = DYNAMIC_SKIN_VALUES[s.id] ?? minVal;
    result[s.id] = Math.max(minVal, curr);
  });
  res.json(result);
});

// Request a trade
app.post("/api/trade/request", authenticateToken, async (req: any, res) => {
  const { receiverId } = req.body;
  const senderId = req.user.userId;

  if (senderId === receiverId) {
    return res.status(400).json({ error: "Cannot trade with yourself" });
  }

  try {
    const supabase = getSupabase();
    
    // Check if there is already a pending trade between these two
    const { data: existing } = await supabase
      .from('trades')
      .select('id')
      .eq('sender_id', senderId)
      .eq('receiver_id', receiverId)
      .in('status', ['pending', 'active'])
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: "Trade request already pending" });
    }

    const { data, error } = await supabase
      .from('trades')
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all trade requests for user
app.get("/api/trade/requests", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('trades')
      .select(`
        *,
        sender:sender_id(name),
        receiver:receiver_id(name)
      `)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .in('status', ['pending', 'active'])
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update trade (skins or ready status)
app.post("/api/trade/update", authenticateToken, async (req: any, res) => {
  const { tradeId, skins, ready } = req.body;
  const userId = req.user.userId;

  try {
    const supabase = getSupabase();
    const { data: trade, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

    if (fetchError || !trade) return res.status(404).json({ error: "Trade not found" });
    if (trade.status !== 'pending' && trade.status !== 'active') {
        return res.status(400).json({ error: "Trade is no longer active" });
    }

    const isSender = trade.sender_id === userId;
    const isReceiver = trade.receiver_id === userId;

    if (!isSender && !isReceiver) return res.status(403).json({ error: "Unauthorized" });

    const update: any = { 
        status: 'active',
        updated_at: new Date().toISOString()
    };

    if (skins !== undefined) {
        if (isSender) update.sender_skins = skins;
        else update.receiver_skins = skins;
        // Reset ready status if skins change
        update.sender_ready = false;
        update.receiver_ready = false;
    }

    if (ready !== undefined) {
        if (isSender) update.sender_ready = ready;
        else update.receiver_ready = ready;
    }

    const { data: updatedTrade, error: updateError } = await supabase
        .from('trades')
        .update(update)
        .eq('id', tradeId)
        .select(`
            *,
            sender:sender_id(name),
            receiver:receiver_id(name)
        `)
        .single();

    if (updateError) throw updateError;
    res.json(updatedTrade);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute trade
app.post("/api/trade/execute", authenticateToken, async (req: any, res) => {
  const { tradeId } = req.body;
  const userId = req.user.userId;

  try {
    const supabase = getSupabase();
    
    // 1. Get trade data
    const { data: trade, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

    if (fetchError || !trade) return res.status(404).json({ error: "Trade not found" });
    if (trade.status !== 'active') return res.status(400).json({ error: "Trade is not active" });
    if (!trade.sender_ready || !trade.receiver_ready) return res.status(400).json({ error: "Both players must be ready" });

    // 2. Validate move logic (30% value diff)
    const senderSkins = trade.sender_skins || [];
    const receiverSkins = trade.receiver_skins || [];
    const v1 = calculateTradeValue(senderSkins);
    const v2 = calculateTradeValue(receiverSkins);

    const maxV = Math.max(v1, v2);
    const minV = Math.min(v1, v2);

    if (maxV > 0 && minV < 0.7 * maxV) {
      return res.status(400).json({ error: "Trade value difference is too high (max 30%)" });
    }

    // 3. Atomically update inventories
    // Fetch both users
    const { data: users, error: usersError } = await supabase
        .from('database')
        .select('id, inventory')
        .in('id', [trade.sender_id, trade.receiver_id]);

    if (usersError || !users || users.length !== 2) throw new Error("Could not fetch user data");

    const sender = users.find(u => u.id === trade.sender_id);
    const receiver = users.find(u => u.id === trade.receiver_id);

    const senderInv = typeof sender.inventory === 'string' ? JSON.parse(sender.inventory) : (sender.inventory || {});
    const receiverInv = typeof receiver.inventory === 'string' ? JSON.parse(receiver.inventory) : (receiver.inventory || {});

    // Remove sender skins from sender, add to receiver
    senderSkins.forEach((sid: any) => {
        const skin = getSkinMetadata(sid);
        const canonId = skin?.id || (typeof sid === 'object' && sid ? sid.id : String(sid));
        const key = (senderInv[canonId] !== undefined && senderInv[canonId] > 0) ? canonId : (senderInv[sid] !== undefined ? sid : canonId);
        if (senderInv[key] > 0) {
            senderInv[key]--;
            receiverInv[canonId] = (receiverInv[canonId] || 0) + 1;
        }
    });

    // Remove receiver skins from receiver, add to sender
    receiverSkins.forEach((sid: any) => {
        const skin = getSkinMetadata(sid);
        const canonId = skin?.id || (typeof sid === 'object' && sid ? sid.id : String(sid));
        const key = (receiverInv[canonId] !== undefined && receiverInv[canonId] > 0) ? canonId : (receiverInv[sid] !== undefined ? sid : canonId);
        if (receiverInv[key] > 0) {
            receiverInv[key]--;
            senderInv[canonId] = (senderInv[canonId] || 0) + 1;
        }
    });

    // Update both users and trade status in one "go" (not a real transaction but sequential is okay here for basic app)
    await supabase.from('database').update({ inventory: JSON.stringify(senderInv) }).eq('id', trade.sender_id);
    await supabase.from('database').update({ inventory: JSON.stringify(receiverInv) }).eq('id', trade.receiver_id);
    await supabase.from('trades').update({ status: 'completed' }).eq('id', tradeId);

    // RULE: Skin values increase when traded
    const tradedSkinIds = [...senderSkins, ...receiverSkins];
    for (const sid of tradedSkinIds) {
      const skin = getSkinMetadata(sid);
      const canonId = skin?.id || (typeof sid === 'object' && sid ? sid.id : String(sid));
      const rarity = skin?.rarity || SKINS_METADATA[canonId] || 'Common';
      const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
      const curr = Math.max(minVal, DYNAMIC_SKIN_VALUES[canonId] || minVal);
      let tradeBoost = 0;
      if (rarity === 'Ominous') tradeBoost = 2500000000;
      else if (rarity === 'Legendary') tradeBoost = 1000000;
      else if (rarity === 'Mythic') tradeBoost = 250000;
      else if (rarity === 'Epic') tradeBoost = 25000;
      else if (rarity === 'Rare') tradeBoost = 2500;
      else tradeBoost = 250;
      
      const newV = curr + tradeBoost;
      DYNAMIC_SKIN_VALUES[canonId] = newV;
      try {
        await supabase.from('skin_values').upsert({ id: canonId, value: newV });
      } catch (e) {}
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to sell skin from Inventory (server-authoritative ownership check & credit)
app.post("/api/skin/sell", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: "Missing skinId" });
  const skinMeta = getSkinMetadata(skinId);
  if (!skinMeta) return res.status(400).json({ error: "Invalid skinId" });

  try {
    const supabase = getSupabase();
    const { data: user, error: uErr } = await supabase.from('database').select('score, inventory').eq('id', userId).maybeSingle();
    if (uErr || !user) return res.status(404).json({ error: "User not found" });

    const inv = parseJsonSafe(user.inventory, {});
    const canonId = skinMeta.id;
    const key = (Number(inv[canonId]) > 0) ? canonId : (Number(inv[skinId]) > 0 ? skinId : null);
    if (!key) return res.status(400).json({ error: "You do not own this skin" });

    const rarity = skinMeta.rarity || 'Common';
    const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
    const sellPrice = Math.max(minVal, DYNAMIC_SKIN_VALUES[canonId] || minVal);

    inv[key] = Number(inv[key]) - 1;
    if (inv[key] <= 0) delete inv[key];

    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + BigInt(sellPrice);
    await supabase.from('database').update({
      score: String(newScore),
      inventory: JSON.stringify(inv)
    }).eq('id', userId);

    let boost = 500;
    if (rarity === 'Ominous') boost = 5000000000;
    else if (rarity === 'Legendary') boost = 2000000;
    else if (rarity === 'Mythic') boost = 500000;
    else if (rarity === 'Epic') boost = 50000;
    else if (rarity === 'Rare') boost = 5000;

    const newV = sellPrice + boost;
    DYNAMIC_SKIN_VALUES[canonId] = newV;
    try { await supabase.from('skin_values').upsert({ id: canonId, value: newV }); } catch {}

    res.json({ success: true, newValue: newV, soldPrice: sellPrice, newBalance: String(newScore), inventory: inv });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to sell skin in Ludvig's Dungeon (server-authoritative ownership check & credit)
app.post("/api/skin/dungeon-sell", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: "Missing skinId" });
  const skinMeta = getSkinMetadata(skinId);
  if (!skinMeta) return res.status(400).json({ error: "Invalid skinId" });

  try {
    const supabase = getSupabase();
    const { data: user, error: uErr } = await supabase.from('database').select('score, inventory').eq('id', userId).maybeSingle();
    if (uErr || !user) return res.status(404).json({ error: "User not found" });

    const inv = parseJsonSafe(user.inventory, {});
    const canonId = skinMeta.id;
    const key = (Number(inv[canonId]) > 0) ? canonId : (Number(inv[skinId]) > 0 ? skinId : null);
    if (!key) return res.status(400).json({ error: "You do not own this skin" });

    const rarity = skinMeta.rarity || 'Common';
    const minCap = rarity === 'Ominous' ? 100000000000 : Math.floor((DEFAULT_RARITY_VALUES[rarity] || 1000) * 0.1);
    const baseVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
    const sellPrice = Math.max(rarity === 'Ominous' ? 100000000000 : minCap, DYNAMIC_SKIN_VALUES[canonId] || baseVal);

    inv[key] = Number(inv[key]) - 1;
    if (inv[key] <= 0) delete inv[key];

    const newScore = (parseNonNegativeBigInt(user.score) ?? 0n) + BigInt(sellPrice);
    await supabase.from('database').update({
      score: String(newScore),
      inventory: JSON.stringify(inv)
    }).eq('id', userId);

    let drop = 1500;
    if (rarity === 'Ominous') drop = 5000000000;
    else if (rarity === 'Legendary') drop = 15000000;
    else if (rarity === 'Mythic') drop = 5000000;
    else if (rarity === 'Epic') drop = 150000;
    else if (rarity === 'Rare') drop = 15000;

    const newV = Math.max(minCap, sellPrice - drop);
    DYNAMIC_SKIN_VALUES[canonId] = newV;
    try { await supabase.from('skin_values').upsert({ id: canonId, value: newV }); } catch {}

    res.json({ success: true, newValue: newV, droppedBy: drop, soldPrice: sellPrice, newBalance: String(newScore), inventory: inv });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel trade
app.post("/api/trade/cancel", authenticateToken, async (req: any, res) => {
    const { tradeId } = req.body;
    const userId = req.user.userId;
    try {
        const supabase = getSupabase();
        const { error } = await supabase
            .from('trades')
            .update({ status: 'cancelled' })
            .eq('id', tradeId)
            .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
        if (error) throw error;
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Gift Bananas or Skin to another player
app.post("/api/gift", authenticateToken, async (req: any, res) => {
  const senderId = req.user.userId;
  const { targetId, type, amount, skinId } = req.body;

  if (!targetId || senderId === targetId) {
    return res.status(400).json({ error: "Invalid recipient" });
  }

  try {
    const supabase = getSupabase();

    // Fetch sender and receiver
    const { data: users, error: fetchErr } = await supabase
      .from('database')
      .select('id, name, score, level, inventory')
      .in('id', [senderId, targetId]);

    if (fetchErr || !users || users.length !== 2) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    const sender = users.find(u => u.id === senderId);
    const target = users.find(u => u.id === targetId);

    if (!sender || !target) {
      return res.status(404).json({ error: "User not found" });
    }

    const senderScore = BigInt(sender.score || 0);
    const targetScore = BigInt(target.score || 0);
    const senderLevel = Number(sender.level || 1);
    const targetLevel = Number(target.level || 1);

    let senderInv = sender.inventory;
    if (typeof senderInv === 'string') {
      try { senderInv = JSON.parse(senderInv); } catch(e) { senderInv = {}; }
    }
    if (!senderInv || typeof senderInv !== 'object') senderInv = {};

    let targetInv = target.inventory;
    if (typeof targetInv === 'string') {
      try { targetInv = JSON.parse(targetInv); } catch(e) { targetInv = {}; }
    }
    if (!targetInv || typeof targetInv !== 'object') targetInv = {};

    if (type === 'bananas') {
      const giftAmount = BigInt(amount || 0);
      if (giftAmount <= 0n) {
        return res.status(400).json({ error: "Amount must be greater than 0" });
      }

      // Max 25% of balance limit
      const maxAllowed = senderScore / 4n;
      if (giftAmount > maxAllowed) {
        return res.status(400).json({ 
          error: `Cannot gift more than 25% of your balance (Max: ${maxAllowed.toString()} 🍌)` 
        });
      }

      if (senderScore < giftAmount) {
        return res.status(400).json({ error: "Insufficient bananas in balance" });
      }

      // Level difference must be within 10 levels
      const levelDiff = Math.abs(senderLevel - targetLevel);
      if (levelDiff > 10) {
        return res.status(400).json({ 
          error: `Level requirement not met! You can only gift bananas to players within 10 levels of your level (Yours: ${senderLevel}, Recipient: ${targetLevel})` 
        });
      }

      const newSenderScore = (senderScore - giftAmount).toString();
      const newTargetScore = (targetScore + giftAmount).toString();

      await supabase.from('database').update({ score: newSenderScore }).eq('id', senderId);
      await supabase.from('database').update({ score: newTargetScore }).eq('id', targetId);

      return res.json({
        success: true,
        type: 'bananas',
        amount: giftAmount.toString(),
        newBalance: newSenderScore,
        message: `Successfully gifted ${giftAmount.toString()} 🍌 to ${target.name}!`
      });

    } else if (type === 'skin') {
      if (!skinId) {
        return res.status(400).json({ error: "No skin selected" });
      }

      const skin = SKINS.find(s => s.id === skinId);
      if (!skin) {
        return res.status(400).json({ error: "Invalid skin" });
      }

      const senderCount = Number(senderInv[skinId] || 0);
      if (senderCount <= 0) {
        return res.status(400).json({ error: "You do not own this skin" });
      }

      // Calculate market value & 50% tax
      const marketValue = BigInt(DYNAMIC_SKIN_VALUES[skin.id] || DEFAULT_RARITY_VALUES[skin.rarity] || 1000);
      const tax = marketValue / 2n;

      if (senderScore < tax) {
        return res.status(400).json({ 
          error: `Insufficient bananas to pay the gifting tax! You need ${tax.toString()} 🍌 (50% of market value ${marketValue.toString()} 🍌)` 
        });
      }

      // Deduct 1 skin from sender, add to target
      senderInv[skinId] = senderCount - 1;
      if (senderInv[skinId] <= 0) delete senderInv[skinId];
      targetInv[skinId] = (Number(targetInv[skinId] || 0)) + 1;

      // Deduct tax from sender balance
      const newSenderScore = (senderScore - tax).toString();

      await supabase.from('database').update({
        score: newSenderScore,
        inventory: JSON.stringify(senderInv)
      }).eq('id', senderId);

      await supabase.from('database').update({
        inventory: JSON.stringify(targetInv)
      }).eq('id', targetId);

      return res.json({
        success: true,
        type: 'skin',
        skinId,
        skinName: skin.name,
        tax: tax.toString(),
        newBalance: newSenderScore,
        newInventory: senderInv,
        message: `Successfully gifted ${skin.name} to ${target.name}! Paid ${tax.toString()} 🍌 in gifting taxes.`
      });

    } else {
      return res.status(400).json({ error: "Invalid gift type" });
    }

  } catch (error: any) {
    console.error("Gift error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- VITE MIDDLEWARE ---

async function startServer() {
  // Global error handlers to prevent silent crashes
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
  });

// --- ROYAL BANANA PASS ---

app.get("/api/royal-pass/status", authenticateToken, async (req: any, res) => {
    try {
        const supabase = getSupabase();
        const userId = req.user.userId;

        // 1. Get Config
        const { data: config, error: configError } = await supabase
            .from('royal_pass_config')
            .select('*')
            .eq('active', true)
            .order('end_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (configError) throw configError;

        // 2. Get Rewards
        const { data: rewards, error: rewardsError } = await supabase
            .from('royal_pass_rewards')
            .select('*')
            .order('level', { ascending: true });

        if (rewardsError) throw rewardsError;

        // 3. Get User Progress
        const { data: user, error: userError } = await supabase
            .from('database')
            .select('royal_xp, royal_claimed')
            .eq('id', userId)
            .maybeSingle();

        if (userError) throw userError;

        res.json({
            config,
            rewards,
            user: {
                royal_xp: user?.royal_xp || 0,
                royal_claimed: user?.royal_claimed || []
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/royal-pass/claim", authenticateToken, async (req: any, res) => {
    const { level } = req.body;
    const userId = req.user.userId;

    try {
        const supabase = getSupabase();

        // 1. Validate Level
        const { data: reward, error: rewardError } = await supabase
            .from('royal_pass_rewards')
            .select('*')
            .eq('level', level)
            .maybeSingle();

        if (rewardError || !reward) return res.status(404).json({ error: "Reward not found" });

        // 2. Validate User Progress
        const { data: user, error: userError } = await supabase
            .from('database')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (userError || !user) return res.status(404).json({ error: "User not found" });

        if ((user.royal_xp || 0) < level * 10) {
            return res.status(400).json({ error: "Not enough Royal XP (Need 10 per level)" });
        }

        const claimed = user.royal_claimed || [];
        if (claimed.includes(level)) {
            return res.status(400).json({ error: "Reward already claimed" });
        }

        // 3. Check if Pass is Active
        const { data: config } = await supabase
            .from('royal_pass_config')
            .select('end_date, active')
            .eq('active', true)
            .maybeSingle();

        if (!config || !config.active || new Date() > new Date(config.end_date)) {
            return res.status(403).json({ error: "Royal Banana Pass is not currently active" });
        }

        // 4. Update User Data based on Reward Type
        let updatePayload: any = {
            royal_claimed: [...claimed, level]
        };

        if (reward.type === 'bananas') {
            updatePayload.score = String(BigInt(user.score) + BigInt(reward.amount));
        } else if (reward.type === 'coins') {
            updatePayload.coins = (user.coins || 0) + Number(reward.amount);
        } else if (reward.type === 'gadget') {
            const inventory = typeof user.gadgets === 'string' ? JSON.parse(user.gadgets) : (user.gadgets || []);
            // Map reward.item_id to index if needed, or just push. 
            // The gadget system uses boolean array for indices.
            const gadgetMap: Record<string, number> = {
                'lucky_monkey': 1,
                'xp_bar': 2,
                'streak_booster': 3,
                'dealer_peek': 4,
                'mega_bet': 5
            };
            const idx = gadgetMap[reward.item_id] || -1;
            if (idx !== -1) {
                inventory[idx] = true;
                updatePayload.gadgets = JSON.stringify(inventory);
            }
        } else if (reward.type === 'skin') {
            const inventory = typeof user.inventory === 'string' ? JSON.parse(user.inventory) : (user.inventory || {});
            inventory[reward.item_id] = (inventory[reward.item_id] || 0) + 1;
            updatePayload.inventory = JSON.stringify(inventory);
        } else if (reward.type === 'title') {
            const titles = typeof user.unlocked_titles === 'string' ? JSON.parse(user.unlocked_titles) : (user.unlocked_titles || []);
            if (!titles.includes(reward.item_id)) {
                titles.push(reward.item_id);
                updatePayload.unlocked_titles = JSON.stringify(titles);
            }
        } else if (reward.type === 'xp_boost') {
            const hours = parseInt(reward.item_id) || 1;
            const current = user.active_xp_boost ? new Date(user.active_xp_boost) : new Date();
            const base = current > new Date() ? current : new Date();
            updatePayload.active_xp_boost = new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
        } else if (reward.type === 'speed_grove') {
            const hours = parseInt(reward.item_id) || 1;
            const current = user.active_speed_boost ? new Date(user.active_speed_boost) : new Date();
            const base = current > new Date() ? current : new Date();
            updatePayload.active_speed_boost = new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
        }

        const { error: updateError } = await supabase.from('database').update(updatePayload).eq('id', userId);
        if (updateError) throw updateError;

        res.json({ success: true, reward });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/bank/:userId
app.get("/api/bank/:userId", async (req, res) => {
  const userId = req.params.userId;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const supabase = getSupabase();
    let bankData: any = null;
    let total = 0n;

    // Check all sources and take the maximum balance to prevent any loss
    // 1. Try fetching from banana_bank table if available
    try {
      const { data, error } = await supabase
        .from('banana_bank')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        const t = calculateTotalFromBankRow(data);
        if (t > total) {
          bankData = data;
          total = t;
        }
      }
    } catch {}

    // 2. Check disk/memory store
    const mem = memoryBankStore.get(userId);
    if (mem) {
      const memTotal = calculateTotalFromBankRow(mem);
      if (memTotal > total) {
        bankData = mem;
        total = memTotal;
      }
    }

    // 3. Check user's main profile in 'database' table (inventory._bank)
    try {
      const { data: userRow } = await supabase
        .from('database')
        .select('inventory')
        .eq('id', userId)
        .maybeSingle();

      if (userRow && userRow.inventory) {
        const inv = typeof userRow.inventory === 'string' ? JSON.parse(userRow.inventory) : userRow.inventory;
        if (inv && inv._bank && typeof inv._bank === 'object') {
          const invTotal = calculateTotalFromBankRow(inv._bank);
          if (invTotal > total) {
            bankData = decomposeBigIntToBankRow(invTotal);
            total = invTotal;
          }
        }
      }
    } catch {}

    if (!bankData || total === 0n) {
      bankData = decomposeBigIntToBankRow(0n);
      total = 0n;
    } else {
      bankData = decomposeBigIntToBankRow(total);
      memoryBankStore.set(userId, bankData);
      saveBankDiskStore(memoryBankStore);
    }

    res.json({ success: true, bank: bankData, total: total.toString() });
  } catch (err: any) {
    console.warn("[BANK API] Fetch warning, using memory store:", err.message);
    const mem = memoryBankStore.get(userId) || decomposeBigIntToBankRow(0n);
    const total = calculateTotalFromBankRow(mem);
    res.json({ success: true, bank: mem, total: total.toString() });
  }
});

// POST /api/bank/sync (Read-only authoritative sync — client cannot inflate vault balance)
app.post("/api/bank/sync", authenticateToken, async (req: any, res) => {
  const authUserId = req.user.userId;
  const targetUserId = req.body?.userId || authUserId;
  if (targetUserId !== authUserId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const supabase = getSupabase();
    let total = 0n;
    const mem = memoryBankStore.get(authUserId);
    if (mem) total = calculateTotalFromBankRow(mem);

    try {
      const { data: bRow } = await supabase.from('banana_bank').select('*').eq('user_id', authUserId).maybeSingle();
      if (bRow) {
        const t = calculateTotalFromBankRow(bRow);
        if (t > total) total = t;
      }
    } catch {}

    const { data: user } = await supabase.from('database').select('inventory').eq('id', authUserId).maybeSingle();
    if (user?.inventory) {
      const inv = parseJsonSafe(user.inventory, {});
      if (inv._bank) {
        const invT = calculateTotalFromBankRow(inv._bank);
        if (invT > total) total = invT;
      }
    }

    const finalRow = decomposeBigIntToBankRow(total);
    memoryBankStore.set(authUserId, finalRow);
    saveBankDiskStore(memoryBankStore);
    res.json({ success: true, total: total.toString(), bank: finalRow });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bank/deposit (Authenticated, atomic BigInt pocket deduction)
app.post("/api/bank/deposit", authenticateToken, async (req: any, res) => {
  const authUserId = req.user.userId;
  const { userId, amount } = req.body;
  if (userId && userId !== authUserId) return res.status(403).json({ error: "Forbidden" });
  if (!amount) return res.status(400).json({ error: "Missing amount" });

  const depAmount = parseNonNegativeBigInt(amount);
  if (depAmount === null || depAmount <= 0n) {
    return res.status(400).json({ error: "Deposit amount must be a positive whole number." });
  }

  try {
    const supabase = getSupabase();
    const { data: user, error: userError } = await supabase
      .from('database')
      .select('score, inventory, unlocked_titles')
      .eq('id', authUserId)
      .maybeSingle();

    if (userError || !user) return res.status(404).json({ error: "User not found" });

    const pocketScore = parseNonNegativeBigInt(user.score) ?? 0n;
    if (pocketScore < depAmount) {
      return res.status(400).json({ error: "You don't have enough bananas in your pocket!" });
    }

    let currentTotal = 0n;
    const currentMem = memoryBankStore.get(authUserId);
    if (currentMem) currentTotal = calculateTotalFromBankRow(currentMem);

    try {
      const { data: bankRow } = await supabase.from('banana_bank').select('*').eq('user_id', authUserId).maybeSingle();
      if (bankRow) {
        const tableTotal = calculateTotalFromBankRow(bankRow);
        if (tableTotal > currentTotal) currentTotal = tableTotal;
      }
    } catch {}

    const inv = parseJsonSafe(user.inventory, {});
    if (inv && inv._bank) {
      const invTotal = calculateTotalFromBankRow(inv._bank);
      if (invTotal > currentTotal) currentTotal = invTotal;
    }

    const newTotal = currentTotal + depAmount;
    const newCols = decomposeBigIntToBankRow(newTotal);
    const newPocketScore = pocketScore - depAmount;
    inv._bank = newCols;

    const unlockedTitles: string[] = parseJsonSafe(user.unlocked_titles, []);
    if (newTotal >= 1000000000n && !unlockedTitles.includes('vault_overlord')) {
      unlockedTitles.push('vault_overlord');
    }

    const { error: updateErr } = await supabase.from('database').update({
      score: String(newPocketScore),
      inventory: JSON.stringify(inv),
      unlocked_titles: JSON.stringify(unlockedTitles)
    }).eq('id', authUserId);
    if (updateErr) throw updateErr;

    memoryBankStore.set(authUserId, newCols);
    saveBankDiskStore(memoryBankStore);

    try {
      await supabase.from('banana_bank').upsert({
        id: authUserId,
        user_id: authUserId,
        ...newCols,
        updated_at: new Date().toISOString()
      });
    } catch {}

    res.json({
      success: true,
      total: newTotal.toString(),
      bank: newCols,
      newPocketBalance: String(newPocketScore),
      unlockedTitles
    });
  } catch (err: any) {
    console.error("[BANK DEPOSIT ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bank/withdraw (Authenticated, Max 1T at a time, BigInt pocket credit)
app.post("/api/bank/withdraw", authenticateToken, async (req: any, res) => {
  const authUserId = req.user.userId;
  const { userId, amount } = req.body;
  if (userId && userId !== authUserId) return res.status(403).json({ error: "Forbidden" });
  if (!amount) return res.status(400).json({ error: "Missing amount" });

  const withAmount = parseNonNegativeBigInt(amount);
  if (withAmount === null || withAmount <= 0n) {
    return res.status(400).json({ error: "Withdrawal amount must be a positive whole number." });
  }

  const MAX_WITHDRAW = BigInt("1000000000000");
  if (withAmount > MAX_WITHDRAW) {
    return res.status(400).json({
      error: "Maximum withdrawal limit is 1T (1,000,000,000,000 🍌) per ride!"
    });
  }

  try {
    const supabase = getSupabase();
    let currentTotal = 0n;
    const currentMem = memoryBankStore.get(authUserId);
    if (currentMem) currentTotal = calculateTotalFromBankRow(currentMem);

    try {
      const { data: bankRow } = await supabase.from('banana_bank').select('*').eq('user_id', authUserId).maybeSingle();
      if (bankRow) {
        const tableTotal = calculateTotalFromBankRow(bankRow);
        if (tableTotal > currentTotal) currentTotal = tableTotal;
      }
    } catch {}

    const { data: user, error: userErr } = await supabase
      .from('database')
      .select('score, inventory')
      .eq('id', authUserId)
      .maybeSingle();
    if (userErr || !user) return res.status(404).json({ error: "User not found" });

    const inv = parseJsonSafe(user.inventory, {});
    if (inv && inv._bank) {
      const invTotal = calculateTotalFromBankRow(inv._bank);
      if (invTotal > currentTotal) currentTotal = invTotal;
    }

    if (currentTotal < withAmount) {
      return res.status(400).json({ error: "Insufficient balance in Banana Bank vault!" });
    }

    const newTotal = currentTotal - withAmount;
    const newCols = decomposeBigIntToBankRow(newTotal);
    const newPocketScore = (parseNonNegativeBigInt(user.score) ?? 0n) + withAmount;
    inv._bank = newCols;

    const { error: updateErr } = await supabase.from('database').update({
      score: String(newPocketScore),
      inventory: JSON.stringify(inv)
    }).eq('id', authUserId);
    if (updateErr) throw updateErr;

    memoryBankStore.set(authUserId, newCols);
    saveBankDiskStore(memoryBankStore);

    try {
      await supabase.from('banana_bank').upsert({
        id: authUserId,
        user_id: authUserId,
        ...newCols,
        updated_at: new Date().toISOString()
      });
    } catch {}

    res.json({
      success: true,
      total: newTotal.toString(),
      bank: newCols,
      newPocketBalance: String(newPocketScore)
    });
  } catch (err: any) {
    console.error("[BANK WITHDRAW ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =================================================================
// 🃏 TEXAS HOLD'EM ONLINE & VS BOTS ENGINE
// =================================================================

interface PokerCard {
    rank: string;
    suit: string;
    value: number;
}

interface PokerPlayerSeat {
    id: string;
    name: string;
    isHost: boolean;
    isBot: boolean;
    seat: number;
    chips: number;
    currentBet: number;
    folded: boolean;
    isAllIn: boolean;
    cards: PokerCard[];
}

interface PokerTableState {
    id: string;
    name: string;
    host_id: string;
    host_name: string;
    small_blind: number;
    big_blind: number;
    buy_in: number;
    max_players: number;
    status: 'waiting' | 'in_progress' | 'finished';
    stage: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
    community_cards: PokerCard[]; // 5 cards generated by table host client
    pot: number;
    current_bet: number;
    active_turn_player_id: string | null;
    dealer_seat: number;
    last_action: {
        playerId: string;
        playerName: string;
        action: 'fold' | 'check' | 'call' | 'raise';
        amount?: number;
        message: string;
        timestamp: number;
    } | null;
    players: PokerPlayerSeat[];
    acted_in_round: string[];
    winners: any[];
    round_history: string[];
    created_at: string;
    updated_at: string;
}

const activePokerTables = new Map<string, PokerTableState>();
const BOT_NAMES = ["Gorilla Gus", "Chimp Champ", "Baboon Bob", "Professor Primate", "King Kong", "Monkey Mike"];

function getRankVal(r: string): number {
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    return parseInt(r, 10) || 2;
}

// 5-Card hand evaluator
function eval5CardPokerHand(cards: PokerCard[]): { score: number; handName: string; sorted: PokerCard[] } {
    const sorted = [...cards].sort((a, b) => b.value - a.value);
    const suits: { [k: string]: number } = {};
    const ranks: { [k: number]: number } = {};

    sorted.forEach(c => {
        suits[c.suit] = (suits[c.suit] || 0) + 1;
        ranks[c.value] = (ranks[c.value] || 0) + 1;
    });

    const isFlush = Object.values(suits).some(count => count === 5);
    
    // Check straight
    let isStraight = false;
    let straightHigh = 0;
    const uniqueVals = Array.from(new Set(sorted.map(c => c.value))).sort((a, b) => b - a);

    if (uniqueVals.length === 5) {
        if (uniqueVals[0] - uniqueVals[4] === 4) {
            isStraight = true;
            straightHigh = uniqueVals[0];
        } else if (uniqueVals[0] === 14 && uniqueVals[1] === 5 && uniqueVals[2] === 4 && uniqueVals[3] === 3 && uniqueVals[4] === 2) {
            // A-2-3-4-5 wheel straight
            isStraight = true;
            straightHigh = 5;
        }
    }

    const rankCounts = Object.entries(ranks)
        .map(([val, count]) => ({ val: Number(val), count }))
        .sort((a, b) => b.count - a.count || b.val - a.val);

    let category = 0; // High card
    let handName = "High Card";

    if (isFlush && isStraight) {
        if (straightHigh === 14) {
            category = 9;
            handName = "Royal Flush";
        } else {
            category = 8;
            handName = `Straight Flush (${straightHigh} High)`;
        }
    } else if (rankCounts[0].count === 4) {
        category = 7;
        handName = "Four of a Kind";
    } else if (rankCounts[0].count === 3 && rankCounts[1].count === 2) {
        category = 6;
        handName = "Full House";
    } else if (isFlush) {
        category = 5;
        handName = "Flush";
    } else if (isStraight) {
        category = 4;
        handName = `Straight (${straightHigh} High)`;
    } else if (rankCounts[0].count === 3) {
        category = 3;
        handName = "Three of a Kind";
    } else if (rankCounts[0].count === 2 && rankCounts[1].count === 2) {
        category = 2;
        handName = "Two Pair";
    } else if (rankCounts[0].count === 2) {
        category = 1;
        handName = "One Pair";
    }

    // Tie-breaker value calculation
    let tieScore = category * 1e10;
    let multiplier = 1e8;
    for (const item of rankCounts) {
        tieScore += item.val * multiplier;
        multiplier /= 100;
    }

    return { score: tieScore, handName, sorted };
}

// 7-Card Texas Hold'em hand evaluator (chooses the best 5-card combo out of 21)
function eval7CardPokerHand(cards: PokerCard[]): { score: number; handName: string; bestCards: PokerCard[] } {
    if (cards.length < 5) {
        return { score: 0, handName: "Incomplete Hand", bestCards: cards };
    }
    if (cards.length === 5) {
        const res = eval5CardPokerHand(cards);
        return { score: res.score, handName: res.handName, bestCards: res.sorted };
    }

    let bestScore = -1;
    let bestName = "";
    let bestCards: PokerCard[] = [];

    // Combinations of 5 from N (up to 7)
    const n = cards.length;
    for (let i = 0; i < n - 4; i++) {
        for (let j = i + 1; j < n - 3; j++) {
            for (let k = j + 1; k < n - 2; k++) {
                for (let l = k + 1; l < n - 1; l++) {
                    for (let m = l + 1; m < n; m++) {
                        const five = [cards[i], cards[j], cards[k], cards[l], cards[m]];
                        const res = eval5CardPokerHand(five);
                        if (res.score > bestScore) {
                            bestScore = res.score;
                            bestName = res.handName;
                            bestCards = res.sorted;
                        }
                    }
                }
            }
        }
    }

    return { score: bestScore, handName: bestName, bestCards };
}

// Sync poker table to Supabase if table exists
async function syncPokerTableDb(table: PokerTableState) {
    try {
        const supabase = getSupabase();
        await supabase.from('poker_tables').upsert({
            id: table.id,
            name: table.name,
            host_id: table.host_id,
            host_name: table.host_name,
            small_blind: table.small_blind,
            big_blind: table.big_blind,
            buy_in: table.buy_in,
            max_players: table.max_players,
            status: table.status,
            stage: table.stage,
            community_cards: table.community_cards,
            pot: table.pot,
            current_bet: table.current_bet,
            active_turn_player_id: table.active_turn_player_id,
            dealer_seat: table.dealer_seat,
            last_action: table.last_action,
            players: table.players,
            winners: table.winners,
            round_history: table.round_history,
            updated_at: new Date().toISOString()
        });
    } catch (e: any) {
        // Fallback gracefully without breaking live play
    }
}

// Helper to advance stage
function advancePokerRound(table: PokerTableState) {
    table.acted_in_round = [];
    table.players.forEach(p => { p.currentBet = 0; });
    table.current_bet = 0;

    if (table.stage === 'preflop') {
        table.stage = 'flop';
        table.round_history.push("Flop dealt (3 cards)");
    } else if (table.stage === 'flop') {
        table.stage = 'turn';
        table.round_history.push("Turn dealt (4th card)");
    } else if (table.stage === 'turn') {
        table.stage = 'river';
        table.round_history.push("River dealt (5th card)");
    } else if (table.stage === 'river') {
        // Showdown!
        table.stage = 'showdown';
        table.status = 'finished';
        table.active_turn_player_id = null;

        const activePlayers = table.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            const winner = activePlayers[0];
            winner.chips += table.pot;
            table.winners = [{ id: winner.id, name: winner.name, handName: "Last Player Standing", winAmount: table.pot }];
            table.round_history.push(`${winner.name} won ${table.pot} 🍌 (all others folded)!`);
        } else {
            // Evaluate hands
            const results = activePlayers.map(p => {
                const evaluated = eval7CardPokerHand([...p.cards, ...table.community_cards]);
                return {
                    player: p,
                    score: evaluated.score,
                    handName: evaluated.handName,
                    bestCards: evaluated.bestCards
                };
            }).sort((a, b) => b.score - a.score);

            const winningScore = results[0].score;
            const topWinners = results.filter(r => r.score === winningScore);
            const share = Math.floor(table.pot / topWinners.length);

            topWinners.forEach(w => {
                w.player.chips += share;
            });

            table.winners = topWinners.map(w => ({
                id: w.player.id,
                name: w.player.name,
                handName: w.handName,
                winAmount: share,
                cards: w.player.cards
            }));

            const winnerNames = topWinners.map(w => `${w.player.name} (${w.handName})`).join(' & ');
            table.round_history.push(`Showdown winner(s): ${winnerNames} won ${table.pot} 🍌!`);
        }
        return;
    }

    // Set active turn to first non-folded player after dealer
    const numPlayers = table.players.length;
    let nextIdx = (table.dealer_seat + 1) % numPlayers;
    for (let i = 0; i < numPlayers; i++) {
        const candidate = table.players[nextIdx];
        if (!candidate.folded && !candidate.isAllIn) {
            table.active_turn_player_id = candidate.id;
            return;
        }
        nextIdx = (nextIdx + 1) % numPlayers;
    }
}

// Bot AI logic runner
function processBotTurn(table: PokerTableState): boolean {
    if (table.status !== 'in_progress' || table.stage === 'showdown') return false;
    const curPlayer = table.players.find(p => p.id === table.active_turn_player_id);
    if (!curPlayer || !curPlayer.isBot || curPlayer.folded || curPlayer.isAllIn) return false;

    const toCall = table.current_bet - curPlayer.currentBet;
    let chosenAction: 'fold' | 'check' | 'call' | 'raise' = 'check';
    let raiseAmt = 0;

    // AI decision
    const cardsRevealed = table.stage === 'flop' ? 3 : table.stage === 'turn' ? 4 : table.stage === 'river' ? 5 : 0;
    const commCards = table.community_cards.slice(0, cardsRevealed);
    const handEval = eval7CardPokerHand([...curPlayer.cards, ...commCards]);
    const scoreCategory = Math.floor(handEval.score / 1e10);

    if (toCall <= 0) {
        // Can check for free or bet
        if (scoreCategory >= 2 && Math.random() < 0.6) {
            // Raise / Bet
            chosenAction = 'raise';
            raiseAmt = Math.min(curPlayer.chips, table.current_bet + table.big_blind * (1 + Math.floor(Math.random() * 2)));
        } else {
            chosenAction = 'check';
        }
    } else {
        // Facing a bet
        const potRatio = toCall / (table.pot + 1);
        if (scoreCategory >= 4) {
            // High hand: Call or Re-raise
            if (Math.random() < 0.4 && curPlayer.chips > toCall + table.big_blind) {
                chosenAction = 'raise';
                raiseAmt = Math.min(curPlayer.chips, table.current_bet + table.big_blind * 2);
            } else {
                chosenAction = 'call';
            }
        } else if (scoreCategory >= 1) {
            // Pair/two pair
            if (toCall <= curPlayer.chips * 0.4 || potRatio < 0.35) {
                chosenAction = 'call';
            } else {
                chosenAction = 'fold';
            }
        } else {
            // High card / bluff chance
            if (toCall <= table.big_blind * 1.5 || (Math.random() < 0.15 && toCall <= table.big_blind * 3)) {
                chosenAction = 'call';
            } else {
                chosenAction = 'fold';
            }
        }
    }

    // Apply Bot Action
    applyPlayerAction(table, curPlayer, chosenAction, raiseAmt);
    return true;
}

function applyPlayerAction(table: PokerTableState, player: PokerPlayerSeat, action: 'fold' | 'check' | 'call' | 'raise', raiseAmount = 0) {
    const toCall = table.current_bet - player.currentBet;

    if (action === 'fold') {
        player.folded = true;
        table.last_action = {
            playerId: player.id,
            playerName: player.name,
            action: 'fold',
            message: `${player.name} folded`,
            timestamp: Date.now()
        };
    } else if (action === 'check') {
        table.last_action = {
            playerId: player.id,
            playerName: player.name,
            action: 'check',
            message: `${player.name} checked`,
            timestamp: Date.now()
        };
    } else if (action === 'call') {
        const pay = Math.min(player.chips, toCall);
        player.chips -= pay;
        player.currentBet += pay;
        table.pot += pay;
        if (player.chips === 0) player.isAllIn = true;
        table.last_action = {
            playerId: player.id,
            playerName: player.name,
            action: 'call',
            amount: pay,
            message: `${player.name} called ${pay} 🍌`,
            timestamp: Date.now()
        };
    } else if (action === 'raise') {
        const targetBet = Math.max(table.current_bet + table.big_blind, raiseAmount);
        const needed = targetBet - player.currentBet;
        const pay = Math.min(player.chips, needed);
        player.chips -= pay;
        player.currentBet += pay;
        table.pot += pay;
        table.current_bet = player.currentBet;
        if (player.chips === 0) player.isAllIn = true;
        
        // Anyone else must now respond to this raise
        table.acted_in_round = [player.id];
        table.last_action = {
            playerId: player.id,
            playerName: player.name,
            action: 'raise',
            amount: table.current_bet,
            message: `${player.name} raised to ${table.current_bet} 🍌`,
            timestamp: Date.now()
        };
    }

    if (!table.acted_in_round.includes(player.id)) {
        table.acted_in_round.push(player.id);
    }

    // Check if only 1 active player left
    const remainingUnfolded = table.players.filter(p => !p.folded);
    if (remainingUnfolded.length <= 1) {
        advancePokerRound(table);
        return;
    }

    // Check if betting round complete:
    // All non-folded, non-all-in players have acted and their currentBet matches current_bet
    const eligibleToAct = table.players.filter(p => !p.folded && !p.isAllIn);
    const roundFinished = eligibleToAct.every(p => table.acted_in_round.includes(p.id) && p.currentBet === table.current_bet);

    if (roundFinished || eligibleToAct.length <= 1) {
        advancePokerRound(table);
    } else {
        // Move to next player
        const numPlayers = table.players.length;
        let curIdx = table.players.findIndex(p => p.id === player.id);
        let nextIdx = (curIdx + 1) % numPlayers;
        for (let i = 0; i < numPlayers; i++) {
            const nextP = table.players[nextIdx];
            if (!nextP.folded && !nextP.isAllIn) {
                table.active_turn_player_id = nextP.id;
                break;
            }
            nextIdx = (nextIdx + 1) % numPlayers;
        }
    }

    // Run chained bot actions if next turn is a bot
    let botTurns = 0;
    while (table.status === 'in_progress' && (table.stage as string) !== 'showdown' && botTurns < 8) {
        const nextP = table.players.find(p => p.id === table.active_turn_player_id);
        if (nextP && nextP.isBot && !nextP.folded && !nextP.isAllIn) {
            processBotTurn(table);
            botTurns++;
        } else {
            break;
        }
    }
}

// 1. List poker tables
app.get("/api/poker/tables", async (req, res) => {
    try {
        const supabase = getSupabase();
        // Load active tables from Supabase if not in memory
        try {
            const { data: dbTables } = await supabase.from('poker_tables')
                .select('*')
                .in('status', ['waiting', 'in_progress'])
                .order('updated_at', { ascending: false });

            if (dbTables && Array.isArray(dbTables)) {
                for (const row of dbTables) {
                    if (!activePokerTables.has(row.id)) {
                        activePokerTables.set(row.id, {
                            id: row.id,
                            name: row.name,
                            host_id: row.host_id,
                            host_name: row.host_name,
                            small_blind: Number(row.small_blind) || 10,
                            big_blind: Number(row.big_blind) || 20,
                            buy_in: Number(row.buy_in) || 1000,
                            max_players: row.max_players || 6,
                            status: row.status,
                            stage: row.stage,
                            community_cards: row.community_cards || [],
                            pot: Number(row.pot) || 0,
                            current_bet: Number(row.current_bet) || 0,
                            active_turn_player_id: row.active_turn_player_id,
                            dealer_seat: row.dealer_seat || 0,
                            last_action: row.last_action,
                            players: row.players || [],
                            acted_in_round: [],
                            winners: row.winners || [],
                            round_history: row.round_history || [],
                            created_at: row.created_at || new Date().toISOString(),
                            updated_at: row.updated_at || new Date().toISOString()
                        });
                    }
                }
            }
        } catch (dbErr) {
            // Memory store serves
        }

        const list = Array.from(activePokerTables.values()).map(t => ({
            id: t.id,
            name: t.name,
            host_name: t.host_name,
            small_blind: t.small_blind,
            big_blind: t.big_blind,
            buy_in: t.buy_in,
            playerCount: t.players.length,
            max_players: t.max_players,
            status: t.status,
            stage: t.stage
        }));
        res.json({ success: true, tables: list });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

function dealServerPokerHand(table: PokerTableState) {
    // Rebuy busted bots up to table buy-in; folded humans without chips stay out or minimum chips check
    table.players.forEach(p => {
        if (p.isBot && p.chips <= 0) {
            p.chips = table.buy_in;
        }
        p.folded = p.chips <= 0;
        p.isAllIn = false;
        p.currentBet = 0;
        p.cards = [];
    });

    const suits = ['H', 'D', 'C', 'S'];
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const deck: PokerCard[] = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ rank: r, suit: s, value: getRankVal(r) })));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    table.community_cards = deck.splice(0, 5);
    table.players.forEach(p => {
        p.cards = [deck.pop()!, deck.pop()!];
    });

    table.status = 'in_progress';
    table.stage = 'preflop';
    table.pot = 0;
    table.acted_in_round = [];
    table.winners = [];
    table.dealer_seat = (table.dealer_seat + 1) % table.players.length;

    const sbPlayer = table.players[(table.dealer_seat + 1) % table.players.length];
    const bbPlayer = table.players[(table.dealer_seat + 2) % table.players.length];

    const sbPay = Math.min(sbPlayer.chips, table.small_blind);
    sbPlayer.chips -= sbPay;
    sbPlayer.currentBet = sbPay;
    if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;
    table.pot += sbPay;

    const bbPay = Math.min(bbPlayer.chips, table.big_blind);
    bbPlayer.chips -= bbPay;
    bbPlayer.currentBet = bbPay;
    if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;
    table.pot += bbPay;

    table.current_bet = table.big_blind;

    const utgPlayer = table.players[(table.dealer_seat + 3) % table.players.length];
    table.active_turn_player_id = utgPlayer.id;

    table.last_action = {
        playerId: bbPlayer.id,
        playerName: bbPlayer.name,
        action: 'raise',
        amount: table.big_blind,
        message: `Blinds posted (${table.small_blind}/${table.big_blind} 🍌). Game started!`,
        timestamp: Date.now()
    };
    table.round_history.push(`Round started! ${sbPlayer.name} posted SB (${sbPay} 🍌), ${bbPlayer.name} posted BB (${bbPay} 🍌)`);

    let botTurns = 0;
    while (table.status === 'in_progress' && (table.stage as string) !== 'showdown' && botTurns < 8) {
        const curP = table.players.find(p => p.id === table.active_turn_player_id);
        if (curP && curP.isBot && !curP.folded && !curP.isAllIn) {
            processBotTurn(table);
            botTurns++;
        } else {
            break;
        }
    }
}

// 2. Create poker table (Supports both online tables and server-authoritative VS Bots)
app.post("/api/poker/tables/create", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { name, buyIn, smallBlind, bigBlind, isVsBot } = req.body;

    try {
        const supabase = getSupabase();
        const { data: user, error: userError } = await supabase.from('database').select('id, name, score').eq('id', userId).maybeSingle();
        if (userError || !user) return res.status(404).json({ error: "User not found. Please log in again." });

        const buyInNum = Math.max(10, Math.floor(Number(buyIn)) || 1000);
        const userBananas = parseNonNegativeBigInt(user.score) ?? 0n;

        if (userBananas < BigInt(buyInNum)) {
            return res.status(400).json({ error: `Not enough bananas! You have ${userBananas.toString()} 🍌 but need ${buyInNum} 🍌.` });
        }

        const newBalance = userBananas - BigInt(buyInNum);
        await supabase.from('database').update({ score: String(newBalance) }).eq('id', userId);

        const tableId = "table_" + Math.random().toString(36).substring(2, 9);
        const hostSeat: PokerPlayerSeat = {
            id: userId,
            name: user.name || req.user.name || "Host Monkey",
            isHost: true,
            isBot: false,
            seat: 0,
            chips: buyInNum,
            currentBet: 0,
            folded: false,
            isAllIn: false,
            cards: []
        };

        const defaultSb = Math.max(5, Math.floor(buyInNum / 100));
        const sb = Number(smallBlind) && Number(smallBlind) > 0 ? Math.floor(Number(smallBlind)) : defaultSb;
        const bb = Number(bigBlind) && Number(bigBlind) >= sb ? Math.floor(Number(bigBlind)) : (sb * 2);

        const table: PokerTableState = {
            id: tableId,
            name: (name || `${user.name || 'Monkey'}'s Table`).substring(0, 30),
            host_id: userId,
            host_name: user.name || req.user.name || "Host Monkey",
            small_blind: sb,
            big_blind: bb,
            buy_in: buyInNum,
            max_players: 6,
            status: 'waiting',
            stage: 'waiting',
            community_cards: [],
            pot: 0,
            current_bet: 0,
            active_turn_player_id: null,
            dealer_seat: 0,
            last_action: null,
            players: [hostSeat],
            acted_in_round: [],
            winners: [],
            round_history: [`Table created by ${user.name || 'Host'}`],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (isVsBot) {
            const botNames = [...BOT_NAMES].sort(() => Math.random() - 0.5);
            for (let i = 0; i < 4; i++) {
                table.players.push({
                    id: "bot_" + Math.random().toString(36).substring(2, 8),
                    name: botNames[i] || `Bot Monkey ${i + 1}`,
                    isHost: false,
                    isBot: true,
                    seat: table.players.length,
                    chips: buyInNum,
                    currentBet: 0,
                    folded: false,
                    isAllIn: false,
                    cards: []
                });
            }
            dealServerPokerHand(table);
        }

        activePokerTables.set(tableId, table);
        syncPokerTableDb(table).catch(() => {});

        res.json({ success: true, table, newBalance: String(newBalance) });
    } catch (e: any) {
        console.error("Poker table create error:", e);
        res.status(500).json({ error: e.message || "Failed to create table" });
    }
});

// 3. Join poker table
app.post("/api/poker/tables/join", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId } = req.body;

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Poker table not found" });
        if (table.status !== 'waiting') return res.status(400).json({ error: "Game is already in progress" });
        if (table.players.length >= table.max_players) return res.status(400).json({ error: "Table is full" });

        if (table.players.some(p => p.id === userId)) {
            return res.json({ success: true, table, alreadyJoined: true });
        }

        const supabase = getSupabase();
        const { data: user, error: userError } = await supabase.from('database').select('id, name, score').eq('id', userId).maybeSingle();
        if (userError || !user) return res.status(404).json({ error: "User not found" });

        const userBananas = parseNonNegativeBigInt(user.score) ?? 0n;
        if (userBananas < BigInt(table.buy_in)) {
            return res.status(400).json({ error: `Not enough bananas to buy in! Requires ${table.buy_in} 🍌.` });
        }

        const newBalance = userBananas - BigInt(table.buy_in);
        await supabase.from('database').update({ score: String(newBalance) }).eq('id', userId);

        const newSeat: PokerPlayerSeat = {
            id: userId,
            name: user.name || req.user.name || "Guest Monkey",
            isHost: false,
            isBot: false,
            seat: table.players.length,
            chips: table.buy_in,
            currentBet: 0,
            folded: false,
            isAllIn: false,
            cards: []
        };

        table.players.push(newSeat);
        table.round_history.push(`${newSeat.name} joined the table`);
        table.updated_at = new Date().toISOString();

        syncPokerTableDb(table).catch(() => {});
        res.json({ success: true, table, newBalance: String(newBalance) });
    } catch (e: any) {
        console.error("Poker table join error:", e);
        res.status(500).json({ error: e.message || "Failed to join table" });
    }
});

// 4. Leave poker table
app.post("/api/poker/tables/leave", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId } = req.body;

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });

        const playerIdx = table.players.findIndex(p => p.id === userId);
        if (playerIdx === -1) return res.status(400).json({ error: "You are not at this table" });

        const leavingPlayer = table.players[playerIdx];
        const refundChips = Math.max(0, Math.floor(Number(leavingPlayer.chips || 0)));

        const supabase = getSupabase();
        const { data: user } = await supabase.from('database').select('score').eq('id', userId).maybeSingle();
        let newBalance = parseNonNegativeBigInt(user?.score) ?? 0n;
        if (refundChips > 0) {
            newBalance += BigInt(refundChips);
            await supabase.from('database').update({ score: String(newBalance) }).eq('id', userId);
        }

        table.players.splice(playerIdx, 1);
        table.round_history.push(`${leavingPlayer.name} left with ${refundChips} 🍌`);

        if (table.players.filter(p => !p.isBot).length === 0) {
            activePokerTables.delete(tableId);
            try { await supabase.from('poker_tables').delete().eq('id', tableId); } catch {}
        } else {
            if (leavingPlayer.isHost && table.players.length > 0) {
                const nextHuman = table.players.find(p => !p.isBot) || table.players[0];
                nextHuman.isHost = true;
                table.host_id = nextHuman.id;
                table.host_name = nextHuman.name;
            }
            syncPokerTableDb(table).catch(() => {});
        }

        res.json({ success: true, refunded: refundChips, newBalance: String(newBalance) });
    } catch (e: any) {
        console.error("Poker table leave error:", e);
        res.status(500).json({ error: e.message || "Failed to leave table" });
    }
});

// 5. Start poker match (100% server-shuffled cards — ignores any client-provided cards)
app.post("/api/poker/tables/start", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId } = req.body;

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });
        if (table.host_id !== userId) return res.status(403).json({ error: "Only the table host can start the game" });
        if (table.status !== 'waiting') return res.status(400).json({ error: "Match already started." });

        const humanCount = table.players.filter(p => !p.isBot).length;
        if (humanCount < 5) {
            const botsNeeded = 5 - humanCount;
            const availableBotNames = BOT_NAMES.filter(bName => !table.players.some(p => p.name === bName));
            for (let i = 0; i < botsNeeded; i++) {
                const bName = availableBotNames[i % availableBotNames.length] || `Bot Monkey ${i + 1}`;
                table.players.push({
                    id: "bot_" + Math.random().toString(36).substring(2, 8),
                    name: bName,
                    isHost: false,
                    isBot: true,
                    seat: table.players.length,
                    chips: table.buy_in,
                    currentBet: 0,
                    folded: false,
                    isAllIn: false,
                    cards: []
                });
            }
        }

        dealServerPokerHand(table);
        await syncPokerTableDb(table);
        res.json({ success: true, table });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 5b. Deal next hand after showdown
app.post("/api/poker/tables/next-hand", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId } = req.body;

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });
        if (table.host_id !== userId) return res.status(403).json({ error: "Only the table host can start the next hand" });
        if (table.status !== 'finished') return res.status(400).json({ error: "Finish the current hand first!" });

        const human = table.players.find(p => p.id === userId);
        if (!human || human.chips <= 0) {
            return res.status(400).json({ error: "You are out of chips! Leave and re-join with a fresh buy-in." });
        }

        dealServerPokerHand(table);
        await syncPokerTableDb(table);
        res.json({ success: true, table });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 6. Action endpoint (Fold, Check, Call, Raise)
app.post("/api/poker/tables/action", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId, action, amount } = req.body;

    if (!['fold', 'check', 'call', 'raise'].includes(String(action))) {
        return res.status(400).json({ error: "Invalid poker action." });
    }

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });
        if (table.status !== 'in_progress') return res.status(400).json({ error: "Game is not currently active" });
        if (table.active_turn_player_id !== userId) return res.status(400).json({ error: "It is not your turn to act!" });

        const player = table.players.find(p => p.id === userId);
        if (!player || player.folded || player.isAllIn) return res.status(400).json({ error: "Player cannot act" });

        const raiseAmt = Math.max(0, Math.floor(Number(amount) || 0));
        applyPlayerAction(table, player, action, raiseAmt);
        await syncPokerTableDb(table);

        res.json({ success: true, table });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 7. Get table status (Sanitized for client)
app.get("/api/poker/tables/:tableId", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId } = req.params;

    try {
        let table = activePokerTables.get(tableId);
        if (!table) {
            // Attempt to restore from Supabase
            const supabase = getSupabase();
            const { data } = await supabase.from('poker_tables').select('*').eq('id', tableId).maybeSingle();
            if (data) {
                activePokerTables.set(tableId, data as any);
                table = activePokerTables.get(tableId);
            }
        }
        if (!table) return res.status(404).json({ error: "Poker table not found" });

        // Community cards revealed according to stage:
        // preflop: 0, flop: 3, turn: 4, river & showdown: 5
        let revealedCardsCount = 0;
        if (table.stage === 'flop') revealedCardsCount = 3;
        else if (table.stage === 'turn') revealedCardsCount = 4;
        else if (table.stage === 'river' || table.stage === 'showdown') revealedCardsCount = 5;

        const visibleCommunity = (table.community_cards || []).slice(0, revealedCardsCount);

        // Sanitize player cards:
        // You always see your own cards.
        // Opponents' cards only revealed at showdown (or if they folded and were shown).
        const isShowdown = table.stage === 'showdown';
        const sanitizedPlayers = table.players.map(p => {
            const canSee = isShowdown || p.id === userId;
            return {
                ...p,
                cards: canSee ? p.cards : (p.cards ? [{ rank: '?', suit: '?', value: 0 }, { rank: '?', suit: '?', value: 0 }] : [])
            };
        });

        res.json({
            success: true,
            table: {
                ...table,
                community_cards: visibleCommunity,
                players: sanitizedPlayers
            }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

  // --- GAME URL ACCESS GUARD (Blocks direct /spelX.html and /spelX access) ---
  const GAME_LAUNCH_COOKIE = "gh_game_launch";
  const LAUNCH_SECRET = crypto.createHmac("sha256", JWT_SECRET).update("game_hub_launch_guard_v1").digest();
  const consumedLaunchNonces = new Map<string, number>();

  const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!cookieHeader) return out;
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
    return out;
  };

  const signGameLaunchCookie = (gameId: number): string => {
    const payload = {
      gameId,
      nonce: crypto.randomBytes(16).toString("hex"),
      exp: Date.now() + 25000
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sigB64 = crypto.createHmac("sha256", LAUNCH_SECRET).update(payloadB64).digest("base64url");
    return `${payloadB64}.${sigB64}`;
  };

  const verifyAndConsumeGameLaunchCookie = (token: string | undefined, expectedGameId: number): boolean => {
    const now = Date.now();
    for (const [n, exp] of consumedLaunchNonces.entries()) {
      if (now > exp) consumedLaunchNonces.delete(n);
    }
    if (!token || !token.includes(".")) return false;
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return false;
    const expectedSig = crypto.createHmac("sha256", LAUNCH_SECRET).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(sigB64);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      if (Number(payload.gameId) !== expectedGameId) return false;
      if (typeof payload.nonce !== "string" || !payload.nonce) return false;
      if (now > Number(payload.exp)) return false;
      if (consumedLaunchNonces.has(payload.nonce)) return false;
      consumedLaunchNonces.set(payload.nonce, Number(payload.exp));
      return true;
    } catch {
      return false;
    }
  };

  const isSameOriginLaunchRequest = (req: any): boolean => {
    const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (secFetchSite && secFetchSite !== "same-origin") return false;

    const expectedHost = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim().toLowerCase();
    const refOrOrigin = String(req.headers["origin"] || req.headers["referer"] || "");
    if (refOrOrigin) {
      try {
        const parsedHost = new URL(refOrOrigin).host.toLowerCase();
        if (expectedHost && parsedHost !== expectedHost) return false;
        return secFetchSite === "same-origin" || Boolean(expectedHost && parsedHost === expectedHost);
      } catch {
        return false;
      }
    }
    return secFetchSite === "same-origin";
  };

  const isGameOnlineOnServer = async (gameId: number): Promise<boolean> => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from("games_config").select("is_online").eq("game_id", gameId).maybeSingle();
      if (data && data.is_online === false) return false;
    } catch {}
    return true;
  };

  const isHttpsRequest = (req: any): boolean =>
    Boolean(req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https"));

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /spel\nDisallow: /api/\nAllow: /\n");
  });

  // Issues a short-lived single-use signed launch token before index.html loads #game-iframe
  app.post("/api/game-launch", async (req, res) => {
    if (!isSameOriginLaunchRequest(req)) {
      return res.status(403).json({ error: "Direct launch forbidden" });
    }
    const gameId = parseInt(String(req.body?.gameId || ""), 10);
    if (!Number.isFinite(gameId) || gameId < 1 || gameId > 999) {
      return res.status(400).json({ error: "Invalid game ID" });
    }
    const online = await isGameOnlineOnServer(gameId);
    if (!online) {
      return res.status(403).json({ error: "This game is currently offline." });
    }
    const token = signGameLaunchCookie(gameId);
    res.json({ success: true, launchToken: token });
  });

  // All games launch via iframe from Game Hub; bounce legacy direct launch URLs to /
  app.get("/api/launch-game/:gameId", (_req, res) => {
    return res.redirect(302, "/");
  });

  // Block direct navigation to /spelX.html and /spelX (dev & production)
  app.use((req, res, next) => {
    const match = req.path.match(/^\/spel(\d+)(?:\.html)?\/?$/i);
    if (!match) return next();

    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.redirect(302, "/");
    }

    const gameId = parseInt(match[1], 10);
    const secFetchDest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();

    // Allow Vite internal html-proxy script loads if any occur
    if ((req.query["html-proxy"] !== undefined || req.query["direct"] !== undefined) && secFetchDest === "script") {
      return next();
    }

    // Must be requested by an <iframe> (direct tab visits send Sec-Fetch-Dest: document)
    if (secFetchDest !== "iframe") {
      return res.redirect(302, "/");
    }

    // If Referer is provided, its immediate initiator host must match our server host
    const expectedHost = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim().toLowerCase();
    const referer = String(req.headers["referer"] || "");
    if (referer && expectedHost) {
      try {
        if (new URL(referer).host.toLowerCase() !== expectedHost) {
          return res.redirect(302, "/");
        }
      } catch {
        return res.redirect(302, "/");
      }
    }

    const cookies = parseCookies(req.headers.cookie);
    const launchParam = typeof req.query.launch === "string" ? req.query.launch : undefined;
    const token = launchParam || cookies[GAME_LAUNCH_COOKIE];

    if (!verifyAndConsumeGameLaunchCookie(token, gameId)) {
      return res.redirect(302, "/");
    }

    if (launchParam) {
      req.url = req.path;
    }
    if (cookies[GAME_LAUNCH_COOKIE]) {
      res.clearCookie(GAME_LAUNCH_COOKIE, { path: "/" });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    
    // Middleware to handle clean URLs (e.g., /spel1 -> /spel1.html)
    app.use((req, res, next) => {
      if (req.path.indexOf('.') === -1) {
        const filePath = path.join(distPath, `${req.path}.html`);
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        }
      }
      next();
    });

    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Refresh skin values on startup
    await refreshSkinValues();
    // Initialize supply tracking
    await updateDynamicSkinValues();
  });
}

startServer();
