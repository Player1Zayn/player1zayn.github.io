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
const activeCrashGames = new Map<string, { betAmount: bigint, crashPoint: number }>();
const activeHiloGames = new Map<string, { betAmount: bigint, firstCard: { rank: string, suit: string, value: number } }>();
const activeMinesGames = new Map<string, { betAmount: bigint, mineCount: number, mines: number[], revealed: number[], currentMultiplier: number }>();

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
      inventory: JSON.stringify({}),
      active_gadgets: JSON.stringify(Array(10).fill(false)),
      vladimir_quest_status: req.body.vladimir_quest_status !== undefined ? Number(req.body.vladimir_quest_status) : 0,
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
  const { userId, name, score, coins, bananaBox, trees, gadgets, level, xp, unlocked_titles, equipped_title, inventory, vladimir_quest_status } = req.body;

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
    { id: 'o1', name: 'Eldritch Banana', rarity: 'Ominous', color: '#000000' },
    { id: 'o2', name: 'Abyssal Monarch Banana', rarity: 'Ominous', color: '#000000' },
    { id: 'o3', name: 'Doomsday Banana', rarity: 'Ominous', color: '#000000' },
    { id: 'o4', name: 'Void Sovereign Banana', rarity: 'Ominous', color: '#000000' },
    { id: 'o5', name: 'Blood Moon Banana', rarity: 'Ominous', color: '#000000' }
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
          const user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
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

// Play Game (Server-side result generation)
app.post("/api/play", authenticateToken, async (req: any, res) => {
    const { clientScore, gameMode, betAmount, betColor, isBonusBet, bonusBetAmount, bonusBetSelection, activeGadgets: clientActiveGadgets, guess, action, caseType, multiplier, bjResult, dealerScore: reqDealerScore, playerScore: reqPlayerScore, taxPenalty } = req.body;
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
            // AUTO-UNBAN for false positives from the old system (balance mismatch bans)
            if (user.ban_reason && user.ban_reason.includes('Attempted to bet more than balance')) {
                console.log(`[AUTO-UNBAN] Unbanning user ${userId} who was previously banned for balance mismatch false positive.`);
                await supabase.from('database').update({ banned: false, ban_reason: null }).eq('id', userId);
                // After unbanning, we should reload the user status or just proceed
                user.banned = false;
                user.ban_reason = null;
            } else {
                return res.status(403).json({ 
                    error: "Banned", 
                    reason: user.ban_reason || "No reason specified. Contact support." 
                });
            }
        }

        let currentBananas = BigInt(user.score);
        let winStreak = Number(user.win_streak || 0);
        
        // Ensure betAmount is a valid number/string before converting to BigInt
        // In 'cases' mode, betAmount might be undefined, so we default to 0
        const bet = BigInt(betAmount || 0);
        const bonusBet = BigInt(bonusBetAmount || 0);
        let totalBet = bet + (isBonusBet ? bonusBet : 0n);

        if (clientScore !== undefined && clientScore !== null) {
            let caseCost = 0n;
            if (gameMode === 'cases') {
                caseCost = CASE_COSTS[req.body.caseType] || 0n;
            }
            currentBananas = BigInt(clientScore) + totalBet + caseCost;
        }

        if (gameMode !== 'cases' && gameMode !== 'crash_cashout' && gameMode !== 'hilo_guess' && gameMode !== 'mines_pick' && gameMode !== 'mines_cashout' && currentBananas < totalBet) {
            // RELAXED DETECTION: Instead of banning, we return a 400 error. 
            // This prevents false bans due to client-side tree harvesting not being synced yet.
            // Only ban if the discrepancy is absurdly high (e.g. betting 1M+ over balance) 
            // but for now let's just return a helpful error.
            return res.status(400).json({ 
                error: "Balance missmatch, Please Sync manually.",
                serverBalance: String(currentBananas),
                attemptedBet: String(totalBet)
            });
        }

        const unlockedGadgets = typeof user.gadgets === 'string' ? JSON.parse(user.gadgets) : (user.gadgets || []);
        // We use client-provided activeGadgets for UI state, but we should validate they are owned
        // For simplicity, we'll trust the client's activeGadgets choice but only if they own the gadget
        const activeGadgets = (clientActiveGadgets || []).map((active: boolean, i: number) => active && unlockedGadgets[i]);

        let winAmount = 0n;
        let resultData: any = {};
        let megaBetOutcome: 'win' | 'taxes' | 'none' = 'none';
        
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
                const mult = winningColor === 'green' ? 14n : 2n;
                winAmount = bet * mult;
            } else {
                winAmount = 0n;
            }
        } else if (gameMode === 'slots') {
            const slotCount = 6;
            const resultSlots = [];
            
            for (let i = 0; i < slotCount; i++) {
                let r = Math.random() * 100;
                const jackpotChance = 1.0;
                if (r < jackpotChance) resultSlots.push(JACKPOT_ICON);
                else {
                    const duplicateChance = 0.05;
                    if (i % 3 > 0 && Math.random() < duplicateChance) resultSlots.push(resultSlots[i - 1]);
                    else resultSlots.push(SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)]);
                }
            }
            resultData.slots = resultSlots;

            let totalWinMultiplier = 0;
            let winType = 'none';

            const checkLine = (indices: number[]) => {
                const icons = indices.map(idx => resultSlots[idx]);
                if (icons.every(icon => icon === icons[0])) {
                    if (icons[0] === JACKPOT_ICON) {
                        if (winType === 'none' || winType === 'triple' || winType === 'double') winType = 'jackpot';
                        return 10;
                    }
                    if (winType === 'none' || winType === 'double') winType = 'triple';
                    return 3;
                }
                const counts: any = {};
                icons.forEach(icon => counts[icon] = (counts[icon] || 0) + 1);
                if (Object.values(counts).some((c: any) => c >= 2)) {
                    if (winType === 'none') winType = 'double';
                    return 1;
                }
                return 0;
            };

            [ [0,1,2], [3,4,5] ].forEach(line => {
                totalWinMultiplier += checkLine(line);
            });
            
            resultData.winType = winType;
            winAmount = BigInt(Math.round(Number(bet) * totalWinMultiplier));
            
            // Bonus Bet
            if (isBonusBet && bonusBetAmount > 0 && bonusBetSelection) {
                const checkBonus = (indices: number[]) => indices.every((idx, i) => resultSlots[idx] === bonusBetSelection[i]);
                let bonusWin = false;
                if (checkBonus([0, 1, 2]) || checkBonus([3, 4, 5])) bonusWin = true;
                if (bonusWin) {
                    winAmount += BigInt(bonusBetAmount) * 50n;
                    resultData.bonusWin = true;
                }
            }
        } else if (gameMode === 'blackjack') {
            const bjResults = Array.isArray(req.body.bjResult) ? req.body.bjResult : [req.body.bjResult];
            const handBet = totalBet / BigInt(bjResults.length);
            winAmount = 0n;
            for (const res of bjResults) {
                if (res === 'dealerBust') winAmount += activeGadgets[4] ? handBet * 5n / 2n : handBet * 2n;
                else if (res === 'win') winAmount += handBet * 2n;
                else if (res === 'blackjack') winAmount += handBet * 5n / 2n;
                else if (res === 'push') winAmount += handBet;
            }
            resultData.reason = bjResults.join(', ');
        } else if (gameMode === 'poker') {
            const { pokerHand, pokerHeld } = req.body;
            if (!Array.isArray(pokerHand) || pokerHand.length !== 5 || !Array.isArray(pokerHeld)) {
                throw new Error("Invalid poker data");
            }
            
            const suits = ['H', 'D', 'C', 'S'];
            const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
            let deck: {suit: string, rank: string}[] = [];
            for (let s of suits) {
                for (let r of ranks) {
                    deck.push({suit: s, rank: r});
                }
            }
            deck.sort(() => Math.random() - 0.5);
            
            let finalHand: any[] = [];
            for (let i = 0; i < 5; i++) {
                if (pokerHeld[i] && pokerHand[i]) {
                    finalHand.push(pokerHand[i]);
                    deck = deck.filter(c => !(c.rank === pokerHand[i].rank && c.suit === pokerHand[i].suit));
                } else {
                    finalHand.push(null);
                }
            }
            
            for (let i = 0; i < 5; i++) {
                if (!finalHand[i]) {
                    finalHand[i] = deck.pop();
                }
            }
            
            const rankValues: Record<string, number> = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
            
            let ranksInHand = finalHand.map(c => rankValues[c.rank]).sort((a,b) => a-b);
            let suitsInHand = finalHand.map(c => c.suit);
            
            let isFlush = suitsInHand.every(s => s === suitsInHand[0]);
            let isStraight = false;
            
            if (ranksInHand[4] - ranksInHand[0] === 4 && new Set(ranksInHand).size === 5) isStraight = true;
            if (ranksInHand[4] === 14 && ranksInHand[3] === 5 && ranksInHand[2] === 4 && ranksInHand[1] === 3 && ranksInHand[0] === 2) {
                isStraight = true;
            }
            
            let counts: Record<number, number> = {};
            for (let r of ranksInHand) counts[r] = (counts[r] || 0) + 1;
            let countVals = Object.values(counts).sort((a: any, b: any) => b-a);
            
            let multiplier = 0n;
            let handName = "";
            
            if (isFlush && isStraight && ranksInHand[4] === 14 && ranksInHand[0] === 10) {
                multiplier = 800n; handName = "ROYAL FLUSH";
            } else if (isFlush && isStraight) {
                multiplier = 50n; handName = "STRAIGHT FLUSH";
            } else if (countVals[0] === 4) {
                multiplier = 25n; handName = "FOUR OF A KIND";
            } else if (countVals[0] === 3 && countVals[1] === 2) {
                multiplier = 9n; handName = "FULL HOUSE";
            } else if (isFlush) {
                multiplier = 6n; handName = "FLUSH";
            } else if (isStraight) {
                multiplier = 4n; handName = "STRAIGHT";
            } else if (countVals[0] === 3) {
                multiplier = 3n; handName = "THREE OF A KIND";
            } else if (countVals[0] === 2 && countVals[1] === 2) {
                multiplier = 2n; handName = "TWO PAIR";
            } else if (countVals[0] === 2) {
                let pairRank = parseInt(Object.keys(counts).find(k => counts[k] === 2) || "0");
                if (pairRank >= 11) {
                    multiplier = 1n; handName = "JACKS OR BETTER";
                }
            }
            
            winAmount = multiplier > 0n ? totalBet * multiplier : 0n;
            resultData = { finalHand, handName };
        } else if (gameMode === 'crash_start') {
            // Generate a random crash point with a slight house edge
            // e.g., Crash Point = 1.0 / Random(0..1) with a 5% instant crash chance
            let crashPoint = 1.0;
            if (Math.random() >= 0.05) {
                crashPoint = parseFloat((1.00 / Math.random()).toFixed(2));
            }
            if (crashPoint > 1000) crashPoint = 1000;
            activeCrashGames.set(user.id, { betAmount: totalBet, crashPoint });
            winAmount = 0n;
            resultData.crashPoint = crashPoint;
        } else if (gameMode === 'crash_cashout') {
            const activeGame = activeCrashGames.get(user.id);
            if (!activeGame) return res.status(400).json({ error: "No active crash game" });
            activeCrashGames.delete(user.id);
            
            const requestedMultiplier = Number(req.body.multiplier);
            if (requestedMultiplier <= activeGame.crashPoint) {
                winAmount = BigInt(Math.round(Number(activeGame.betAmount) * requestedMultiplier));
                resultData.winAmount = winAmount.toString();
                resultData.status = 'win';
            } else {
                winAmount = 0n;
                resultData.status = 'crash';
            }
            totalBet = 0n; // Bet was already deducted in crash_start
        } else if (gameMode === 'hilo_start') {
            const ranks = [
                { r: '2', v: 2 }, { r: '3', v: 3 }, { r: '4', v: 4 }, { r: '5', v: 5 },
                { r: '6', v: 6 }, { r: '7', v: 7 }, { r: '8', v: 8 }, { r: '9', v: 9 },
                { r: '10', v: 10 }, { r: 'J', v: 11 }, { r: 'Q', v: 12 }, { r: 'K', v: 13 }, { r: 'A', v: 14 }
            ];
            
            const getRankWeight = (v: number) => {
                if (v >= 6 && v <= 9) return 100;
                return 0;
            };

            const totalWeight = ranks.reduce((sum, rank) => sum + getRankWeight(rank.v), 0);
            let randomWeight = Math.floor(Math.random() * totalWeight);
            let selectedRank = ranks[0];
            
            for (const rank of ranks) {
                const weight = getRankWeight(rank.v);
                if (randomWeight < weight) {
                    selectedRank = rank;
                    break;
                }
                randomWeight -= weight;
            }

            const suits = ['S', 'H', 'D', 'C'];
            const firstCard = { 
                rank: selectedRank,
                suit: suits[Math.floor(Math.random() * suits.length)]
            };
            const cardObj = { rank: firstCard.rank.r, suit: firstCard.suit, value: firstCard.rank.v };
            
            activeHiloGames.set(user.id, { betAmount: totalBet, firstCard: cardObj });
            winAmount = 0n;
            resultData.firstCard = cardObj;
        } else if (gameMode === 'hilo_guess') {
            const activeGame = activeHiloGames.get(user.id);
            if (!activeGame) return res.status(400).json({ error: "No active hilo game" });
            activeHiloGames.delete(user.id);
            
            const guess = req.body.guess; // 'higher' or 'lower'
            const ranks = [
                { r: '2', v: 2 }, { r: '3', v: 3 }, { r: '4', v: 4 }, { r: '5', v: 5 },
                { r: '6', v: 6 }, { r: '7', v: 7 }, { r: '8', v: 8 }, { r: '9', v: 9 },
                { r: '10', v: 10 }, { r: 'J', v: 11 }, { r: 'Q', v: 12 }, { r: 'K', v: 13 }, { r: 'A', v: 14 }
            ];
            const suits = ['S', 'H', 'D', 'C'];
            const secondCard = { 
                rank: ranks[Math.floor(Math.random() * ranks.length)],
                suit: suits[Math.floor(Math.random() * suits.length)]
            };
            const cardObj = { rank: secondCard.rank.r, suit: secondCard.suit, value: secondCard.rank.v };
            
            let won = false;
            let push = false;
            if (cardObj.value === activeGame.firstCard.value) push = true;
            else if (guess === 'higher' && cardObj.value > activeGame.firstCard.value) won = true;
            else if (guess === 'lower' && cardObj.value < activeGame.firstCard.value) won = true;

            if (push) {
                winAmount = activeGame.betAmount; // Refund
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
            totalBet = 0n; // Bet was already deducted
        } else if (gameMode === 'mines_start') {
            const rawMines = Number(req.body.mineCount) || 3;
            const mineCount = Math.max(1, Math.min(24, rawMines));
            
            // Pick unique random mine positions from 0 to 24
            const allIndices = Array.from({ length: 25 }, (_, i) => i);
            for (let i = allIndices.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
            }
            const mines = allIndices.slice(0, mineCount);
            
            activeMinesGames.set(user.id, {
                betAmount: totalBet,
                mineCount,
                mines,
                revealed: [],
                currentMultiplier: 1.0
            });
            
            winAmount = 0n;
            resultData = {
                status: 'started',
                mineCount,
                totalTiles: 25
            };
        } else if (gameMode === 'mines_pick') {
            const activeGame = activeMinesGames.get(user.id);
            if (!activeGame) return res.status(400).json({ error: "No active mines game" });
            
            const tileIndex = Number(req.body.tileIndex);
            if (isNaN(tileIndex) || tileIndex < 0 || tileIndex >= 25) {
                return res.status(400).json({ error: "Invalid tile index" });
            }
            if (activeGame.revealed.includes(tileIndex)) {
                return res.status(400).json({ error: "Tile already revealed" });
            }
            
            const totalTiles = 25;
            const safeTiles = totalTiles - activeGame.mineCount;
            
            if (activeGame.mines.includes(tileIndex)) {
                // Hit a mine!
                activeMinesGames.delete(user.id);
                winAmount = 0n;
                resultData = {
                    status: 'bomb',
                    hitIndex: tileIndex,
                    mines: activeGame.mines,
                    revealed: activeGame.revealed,
                    winAmount: "0"
                };
                totalBet = 0n; // Bet was already deducted at start
            } else {
                // Safe tile!
                activeGame.revealed.push(tileIndex);
                const k = activeGame.revealed.length;
                
                // Multiplier calculation with 97% RTP
                let prob = 1.0;
                for (let i = 0; i < k; i++) {
                    prob *= (safeTiles - i) / (totalTiles - i);
                }
                const mult = Math.max(1.01, parseFloat((0.97 / prob).toFixed(2)));
                activeGame.currentMultiplier = mult;
                
                // Next tile multiplier
                let nextMult = mult;
                if (k < safeTiles) {
                    let nextProb = 1.0;
                    for (let i = 0; i < k + 1; i++) {
                        nextProb *= (safeTiles - i) / (totalTiles - i);
                    }
                    nextMult = Math.max(1.02, parseFloat((0.97 / nextProb).toFixed(2)));
                }
                
                const isCleared = activeGame.revealed.length >= safeTiles;
                if (isCleared) {
                    winAmount = BigInt(Math.round(Number(activeGame.betAmount) * mult));
                    activeMinesGames.delete(user.id);
                    resultData = {
                        status: 'cleared',
                        tileIndex,
                        mines: activeGame.mines,
                        revealed: activeGame.revealed,
                        currentMultiplier: mult,
                        winAmount: winAmount.toString()
                    };
                } else {
                    winAmount = 0n;
                    resultData = {
                        status: 'safe',
                        tileIndex,
                        revealedCount: k,
                        currentMultiplier: mult,
                        nextMultiplier: nextMult,
                        potentialWin: (BigInt(Math.round(Number(activeGame.betAmount) * mult))).toString()
                    };
                }
                totalBet = 0n;
            }
        } else if (gameMode === 'mines_cashout') {
            const activeGame = activeMinesGames.get(user.id);
            if (!activeGame) return res.status(400).json({ error: "No active mines game" });
            if (activeGame.revealed.length === 0) return res.status(400).json({ error: "Cannot cashout without uncovering a tile" });
            
            activeMinesGames.delete(user.id);
            winAmount = BigInt(Math.round(Number(activeGame.betAmount) * activeGame.currentMultiplier));
            resultData = {
                status: 'cashout',
                mines: activeGame.mines,
                revealed: activeGame.revealed,
                finalMultiplier: activeGame.currentMultiplier,
                winAmount: winAmount.toString()
            };
            totalBet = 0n;
        } else if (gameMode === 'cases') {
            const caseType = req.body.caseType; 
            const cost = CASE_COSTS[caseType] || 0n;
            if (currentBananas < cost) return res.status(400).json({ error: "Not enough bananas" });
            const r = Math.random() * 100;
            let rarity = 'Common';
            
            if (caseType === 'void') {
                // 10B Void Case: 4.5% Ominous, 40.5% Legendary, 40% Mythic, 15% Epic
                if (r < 4.5) rarity = 'Ominous';
                else if (r < 45.0) rarity = 'Legendary';
                else if (r < 85.0) rarity = 'Mythic';
                else rarity = 'Epic';
            } else if (caseType === 'abyssal') {
                // 750M Abyssal Case: 1.5% Ominous, 28.5% Legendary, 40% Mythic, 30% Epic
                if (r < 1.5) rarity = 'Ominous';
                else if (r < 30.0) rarity = 'Legendary';
                else if (r < 70.0) rarity = 'Mythic';
                else rarity = 'Epic';
            } else if (caseType === 'cosmic') {
                // 50M Cosmic Case: 0.5% Ominous, 14.5% Legendary, 35% Mythic, 35% Epic, 15% Rare
                if (r < 0.5) rarity = 'Ominous';
                else if (r < 15.0) rarity = 'Legendary';
                else if (r < 50.0) rarity = 'Mythic';
                else if (r < 85.0) rarity = 'Epic';
                else rarity = 'Rare';
            } else if (caseType === 'toverland') {
                // 2M Toverland Case: 0.05% Ominous, 5.95% Legendary, 18% Mythic, 36% Epic, 30% Rare, 10% Common
                if (r < 0.05) rarity = 'Ominous';
                else if (r < 6.0) rarity = 'Legendary';
                else if (r < 24.0) rarity = 'Mythic';
                else if (r < 60.0) rarity = 'Epic';
                else if (r < 90.0) rarity = 'Rare';
                else rarity = 'Common';
            } else if (caseType === 'jungle') {
                // 500K Jungle Case: 2.5% Legendary, 10% Mythic, 25% Epic, 40% Rare, 22.5% Common
                if (r < 2.5) rarity = 'Legendary';
                else if (r < 12.5) rarity = 'Mythic';
                else if (r < 37.5) rarity = 'Epic';
                else if (r < 77.5) rarity = 'Rare';
                else rarity = 'Common';
            } else if (caseType === 'booster') {
                // 100K Booster Case
                if (r < 1.0) rarity = 'Legendary';
                else if (r < 5.0) rarity = 'Mythic';
                else if (r < 20.0) rarity = 'Epic';
                else if (r < 60.0) rarity = 'Rare';
                else rarity = 'Common';
            } else {
                // 10K Normal Case
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
            newInventory[selectedSkin.id] = (newInventory[selectedSkin.id] || 0) + 1;
            resultData.skin = selectedSkin;
            resultData.rarity = rarity;
            resultData.cost = String(cost);
        }

        // --- MEGA BET GADGET (GLOBAL) ---
        // User: "All-in risk: 25% chance for 100x win, 25% chance to lose all (Taxes)."
        // Triggers on any traditional game win > 0 if gadget index 5 is active.
        const isPushOutcome = resultData.status === 'push' || resultData.reason === 'push';
        if (gameMode !== 'cases' && winAmount > 0n && !isPushOutcome && activeGadgets[5]) {
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

        // Update balance
        let isWin = false;
        let isPush = false;
        
        if (gameMode !== 'cases') {
            isWin = winAmount > totalBet;
            isPush = winAmount === totalBet;
            
            // Failsafe Gadget (Index 0)
            if (!isWin && !isPush && totalBet >= 100n && activeGadgets[0]) {
                if (Math.random() < 0.25) {
                    winAmount = totalBet;
                    resultData.failsafeActivated = true;
                }
            }
            
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

        if (taxPenalty && winAmount > totalBet && gameMode !== 'cases') {
            const profit = winAmount - totalBet;
            winAmount = totalBet + (profit / 2n);
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

// Get Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { userId } = req.query;
    const supabase = getSupabase();
    
    // 1. Fetch Top 50
    // We query the 'database' table directly to ensure 100% accuracy
    const { data: top50, error: top50Error } = await supabase
      .from('database')
      .select('id, name, score, level, coins, equipped_title, updated_at')
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
          .select('id, name, score, level, coins, equipped_title, updated_at')
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
              currentSupply[skinId] = (currentSupply[skinId] || 0) + Number(count);
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
});

function calculateTradeValue(skins: string[]) {
  return skins.reduce((total, id) => {
    const rarity = SKINS_METADATA[id] || 'Common';
    const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
    // 1. Try dynamic value from DB
    if (DYNAMIC_SKIN_VALUES[id] !== undefined) {
      return total + Math.max(minVal, DYNAMIC_SKIN_VALUES[id]);
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

    // RULE: Skin values increase when traded
    const tradedSkinIds = [...senderSkins, ...receiverSkins];
    for (const sid of tradedSkinIds) {
      const rarity = SKINS_METADATA[sid] || 'Common';
      const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
      const curr = Math.max(minVal, DYNAMIC_SKIN_VALUES[sid] || minVal);
      let tradeBoost = 0;
      if (rarity === 'Ominous') tradeBoost = 2500000000;
      else if (rarity === 'Legendary') tradeBoost = 1000000;
      else if (rarity === 'Mythic') tradeBoost = 250000;
      else if (rarity === 'Epic') tradeBoost = 25000;
      else if (rarity === 'Rare') tradeBoost = 2500;
      else tradeBoost = 250;
      
      const newV = curr + tradeBoost;
      DYNAMIC_SKIN_VALUES[sid] = newV;
      try {
        await supabase.from('skin_values').upsert({ id: sid, value: newV });
      } catch (e) {}
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to boost skin value when sold
app.post("/api/skin/sell", authenticateToken, async (req: any, res) => {
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: "Missing skinId" });
  try {
    const supabase = getSupabase();
    const rarity = SKINS_METADATA[skinId] || 'Common';
    const minVal = rarity === 'Ominous' ? 100000000000 : (DEFAULT_RARITY_VALUES[rarity] || 1000);
    const curr = Math.max(minVal, DYNAMIC_SKIN_VALUES[skinId] || minVal);
    let boost = 0;
    if (rarity === 'Ominous') boost = 5000000000;
    else if (rarity === 'Legendary') boost = 2000000;
    else if (rarity === 'Mythic') boost = 500000;
    else if (rarity === 'Epic') boost = 50000;
    else if (rarity === 'Rare') boost = 5000;
    else boost = 500;
    
    const newV = curr + boost;
    DYNAMIC_SKIN_VALUES[skinId] = newV;
    try {
      await supabase.from('skin_values').upsert({ id: skinId, value: newV });
    } catch (e) {}
    res.json({ success: true, newValue: newV });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to drop skin value when sold in dungeon (the way it used to drop)
app.post("/api/skin/dungeon-sell", authenticateToken, async (req: any, res) => {
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: "Missing skinId" });
  try {
    const supabase = getSupabase();
    const rarity = SKINS_METADATA[skinId] || 'Common';
    const minCap = rarity === 'Ominous' ? 100000000000 : Math.floor((DEFAULT_RARITY_VALUES[rarity] || 1000) * 0.1);
    const curr = Math.max(minCap, DYNAMIC_SKIN_VALUES[skinId] || DEFAULT_RARITY_VALUES[rarity] || 1000);
    
    let drop = 1500;
    if (rarity === 'Ominous') drop = 5000000000;
    else if (rarity === 'Legendary') drop = 15000000;
    else if (rarity === 'Mythic') drop = 5000000;
    else if (rarity === 'Epic') drop = 150000;
    else if (rarity === 'Rare') drop = 15000;
    else if (rarity === 'Common') drop = 1500;

    const newV = Math.max(minCap, curr - drop);
    DYNAMIC_SKIN_VALUES[skinId] = newV;
    try {
      await supabase.from('skin_values').upsert({ id: skinId, value: newV });
    } catch (e) {}
    res.json({ success: true, newValue: newV, droppedBy: drop });
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

// 2. Create poker table
app.post("/api/poker/tables/create", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { name, buyIn, smallBlind, bigBlind, isVsBot } = req.body;

    try {
        const supabase = getSupabase();
        const { data: user, error: userError } = await supabase.from('database').select('id, name, score').eq('id', userId).maybeSingle();
        if (userError || !user) return res.status(404).json({ error: "User not found. Please log in again." });

        const buyInNum = Math.max(10, Math.floor(Number(buyIn)) || 1000);
        const userBananas = Number(user.score || 0);

        if (userBananas < buyInNum) {
            return res.status(400).json({ error: `Not enough bananas! You have ${userBananas} 🍌 but need ${buyInNum} 🍌.` });
        }

        // Deduct buy-in from score
        const newBalance = userBananas - buyInNum;
        await supabase.from('database').update({ score: newBalance }).eq('id', userId);

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
        const sb = Number(smallBlind) && Number(smallBlind) > 0 ? Number(smallBlind) : defaultSb;
        const bb = Number(bigBlind) && Number(bigBlind) >= sb ? Number(bigBlind) : (sb * 2);

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

        activePokerTables.set(tableId, table);
        syncPokerTableDb(table).catch(() => {});

        res.json({ success: true, table, newBalance });
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

        const userBananas = Number(user.score || 0);
        if (userBananas < table.buy_in) {
            return res.status(400).json({ error: `Not enough bananas to buy in! Requires ${table.buy_in} 🍌.` });
        }

        // Deduct buy-in from score
        const newBalance = userBananas - table.buy_in;
        await supabase.from('database').update({ score: newBalance }).eq('id', userId);

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
        res.json({ success: true, table, newBalance });
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
        const refundChips = leavingPlayer.chips;

        // Refund remaining chips to score
        const supabase = getSupabase();
        const { data: user } = await supabase.from('database').select('score').eq('id', userId).maybeSingle();
        let newBalance = Number(user?.score || 0);
        if (refundChips > 0) {
            newBalance += refundChips;
            await supabase.from('database').update({ score: newBalance }).eq('id', userId);
        }

        table.players.splice(playerIdx, 1);
        table.round_history.push(`${leavingPlayer.name} left with ${refundChips} 🍌`);

        if (table.players.filter(p => !p.isBot).length === 0) {
            // No humans left, destroy table
            activePokerTables.delete(tableId);
            try {
                await supabase.from('poker_tables').delete().eq('id', tableId);
            } catch (err) {}
        } else {
            if (leavingPlayer.isHost && table.players.length > 0) {
                // Pass host to next human
                const nextHuman = table.players.find(p => !p.isBot) || table.players[0];
                nextHuman.isHost = true;
                table.host_id = nextHuman.id;
                table.host_name = nextHuman.name;
            }
            syncPokerTableDb(table).catch(() => {});
        }

        res.json({ success: true, refunded: refundChips, newBalance });
    } catch (e: any) {
        console.error("Poker table leave error:", e);
        res.status(500).json({ error: e.message || "Failed to leave table" });
    }
});

// 5. Start poker match (Host initiates; client host generates community cards & deals cards)
app.post("/api/poker/tables/start", authenticateToken, async (req: any, res) => {
    const userId = req.user.userId;
    const { tableId, hostCommunityCards, hostPlayerCards } = req.body;

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });
        if (table.host_id !== userId) return res.status(403).json({ error: "Only the table host can start the game" });

        // REQUIREMENT:
        // "There has to be atleast 5 players, are there 3 players in a table, the last 2 will be bots.
        // If you go more than 5 players (humans), no bots will be added. Simple as that."
        const humanCount = table.players.filter(p => !p.isBot).length;
        if (humanCount < 5) {
            const botsNeeded = 5 - humanCount;
            let availableBotNames = BOT_NAMES.filter(bName => !table.players.some(p => p.name === bName));
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

        // Deal cards: The 5 community cards generated by the table host client
        if (Array.isArray(hostCommunityCards) && hostCommunityCards.length === 5) {
            table.community_cards = hostCommunityCards;
        } else {
            // Backup card generator if host payload was omitted
            const suits = ['H', 'D', 'C', 'S'];
            const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
            const deck: PokerCard[] = [];
            suits.forEach(s => ranks.forEach(r => deck.push({ rank: r, suit: s, value: getRankVal(r) })));
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            table.community_cards = deck.splice(0, 5);
        }

        // Assign 2 hole cards to each seated player
        if (hostPlayerCards && typeof hostPlayerCards === 'object') {
            table.players.forEach(p => {
                if (hostPlayerCards[p.id] && Array.isArray(hostPlayerCards[p.id]) && hostPlayerCards[p.id].length === 2) {
                    p.cards = hostPlayerCards[p.id];
                }
            });
        }
        
        // Fill any unassigned player cards
        const usedCards = new Set([...table.community_cards.map(c => `${c.rank}${c.suit}`)]);
        table.players.forEach(p => {
            p.cards.forEach(c => usedCards.add(`${c.rank}${c.suit}`));
        });
        const fullDeck: PokerCard[] = [];
        ['H', 'D', 'C', 'S'].forEach(s => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].forEach(r => {
            if (!usedCards.has(`${r}${s}`)) {
                fullDeck.push({ rank: r, suit: s, value: getRankVal(r) });
            }
        }));
        for (let i = fullDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
        }
        table.players.forEach(p => {
            if (!p.cards || p.cards.length < 2) {
                p.cards = [fullDeck.pop()!, fullDeck.pop()!];
            }
            p.folded = false;
            p.isAllIn = false;
            p.currentBet = 0;
        });

        // Initialize betting state & blinds
        table.status = 'in_progress';
        table.stage = 'preflop';
        table.pot = 0;
        table.acted_in_round = [];
        table.winners = [];

        // Rotate dealer button
        table.dealer_seat = (table.dealer_seat + 1) % table.players.length;

        // Post Small Blind and Big Blind
        const sbPlayer = table.players[(table.dealer_seat + 1) % table.players.length];
        const bbPlayer = table.players[(table.dealer_seat + 2) % table.players.length];

        const sbPay = Math.min(sbPlayer.chips, table.small_blind);
        sbPlayer.chips -= sbPay;
        sbPlayer.currentBet = sbPay;
        table.pot += sbPay;

        const bbPay = Math.min(bbPlayer.chips, table.big_blind);
        bbPlayer.chips -= bbPay;
        bbPlayer.currentBet = bbPay;
        table.pot += bbPay;

        table.current_bet = table.big_blind;

        // First player to act preflop (Under The Gun)
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

        // If the first turn player is a bot, execute bot action
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

    try {
        const table = activePokerTables.get(tableId);
        if (!table) return res.status(404).json({ error: "Table not found" });
        if (table.status !== 'in_progress') return res.status(400).json({ error: "Game is not currently active" });
        if (table.active_turn_player_id !== userId) return res.status(400).json({ error: "It is not your turn to act!" });

        const player = table.players.find(p => p.id === userId);
        if (!player || player.folded || player.isAllIn) return res.status(400).json({ error: "Player cannot act" });

        applyPlayerAction(table, player, action, Number(amount) || 0);
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
