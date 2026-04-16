-- Full Migration to ensure all columns exist in the database table
-- This script adds columns if they are missing and updates the sync function

-- 1. Add missing columns to public.database
ALTER TABLE public.database ADD COLUMN IF NOT EXISTS banana_box BIGINT DEFAULT 0;
ALTER TABLE public.database ADD COLUMN IF NOT EXISTS unlocked_titles TEXT DEFAULT '[]';
ALTER TABLE public.database ADD COLUMN IF NOT EXISTS equipped_title TEXT DEFAULT NULL;
ALTER TABLE public.database ADD COLUMN IF NOT EXISTS inventory TEXT DEFAULT '{}';

-- 2. Add missing columns to public.leaderboard
ALTER TABLE public.leaderboard ADD COLUMN IF NOT EXISTS equipped_title TEXT DEFAULT NULL;

-- 3. Update the sync function to include all relevant fields
CREATE OR REPLACE FUNCTION public.sync_to_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.leaderboard (id, name, score, level, coins, equipped_title, updated_at)
    VALUES (NEW.id, NEW.name, NEW.score, NEW.level, NEW.coins, NEW.equipped_title, NEW.updated_at)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        coins = EXCLUDED.coins,
        equipped_title = EXCLUDED.equipped_title,
        updated_at = EXCLUDED.updated_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Re-sync existing data to the leaderboard
INSERT INTO public.leaderboard (id, name, score, level, coins, equipped_title, updated_at)
SELECT id, name, score, level, coins, equipped_title, updated_at FROM public.database
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    score = EXCLUDED.score,
    level = EXCLUDED.level,
    coins = EXCLUDED.coins,
    equipped_title = EXCLUDED.equipped_title,
    updated_at = EXCLUDED.updated_at;
