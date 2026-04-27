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
  const { name, id, password } = req.body;

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

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error } = await supabase.from('database').insert({
      id,
      name,
      password: hashedPassword,
      score: 0,
      coins: 0,
      banana_box: 0,
      level: 1,
      xp: 0,
      trees: JSON.stringify([1, ...Array(19).fill(0)]),
      gadgets: JSON.stringify(Array(10).fill(false)),
      unlocked_titles: JSON.stringify([]),
      equipped_title: null,
      inventory: JSON.stringify({}),
      active_gadgets: JSON.stringify(Array(10).fill(false)),
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
    res.json({ token, ...userData });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save Data
app.post("/api/save", authenticateToken, async (req: any, res) => {
  const { userId, name, score, coins, bananaBox, trees, gadgets, level, xp, unlocked_titles, equipped_title, inventory } = req.body;

  if (req.user.userId !== userId) {
    return res.status(403).json({ error: "Cannot save data for another user" });
  }

  try {
    const supabase = getSupabase();
    console.log(`[SAVE REQUEST] User: ${userId} (${name}), Score: ${score}, Coins: ${coins}, Expected: ${req.body.expectedScore}/${req.body.expectedCoins}`);
    
    // 1. Fetch current state to check for conflicts
    const { data: current, error: fetchError } = await supabase
      .from('database')
      .select('score, coins, unlocked_titles, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
        console.error(`[SAVE ERROR] Fetch failed for ${userId}:`, fetchError);
    }

    const { expectedScore, expectedCoins } = req.body;
    const isForceSync = String(expectedScore) === "-1" || String(expectedCoins) === "-1";
    
    // 2. Conflict Detection (Optimistic Concurrency Control)
    if (current && !isForceSync && expectedScore !== undefined && expectedCoins !== undefined) {
        const serverScore = String(current.score);
        const serverCoins = String(current.coins);
        const clientExpectedScore = String(expectedScore);
        const clientExpectedCoins = String(expectedCoins);

        if (serverScore !== clientExpectedScore || serverCoins !== clientExpectedCoins) {
            console.warn(`[SYNC CONFLICT] User ${userId}. Server: ${serverScore}/${serverCoins}, Client Expected: ${clientExpectedScore}/${clientExpectedCoins}. Last updated: ${current.updated_at}`);
            
            // Return current server data so client can resync
            const { data: fullUser } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
            if (fullUser) {
                const { password: _, ...userData } = fullUser;
                // Ensure BIGINTs are strings for JSON
                userData.score = String(userData.score);
                userData.coins = String(userData.coins);
                userData.xp = String(userData.xp);
                userData.banana_box = String(userData.banana_box);
                return res.json({ success: false, error: "Conflict detected", user: userData });
            }
        }
    }

    // 3. Merge unlocked_titles
    let finalUnlockedTitles = unlocked_titles || [];
    if (current && current.unlocked_titles) {
        const serverTitles = typeof current.unlocked_titles === 'string' ? JSON.parse(current.unlocked_titles) : current.unlocked_titles;
        if (Array.isArray(serverTitles)) {
            finalUnlockedTitles = Array.from(new Set([...serverTitles, ...finalUnlockedTitles]));
        }
    }

    // 4. Perform Upsert
    console.log(`[UPSERT START] User: ${userId}`);
    const { error: upsertError } = await supabase.from('database').upsert({
      id: userId,
      name,
      score: String(score), 
      coins: String(coins), 
      banana_box: String(bananaBox || 0),
      trees: JSON.stringify(trees),
      gadgets: JSON.stringify(gadgets),
      level: Number(level || 1),
      xp: String(xp || 0),
      unlocked_titles: JSON.stringify(finalUnlockedTitles),
      equipped_title: equipped_title || null,
      inventory: inventory ? JSON.stringify(inventory) : JSON.stringify({}),
      active_gadgets: req.body.active_gadgets ? JSON.stringify(req.body.active_gadgets) : JSON.stringify(Array(10).fill(false)),
      updated_at: new Date().toISOString()
    });

    if (upsertError) {
        console.error(`[SAVE ERROR] Upsert failed for ${userId}:`, upsertError);
        return res.status(500).json({ error: upsertError.message });
    }
    
    console.log(`[SAVE SUCCESS] User: ${userId} (${name})`);

    // 5. Return updated state
    const { data: updatedUser } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
    if (updatedUser) {
        const { password: _, ...userData } = updatedUser;
        userData.score = String(userData.score);
        userData.coins = String(userData.coins);
        userData.xp = String(userData.xp);
        userData.banana_box = String(userData.banana_box);
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
          const count = Number(inv[skinId]);
          if (!isNaN(count)) {
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
    // Common (20)
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
    // Rare (18)
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
    // Epic (10)
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
    // Mythic (5)
    { id: 'm1', name: 'Galaxy Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm2', name: 'Nebula Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm3', name: 'Supernova Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm4', name: 'Black Hole Banana', rarity: 'Mythic', color: '#ef4444' },
    { id: 'm5', name: 'Cosmic Banana', rarity: 'Mythic', color: '#ef4444' },
    // Legendary (3)
    { id: 'l1', name: 'Golden Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l2', name: 'Diamond Banana', rarity: 'Legendary', color: '#facc15' },
    { id: 'l3', name: 'Rainbow Banana', rarity: 'Legendary', color: '#facc15' }
];

// Get Server Status
app.get("/api/server-status", async (req, res) => {
  try {
    const supabase = getSupabase();
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

// Play Game (Server-side result generation)
app.post("/api/play", authenticateToken, async (req: any, res) => {
    const { gameMode, betAmount, betColor, isBonusBet, bonusBetAmount, bonusBetSelection, activeGadgets: clientActiveGadgets } = req.body;
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
        if (user.banned) return res.status(403).json({ error: "Banned" });

        let currentBananas = BigInt(user.score);
        let winStreak = Number(user.win_streak || 0);
        
        // Ensure betAmount is a valid number/string before converting to BigInt
        // In 'cases' mode, betAmount might be undefined, so we default to 0
        const bet = BigInt(betAmount || 0);
        const bonusBet = BigInt(bonusBetAmount || 0);
        const totalBet = bet + (isBonusBet ? bonusBet : 0n);

        if (gameMode !== 'cases' && currentBananas < totalBet) {
            // CHEAT DETECTION: If they try to bet more than they have, it's likely a manipulated request
            await supabase.from('database').update({ banned: true, ban_reason: 'Attempted to bet more than balance (Cheat Detection)' }).eq('id', userId);
            return res.status(400).json({ error: "Cheat detected. You have been banned." });
        }

        const unlockedGadgets = typeof user.gadgets === 'string' ? JSON.parse(user.gadgets) : (user.gadgets || []);
        // We use client-provided activeGadgets for UI state, but we should validate they are owned
        // For simplicity, we'll trust the client's activeGadgets choice but only if they own the gadget
        const activeGadgets = (clientActiveGadgets || []).map((active: boolean, i: number) => active && unlockedGadgets[i]);

        let winAmount = 0n;
        let resultData: any = {};
        
        let newInventory = user.inventory;
        if (typeof newInventory === 'string') {
            try { newInventory = JSON.parse(newInventory); } catch(e) { newInventory = {}; }
        }
        if (!newInventory || typeof newInventory !== 'object') newInventory = {};

        if (gameMode === 'roulette') {
            const rand = Math.random();
            const pRed = unlockedGadgets[1] ? 0.42 : 0.46;
            const pBlack = unlockedGadgets[1] ? 0.42 : 0.46;
            
            let winningColor;
            if (rand < pRed) winningColor = 'red';
            else if (rand < pRed + pBlack) winningColor = 'black';
            else winningColor = 'green';

            resultData.winningColor = winningColor;

            if (betColor === winningColor) {
                // Multipliers are TOTAL PAYOUT (Bet + Profit)
                const mult = winningColor === 'green' ? 14n : 2n;
                let baseWin = bet * mult;
                
                // Mega Bet logic
                const isMegaBet = activeGadgets[5];
                const megaBetEligible = isMegaBet && (bet >= currentBananas) && winningColor === 'green';
                
                if (megaBetEligible) {
                    const r = Math.random();
                    if (r < 0.25) {
                        winAmount = baseWin * 100n;
                        resultData.megaBet = 'win';
                    } else if (r < 0.50) {
                        winAmount = 0n; // Taxes
                        resultData.megaBet = 'taxes';
                    } else {
                        winAmount = baseWin;
                        resultData.megaBet = 'none';
                    }
                } else {
                    winAmount = baseWin;
                }
            } else {
                winAmount = 0n;
            }
        } else if (gameMode === 'slots') {
            const isMoreSlots = activeGadgets[4];
            const slotCount = isMoreSlots ? 9 : 3;
            const resultSlots = [];
            
            for (let i = 0; i < slotCount; i++) {
                let r = Math.random() * 100;
                // Buffed Jackpot chance from 2% to 5%
                if (r < 5) {
                    resultSlots.push(JACKPOT_ICON);
                } else {
                    // Pity/Luck factor: if it's the 2nd or 3rd slot in a line, 
                    // give a 15% chance to force it to match the previous slot for more wins
                    if (i % 3 > 0 && Math.random() < 0.15) {
                        resultSlots.push(resultSlots[i - 1]);
                    } else {
                        resultSlots.push(SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)]);
                    }
                }
            }
            resultData.slots = resultSlots;

            let totalWinMultiplier = 0;
            let winType = 'none';

            const checkLine = (indices: number[]) => {
                const icons = indices.map(idx => resultSlots[idx]);
                if (icons.every(icon => icon === icons[0])) {
                    if (icons[0] === JACKPOT_ICON) {
                        winType = 'jackpot';
                        return 10; // 10x Total Payout for Jackpot
                    }
                    winType = 'triple';
                    return 3; // 3x Total Payout for 3 of the same
                }
                const counts: any = {};
                icons.forEach(icon => counts[icon] = (counts[icon] || 0) + 1);
                if (Object.values(counts).some((c: any) => c >= 2)) {
                    if (winType === 'none') winType = 'double';
                    return 1; // 1x Total Payout (Push) for 2 of the same
                }
                return 0;
            };

            if (isMoreSlots) {
                totalWinMultiplier += checkLine([0, 1, 2]);
                totalWinMultiplier += checkLine([3, 4, 5]);
                totalWinMultiplier += checkLine([6, 7, 8]);
                totalWinMultiplier += checkLine([0, 3, 6]);
                totalWinMultiplier += checkLine([1, 4, 7]);
                totalWinMultiplier += checkLine([2, 5, 8]);
                totalWinMultiplier += checkLine([0, 4, 8]);
                totalWinMultiplier += checkLine([2, 4, 6]);
            } else {
                totalWinMultiplier += checkLine([0, 1, 2]);
            }
            
            resultData.winType = winType;

            let baseWin = BigInt(Math.round(Number(bet) * totalWinMultiplier));
            
            // Bonus Bet
            let bonusWin = false;
            if (isBonusBet && bonusBetAmount > 0 && bonusBetSelection) {
                const checkBonus = (indices: number[]) => {
                    return indices.every((idx, i) => resultSlots[idx] === bonusBetSelection[i]);
                };
                if (isMoreSlots) {
                    if (checkBonus([0, 1, 2]) || checkBonus([3, 4, 5]) || checkBonus([6, 7, 8])) bonusWin = true;
                } else {
                    if (checkBonus([0, 1, 2])) bonusWin = true;
                }
            }

            if (bonusWin) {
                baseWin += BigInt(bonusBetAmount) * 50n;
                resultData.bonusWin = true;
            }

            // Mega Bet logic for slots
            const isMegaBet = activeGadgets[5];
            const megaBetEligible = isMegaBet && (bet >= currentBananas) && totalWinMultiplier >= 3;
            
            if (megaBetEligible) {
                const r = Math.random();
                if (r < 0.25) {
                    winAmount = baseWin * 100n;
                    resultData.megaBet = 'win';
                } else if (r < 0.50) {
                    winAmount = 0n;
                    resultData.megaBet = 'taxes';
                } else {
                    winAmount = baseWin;
                    resultData.megaBet = 'none';
                }
            } else {
                winAmount = baseWin;
            }
        } else if (gameMode === 'blackjack') {
            const bjResult = req.body.bjResult; // 'win', 'blackjack', 'dealerBust', 'lose', 'bust', 'push'
            if (bjResult === 'win' || bjResult === 'dealerBust') {
                winAmount = totalBet * 2n;
            } else if (bjResult === 'blackjack') {
                winAmount = totalBet * 5n / 2n; // 2.5x
            } else if (bjResult === 'push') {
                winAmount = totalBet;
            } else {
                winAmount = 0n;
            }
            resultData.reason = bjResult;
        } else if (gameMode === 'plinko') {
            // Plinko probabilities (matching client V5.11 multipliers)
            // Multipliers: [10, 1.5, 1.1, 1.0, 0.5, 0.3, 0.2, 0.3, 0.5, 1.0, 1.1, 1.5, 10]
            const plinkoMults = [10, 1.5, 1.1, 1.0, 0.5, 0.3, 0.2, 0.3, 0.5, 1.0, 1.1, 1.5, 10];
            
            // Use a binomial distribution logic or weighted random
            // For now, weighted random favoring middle but still purely luck based
            const weights = [1, 2, 4, 8, 12, 16, 20, 16, 12, 8, 4, 2, 1]; // Binomial-like
            const totalWeight = weights.reduce((a, b) => a + b, 0);
            let rand = Math.random() * totalWeight;
            
            let bucketIndex = 0;
            for (let i = 0; i < weights.length; i++) {
                if (rand < weights[i]) {
                    bucketIndex = i;
                    break;
                }
                rand -= weights[i];
            }
            
            const multiplier = plinkoMults[bucketIndex];
            winAmount = BigInt(Math.round(Number(bet) * multiplier));
            resultData.bucketIndex = bucketIndex;
            resultData.multiplier = multiplier;
        } else if (gameMode === 'cases') {
            const caseType = req.body.caseType; // 'normal', 'booster', 'toverland'
            const costs: any = { 'normal': 10000n, 'booster': 100000n, 'toverland': 2000000n };
            const cost = costs[caseType] || 0n;
            
            if (currentBananas < cost) return res.status(400).json({ error: "Not enough bananas" });
            
            // Generate result based on probabilities
            const r = Math.random() * 100;
            let rarity = 'Common';
            
            if (caseType === 'toverland') {
                if (r < 20) rarity = 'Legendary';
                else if (r < 50) rarity = 'Mythic';
                else if (r < 80) rarity = 'Epic';
                else if (r < 95) rarity = 'Rare';
                else rarity = 'Common';
            } else if (caseType === 'booster') {
                if (r < 5) rarity = 'Legendary';
                else if (r < 15) rarity = 'Mythic';
                else if (r < 30) rarity = 'Epic';
                else if (r < 70) rarity = 'Rare';
                else rarity = 'Common';
            } else {
                // Normal Case
                if (r < 0.5) rarity = 'Legendary';
                else if (r < 2) rarity = 'Mythic';
                else if (r < 10) rarity = 'Epic';
                else if (r < 30) rarity = 'Rare';
                else rarity = 'Common';
            }

            // Select a random skin from that rarity
            const skinPool = SKINS.filter(s => s.rarity === rarity);
            const selectedSkin = skinPool[Math.floor(Math.random() * skinPool.length)];
            
            winAmount = 0n; // Cases cost money, they don't give bananas back directly
            // We need to subtract the cost
            currentBananas -= cost;
            
            // Update inventory on server
            newInventory[selectedSkin.id] = (newInventory[selectedSkin.id] || 0) + 1;
            
            resultData.skin = selectedSkin;
            resultData.rarity = rarity;
            resultData.cost = String(cost);
        }

        // Update balance
        let isWin = false;
        let isPush = false;
        
        if (gameMode !== 'cases') {
            isWin = winAmount > totalBet;
            isPush = winAmount === totalBet;
            
            // Banana Streak Gadget (Multiplier)
            // User: "when you have a 1+ win streak (so when you have won 2 times in a row) ... get a 2x multiplier"
            // Translation: If winStreak >= 1 (they have won at least once before), double the win.
            if (activeGadgets[3] && winStreak >= 1 && isWin) {
                winAmount = winAmount * 2n;
            }
            
            // Update streak counter
            if (isWin) {
                winStreak++;
            } else if (!isPush) {
                winStreak = 0;
            }
        }

        const newBananas = gameMode === 'cases' ? currentBananas : (currentBananas - totalBet + winAmount);
        
        let updatePayload: any = {
            score: String(newBananas),
            win_streak: winStreak,
            updated_at: new Date().toISOString()
        };
        
        // Royal Banana Pass Progress
        let earnedRoyalXP = 0;
        if (gameMode !== 'cases') {
            const isWin = winAmount > totalBet;
            // Only count wins if the bet was more than 5% of entire balance
            const isEligibleBet = currentBananas > 0n && totalBet >= currentBananas / 20n;
            
            if (isWin && isEligibleBet) {
                updatePayload.royal_xp = (user.royal_xp || 0) + 1;
                updatePayload.wins_since_royal_xp = 0; // Reset wins-since counter as it's no longer used for award
                earnedRoyalXP = 1;
            }
        }

        if (gameMode === 'cases') {
            updatePayload.inventory = JSON.stringify(newInventory);
        }

        const { error: updateError } = await supabase.from('database').update(updatePayload).eq('id', userId);

        if (updateError) throw updateError;

        res.json({
            success: true,
            winAmount: String(winAmount),
            newBalance: String(newBananas),
            winStreak: winStreak,
            result: resultData,
            royalXP: updatePayload.royal_xp,
            earnedRoyalXP: earnedRoyalXP
        });

    } catch (error: any) {
        console.error("Play error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Current User Data
app.get("/api/me", authenticateToken, async (req: any, res) => {
  try {
    console.log(`Fetching data for user: ${req.user.userId}`);
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('database')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error) {
      console.error("Supabase /api/me error:", error);
      throw error;
    }
    if (!user) {
      console.warn(`User not found: ${req.user.userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    // Don't send password back to client
    const { password: _, ...userData } = user;
    res.json(userData);
  } catch (error: any) {
    console.error("/api/me API error:", error);
    res.status(500).json({ error: error.message });
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

// Debug Endpoint
app.get("/api/debug", authenticateToken, async (req: any, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('database')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error) throw error;
    res.json({ 
        userId: req.user.userId,
        dbData: data,
        env: {
            hasUrl: !!process.env.SUPABASE_URL,
            hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { userId } = req.query;
    const supabase = getSupabase();
    
    // 1. Fetch Top 50
    // We query the 'database' table directly to ensure 100% accuracy
    const { data: top50, error: top50Error } = await supabase
      .from('database')
      .select('id, name, score, level, coins, equipped_title')
      .or('banned.eq.false,banned.is.null')
      .order('score', { ascending: false })
      .limit(50);

    if (top50Error) {
      console.error("Supabase top50 error:", top50Error);
      throw top50Error;
    }

    let result = top50 || [];

    // 2. If userId is provided, find their actual rank
    if (userId && typeof userId === 'string' && userId !== '') {
      const isInTop50 = result.some(u => u.id === userId);
      
      if (!isInTop50) {
        // Fetch user entry
        const { data: userEntry, error: userError } = await supabase
          .from('database')
          .select('id, name, score, level, coins, equipped_title')
          .eq('id', userId)
          .maybeSingle();
          
        if (userEntry && !userError) {
          // Calculate actual rank
          const { count, error: countError } = await supabase
            .from('database')
            .select('*', { count: 'exact', head: true })
            .or('banned.eq.false,banned.is.null')
            .gt('score', userEntry.score);
            
          const rank = (count || 0) + 1;
          result.push({ ...userEntry, isTail: true, rank });
        }
      } else {
        // Add rank to the top 50 entries for consistency
        result = result.map((u, i) => ({ ...u, rank: i + 1 }));
      }
    } else {
      // Add rank to the top 50 entries
      result = result.map((u, i) => ({ ...u, rank: i + 1 }));
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
        newValues[item.id] = Number(item.value);
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

// Initial fallback values (matching SKINS rarity logic)
const DEFAULT_RARITY_VALUES: Record<string, number> = {
  'Common': 1000,
  'Rare': 15000,
  'Epic': 200000,
  'Mythic': 1000000,
  'Legendary': 10000000
};

const SKINS_METADATA: Record<string, string> = {
  'c1': 'Common', 'c2': 'Common', 'c3': 'Common', 'c4': 'Common', 'c5': 'Common',
  'c6': 'Common', 'c7': 'Common', 'c8': 'Common', 'c9': 'Common', 'c10': 'Common',
  'c11': 'Common', 'c12': 'Common', 'c13': 'Common', 'c14': 'Common', 'c15': 'Common',
  'c16': 'Common', 'c17': 'Common', 'c18': 'Common', 'c19': 'Common', 'c20': 'Common',
  'r1': 'Rare', 'r2': 'Rare', 'r3': 'Rare', 'r4': 'Rare', 'r5': 'Rare',
  'r6': 'Rare', 'r7': 'Rare', 'r8': 'Rare', 'r9': 'Rare', 'r10': 'Rare',
  'r11': 'Rare', 'r12': 'Rare', 'r13': 'Rare', 'r14': 'Rare', 'r15': 'Rare',
  'r16': 'Rare', 'r17': 'Rare', 'r18': 'Rare',
  'e1': 'Epic', 'e2': 'Epic', 'e3': 'Epic', 'e4': 'Epic', 'e5': 'Epic',
  'e6': 'Epic', 'e7': 'Epic', 'e8': 'Epic', 'e9': 'Epic', 'e10': 'Epic',
  'm1': 'Mythic', 'm2': 'Mythic', 'm3': 'Mythic', 'm4': 'Mythic', 'm5': 'Mythic',
  'l1': 'Legendary', 'l2': 'Legendary', 'l3': 'Legendary'
};

function calculateTradeValue(skins: string[]) {
  return skins.reduce((total, id) => {
    // 1. Try dynamic value from DB
    if (DYNAMIC_SKIN_VALUES[id] !== undefined) {
      return total + DYNAMIC_SKIN_VALUES[id];
    }
    // 2. Fallback to rarity defaults
    const rarity = SKINS_METADATA[id] || 'Common';
    return total + (DEFAULT_RARITY_VALUES[rarity] || 0);
  }, 0);
}

// Global loop to refresh values every 5 minutes
setInterval(refreshSkinValues, 5 * 60 * 1000);

// Endpoint to get all skin values
app.get("/api/skin-values", async (req, res) => {
  // Ensure we have some values, if not try to refresh
  if (Object.keys(DYNAMIC_SKIN_VALUES).length === 0) {
    await refreshSkinValues();
  }
  res.json(DYNAMIC_SKIN_VALUES);
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
    senderSkins.forEach((sid: string) => {
        if (senderInv[sid] > 0) {
            senderInv[sid]--;
            receiverInv[sid] = (receiverInv[sid] || 0) + 1;
        }
    });

    // Remove receiver skins from receiver, add to sender
    receiverSkins.forEach((sid: string) => {
        if (receiverInv[sid] > 0) {
            receiverInv[sid]--;
            senderInv[sid] = (senderInv[sid] || 0) + 1;
        }
    });

    // Update both users and trade status in one "go" (not a real transaction but sequential is okay here for basic app)
    await supabase.from('database').update({ inventory: JSON.stringify(senderInv) }).eq('id', trade.sender_id);
    await supabase.from('database').update({ inventory: JSON.stringify(receiverInv) }).eq('id', trade.receiver_id);
    await supabase.from('trades').update({ status: 'completed' }).eq('id', tradeId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
                'more_slots': 4,
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
  });
}

startServer();
