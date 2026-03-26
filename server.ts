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
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Supabase Setup (Lazy Initialization)
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!url || !key) {
      throw new Error("CRITICAL ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables. Please add them to your Render dashboard.");
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
    
    // Check if user is banned
    const supabase = getSupabase();
    supabase.from('database').select('banned').eq('id', user.userId).maybeSingle()
      .then(({ data: userData }: any) => {
        if (userData && userData.banned) {
          return res.status(403).json({ error: "Account banned for cheating" });
        }
        req.user = user;
        next();
      })
      .catch((e: any) => {
        console.error("Error checking ban status:", e);
        // If database check fails, we still allow the request but log the error
        req.user = user;
        next();
      });
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
  const { userId, name, score, coins, bananaBox, trees, gadgets, level, xp, unlocked_titles, equipped_title } = req.body;

  if (req.user.userId !== userId) {
    return res.status(403).json({ error: "Cannot save data for another user" });
  }

  try {
    const supabase = getSupabase();
    // Optimistic Concurrency Control: Check if the score on server matches what client expects
    const { data: current, error: fetchError } = await supabase
      .from('database')
      .select('score, coins, unlocked_titles')
      .eq('id', userId)
      .maybeSingle();

    const { expectedScore, expectedCoins } = req.body;
    
    if (current && expectedScore !== undefined && expectedCoins !== undefined && expectedScore !== -1 && expectedCoins !== -1) {
        if (Number(current.score) !== Number(expectedScore) || Number(current.coins) !== Number(expectedCoins)) {
            // External change detected, return current data instead of overwriting
            const { data: fullUser } = await supabase.from('database').select('*').eq('id', userId).maybeSingle();
            const { password: _, ...userData } = fullUser;
            return res.json({ success: false, error: "External change detected", user: userData });
        }
    }

    // Merge unlocked_titles to prevent overwriting manual admin edits
    let finalUnlockedTitles = unlocked_titles || [];
    if (current && current.unlocked_titles) {
        const serverTitles = typeof current.unlocked_titles === 'string' ? JSON.parse(current.unlocked_titles) : current.unlocked_titles;
        if (Array.isArray(serverTitles)) {
            // Keep all server titles (including manually added ones) and add any new ones from client
            finalUnlockedTitles = Array.from(new Set([...serverTitles, ...finalUnlockedTitles]));
        }
    }

    const { error } = await supabase.from('database').upsert({
      id: userId,
      name,
      score,
      coins,
      banana_box: bananaBox || 0,
      trees: JSON.stringify(trees),
      gadgets: JSON.stringify(gadgets),
      level,
      xp,
      unlocked_titles: JSON.stringify(finalUnlockedTitles),
      equipped_title: equipped_title || null,
      updated_at: new Date().toISOString()
    });

    if (error) throw error;
    
    // Fetch and return the updated data to ensure client is in sync
    const { data: updatedUser, error: finalFetchError } = await supabase
      .from('database')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
      
    if (finalFetchError || !updatedUser) {
        res.json({ success: true });
    } else {
        const { password: _, ...userData } = updatedUser;
        res.json({ success: true, user: userData });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Ban User
app.post("/api/ban", authenticateToken, async (req: any, res) => {
  const { userId } = req.body;
  if (req.user.userId !== userId) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();
    await supabase.from('database').update({ banned: true }).eq('id', userId);
    res.json({ success: true, message: "User banned successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- GAME LOGIC ENDPOINTS ---

const SLOT_ICONS = ['🍌', '🍒', '🍋', '🔔', '💎', '7️⃣'];
const JACKPOT_ICON = '7️⃣';

// Roulette
app.post("/api/game/roulette", authenticateToken, async (req: any, res) => {
  const { userId, betAmount, betColor, gadgets } = req.body;
  if (req.user.userId !== userId) return res.status(403).json({ error: "Unauthorized" });

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, xp, level').eq('id', userId).maybeSingle();
    if (!user || user.score < betAmount) return res.status(400).json({ error: "Insufficient balance" });

    const rand = Math.random();
    const pRed = gadgets && gadgets[1] ? 0.42 : 0.46;
    const pBlack = gadgets && gadgets[1] ? 0.42 : 0.46;
    
    let winningColor;
    if (rand < pRed) winningColor = 'red';
    else if (rand < pRed + pBlack) winningColor = 'black';
    else winningColor = 'green';

    let winAmount = 0;
    if (betColor === winningColor) {
      const mult = winningColor === 'green' ? 3 : 1;
      winAmount = betAmount * mult;
    } else {
      winAmount = -betAmount;
    }

    let newScore = Number(user.score);
    let newXp = Number(user.xp);
    let newLevel = Number(user.level);

    if (winAmount > 0) {
      const bonus = Math.floor(winAmount * (newLevel - 1) * 0.05);
      const totalWin = winAmount + bonus;
      newScore += totalWin;
      
      // Update XP
      const xpGain = Math.floor(totalWin / 10);
      newXp += xpGain;
      
      // Check level up
      while (newXp >= newLevel * 1000) {
        newXp -= newLevel * 1000;
        newLevel++;
      }
      winAmount = totalWin; // Return total win including bonus
    } else {
      newScore += winAmount; // winAmount is negative here
    }

    await supabase.from('database').update({ 
      score: newScore,
      xp: newXp,
      level: newLevel
    }).eq('id', userId);

    res.json({ success: true, winningColor, winAmount, newScore, newXp, newLevel });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Slots
app.post("/api/game/slots", authenticateToken, async (req: any, res) => {
  const { userId, betAmount, isBonusBet, bonusBetAmount, bonusBetSelection } = req.body;
  if (req.user.userId !== userId) return res.status(403).json({ error: "Unauthorized" });

  const totalBet = betAmount + (isBonusBet ? bonusBetAmount : 0);

  try {
    const supabase = getSupabase();
    const { data: user } = await supabase.from('database').select('score, xp, level').eq('id', userId).maybeSingle();
    if (!user || user.score < totalBet) return res.status(400).json({ error: "Insufficient balance" });

    let r = Math.random() * 105;
    let outcome, resultSlots = [];
    
    if (r < 45) { 
      outcome = 'lose';
      let temp = [...SLOT_ICONS].sort(() => Math.random() - 0.5);
      resultSlots = [temp[0], temp[1], temp[2]];
    } else if (r < 75) { 
      outcome = 'partial';
      let icon = SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)];
      let other = SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)];
      while (other === icon) other = SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)];
      resultSlots = [icon, icon, other].sort(() => Math.random() - 0.5);
    } else if (r < 98) { 
      outcome = 'win';
      let icon = SLOT_ICONS[Math.floor(Math.random() * SLOT_ICONS.length)];
      resultSlots = [icon, icon, icon];
    } else { 
      outcome = 'jackpot';
      resultSlots = [JACKPOT_ICON, JACKPOT_ICON, JACKPOT_ICON];
    }

    let bonusWin = false;
    if (isBonusBet && bonusBetAmount > 0 && bonusBetSelection) {
      if (resultSlots[0] === bonusBetSelection[0] && 
          resultSlots[1] === bonusBetSelection[1] && 
          resultSlots[2] === bonusBetSelection[2]) {
        bonusWin = true;
      }
    }

    let netProfit = 0;
    if (outcome === 'partial') netProfit += Math.round(betAmount * 0.5);
    else if (outcome === 'win') netProfit += betAmount * 2;
    else if (outcome === 'jackpot') netProfit += betAmount * 14;
    else netProfit -= betAmount;

    if (bonusWin) netProfit += bonusBetAmount * 19;
    else if (isBonusBet) netProfit -= bonusBetAmount;

    let newScore = Number(user.score);
    let newXp = Number(user.xp);
    let newLevel = Number(user.level);

    if (netProfit > 0) {
      const bonus = Math.floor(netProfit * (newLevel - 1) * 0.05);
      const totalWin = netProfit + bonus;
      newScore += totalWin;
      
      // Update XP
      const xpGain = Math.floor(totalWin / 10);
      newXp += xpGain;
      
      // Check level up
      while (newXp >= newLevel * 1000) {
        newXp -= newLevel * 1000;
        newLevel++;
      }
      netProfit = totalWin; // Return total win including bonus
    } else {
      newScore += netProfit; // netProfit is negative here
    }

    await supabase.from('database').update({ 
      score: newScore,
      xp: newXp,
      level: newLevel
    }).eq('id', userId);

    res.json({ success: true, outcome, resultSlots, bonusWin, netProfit, newScore, newXp, newLevel });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
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

// Get Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    console.log("Fetching leaderboard...");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id, name, score, level, coins, equipped_title')
      .order('score', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase leaderboard error:", error);
      throw error;
    }
    console.log(`Leaderboard fetched: ${data?.length || 0} entries`);
    res.json(data || []);
  } catch (error: any) {
    console.error("Leaderboard API error:", error);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
