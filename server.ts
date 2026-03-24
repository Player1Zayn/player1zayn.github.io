import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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

  try {
    const supabase = getSupabase();
    // Check if user exists
    const { data: existing } = await supabase.from('leaderboard').select('id').eq('name', name).maybeSingle();
    if (existing) {
      return res.status(400).json({ error: "Name already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error } = await supabase.from('leaderboard').insert({
      id,
      name,
      password: hashedPassword,
      score: 0,
      coins: 0,
      level: 1,
      xp: 0,
      trees: JSON.stringify([1, ...Array(19).fill(0)]),
      gadgets: JSON.stringify(Array(10).fill(false)),
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
    const { data: user, error } = await supabase.from('leaderboard').select('*').eq('name', name).maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
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
  const { userId, name, score, coins, trees, gadgets, level, xp } = req.body;

  if (req.user.userId !== userId) {
    return res.status(403).json({ error: "Cannot save data for another user" });
  }

  try {
    const supabase = getSupabase();
    // Optimistic Concurrency Control: Check if the score on server matches what client expects
    const { data: current, error: fetchError } = await supabase
      .from('leaderboard')
      .select('score, coins')
      .eq('id', userId)
      .maybeSingle();

    const { expectedScore, expectedCoins } = req.body;
    
    if (current && expectedScore !== undefined && expectedCoins !== undefined) {
        if (Number(current.score) !== Number(expectedScore) || Number(current.coins) !== Number(expectedCoins)) {
            // External change detected, return current data instead of overwriting
            const { data: fullUser } = await supabase.from('leaderboard').select('*').eq('id', userId).maybeSingle();
            const { password: _, ...userData } = fullUser;
            return res.json({ success: false, error: "External change detected", user: userData });
        }
    }

    const { error } = await supabase.from('leaderboard').upsert({
      id: userId,
      name,
      score,
      coins,
      trees: JSON.stringify(trees),
      gadgets: JSON.stringify(gadgets),
      level,
      xp,
      updated_at: new Date().toISOString()
    });

    if (error) throw error;
    
    // Fetch and return the updated data to ensure client is in sync
    const { data: updatedUser, error: finalFetchError } = await supabase
      .from('leaderboard')
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
  // Ban feature temporarily disabled as requested
  res.json({ success: true, message: "Ban feature is currently disabled" });
});

// Get Current User Data
app.get("/api/me", authenticateToken, async (req: any, res) => {
  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('leaderboard')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ error: "User not found" });

    // Don't send password back to client
    const { password: _, ...userData } = user;
    res.json(userData);
  } catch (error: any) {
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
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id, name, score, level, coins')
      .order('score', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- VITE MIDDLEWARE ---

async function startServer() {
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
