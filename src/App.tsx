/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { createClient, User } from '@supabase/supabase-js';
import { 
  Gamepad2, 
  Terminal, 
  Clock, 
  MessageSquare, 
  Send, 
  CheckCircle, 
  UserX, 
  Trash2,
  Skull,
  Truck,
  Crosshair,
  Car,
  Sword,
  Activity,
  Trees,
  Wind,
  Heart,
  Crown,
  Flashlight,
  Hammer,
  Zap,
  Milestone,
  Bot,
  Ghost,
  Anchor,
  Banana,
  LogOut,
  User as UserIcon,
  ShieldCheck,
  Lock,
  Mail,
  UserPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const SUPABASE_URL = 'https://bqdbgsvcrpjqxflhupsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ElL56Wu9aJJppRv-ECWLbw_K_CfLWwk';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Game {
  id: number;
  name: string;
  color: string;
  icon: any;
}

interface ChatMessage {
  id: string;
  username: string;
  text: string;
  user_id: string;
  created_at: string;
  verified: boolean;
  is_mod: boolean;
}

const games: Game[] = [
  { id: 1, name: "Last Defence", color: "from-blue-500 to-cyan-400", icon: Skull },
  { id: 2, name: "Tank Survival", color: "from-green-500 to-emerald-400", icon: Truck },
  { id: 3, name: "Retro Bowl (new)", color: "from-red-500 to-orange-400", icon: Crosshair },
  { id: 4, name: "Escape Road", color: "from-purple-500 to-pink-400", icon: Car },
  { id: 5, name: "FPS (not working)", color: "from-gray-600 to-gray-400", icon: Sword },
  { id: 6, name: "Snakey", color: "from-yellow-500 to-orange-400", icon: Activity },
  { id: 7, name: "The Backrooms", color: "from-indigo-500 to-purple-400", icon: Trees },
  { id: 8, name: "Zelda (new)", color: "from-slate-500 to-zinc-400", icon: Wind },
  { id: 9, name: "Clanker Defence", color: "from-rose-500 to-red-400", icon: Heart },
  { id: 10, name: "Clash Royale Clone", color: "from-amber-500 to-yellow-300", icon: Crown },
  { id: 11, name: "Night Horror", color: "from-yellow-400 to-yellow-600", icon: Flashlight },
  { id: 12, name: "RPS Online", color: "from-blue-600 to-blue-800", icon: Hammer },
  { id: 13, name: "Geometry Dash", color: "from-lime-400 to-lime-600", icon: Ghost },
  { id: 14, name: "Super Mario 64", color: "from-fuchsia-500 to-purple-600", icon: Zap },
  { id: 15, name: "Monkey Mart", color: "from-slate-300 to-slate-500", icon: Milestone },
  { id: 16, name: "Snow Rider", color: "from-orange-300 to-orange-500", icon: Bot },
  { id: 17, name: "Baldis Basics", color: "from-indigo-900 to-purple-900", icon: Ghost },
  { id: 18, name: "Bacon May Die", color: "from-blue-800 to-blue-900", icon: Anchor },
  { id: 19, name: "Banana Casino", color: "from-sky-400 to-sky-200", icon: Banana },
  { id: 20, name: "Night Horror 2: Asylum", color: "from-teal-400 to-emerald-500", icon: Flashlight }
];

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isLogin) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ 
          email: email.trim(), 
          password: password.trim() 
        });
        
        if (signInError) {
          if (signInError.message.includes('Email not confirmed')) {
            throw new Error("Email not confirmed. Please check your inbox!");
          }
          throw signInError;
        }
        
        if (data.user) {
          onAuth(data.user);
        }
      } else {
        if (!username.trim()) throw new Error("A username is required for protocol identification.");
        if (username.trim().length < 2) throw new Error("Username must be at least 2 characters.");
        
        const { data, error: signUpError } = await supabase.auth.signUp({ 
          email: email.trim(), 
          password: password.trim(),
          options: {
            data: { username: username.trim() }
          }
        });
        
        if (signUpError) throw signUpError;
        
        if (data.user) {
          setSuccess("REGISTRATION SUCCESSFUL. IDENTITY PROTOCOL SENT TO EMAIL. PLEASE VERIFY BEFORE LOGGING IN.");
          setIsLogin(true);
        }
      }
    } catch (err: any) {
      console.error("Auth error details:", err);
      setError(err.message || "An unknown error occured during authentication.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0C10] p-4 relative overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 left-1/4 w-px h-full bg-white/5 z-0 pointer-events-none"></div>
      <div className="absolute top-0 right-1/4 w-px h-full bg-white/5 z-0 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-blue-500/5 to-transparent pointer-events-none"></div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-slate-900/50 border border-white/10 p-8 rounded-2xl backdrop-blur-xl relative z-10 shadow-2xl"
      >
        <div className="text-center mb-8">
          <motion.div
            animate={{ rotate: loading ? 360 : 0 }}
            transition={{ repeat: loading ? Infinity : 0, duration: 2, ease: "linear" }}
          >
            <Gamepad2 className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          </motion.div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase game-font bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-fuchsia-500">
            {isLogin ? 'Access Portal' : 'Create Identity'}
          </h1>
          <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mt-2">
            Protocol v1.0.42 // Authenticate to proceed
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest ml-1">Unique Username</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-200" 
                  placeholder="CoolGamer123"
                  required={!isLogin}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest ml-1">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-200" 
                placeholder="identity@gmail.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest ml-1">Access Key</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-200" 
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[10px] text-red-500 font-bold uppercase tracking-tight bg-red-500/10 p-3 rounded border border-red-500/30 font-mono"
            >
              [ERROR]: {error.toUpperCase()}
            </motion.div>
          )}

          {success && (
            <motion.div 
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[10px] text-green-400 font-bold uppercase tracking-tight bg-green-500/10 p-3 rounded border border-green-500/30 font-mono"
            >
              [SUCCESS]: {success}
            </motion.div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-lg transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(37,99,235,0.2)] active:scale-[0.98]"
          >
            {loading ? 'Processing...' : isLogin ? 'Initialize Session' : 'Register Identity'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <button 
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
              setSuccess('');
            }}
            className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hover:text-blue-400 transition-colors"
          >
            {isLogin ? "Need new credentials? Register" : "Have existing credentials? Login"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isMod, setIsMod] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [isBanned, setIsBanned] = useState(false);
  const [bannedIds, setBannedIds] = useState<string[]>([]);
  const [chatStatus, setChatStatus] = useState('Loading...');
  const [showUserMenu, setShowUserMenu] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkModStatus(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkModStatus(session.user.id);
      } else {
        setIsMod(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    fetchChat();
    checkMyBan();
    fetchAllBans();

    const channel = supabase.channel('chat-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => fetchChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_users' }, () => {
        checkMyBan();
        fetchAllBans();
        fetchChat();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setChatStatus('Live');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const checkModStatus = async (uid: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_mod')
      .eq('id', uid)
      .maybeSingle();
    
    if (!error && data) {
      setIsMod(data.is_mod);
    }
  };

  const fetchChat = async () => {
    // Select from the view to always get current username from the profiles table
    const { data, error } = await supabase.from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Fetch error:", error);
      return;
    }
    if (data) {
      setMessages([...data].reverse());
    }
  };

  const checkMyBan = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('banned_users')
      .select('user_id')
      .eq('user_id', user.id) // Supabase handles uuid casting if the column is uuid
      .maybeSingle();
    
    setIsBanned(!!data);
  };

  const fetchAllBans = async () => {
    const { data } = await supabase.from('banned_users').select('user_id');
    if (data) {
      setBannedIds(data.map((b: any) => b.user_id));
    }
  };

  const handlePostComment = async () => {
    if (!user || !commentInput.trim() || isBanned) return;

    // We no longer need to insert 'username' here as it's linked via profiles table
    const { error } = await supabase.from('comments').insert([{ 
      text: commentInput.trim(), 
      user_id: user.id 
    }]);

    if (error) {
      alert("Fel vid sändning: " + error.message);
    } else {
      setCommentInput('');
      fetchChat();
    }
  };

  const handleDelete = async (id: string) => {
    if (!isMod) return;
    if (confirm("Radera meddelande?")) {
      await supabase.from('comments').delete().eq('id', id);
      fetchChat();
    }
  };

  const handleBan = async (uid: string) => {
    if (!isMod) return;
    if (uid === user?.id) return alert("Du kan inte banna dig själv!");
    if (confirm("Vill du banna denna användare permanent?")) {
      const { error } = await supabase.from('banned_users').insert([{ user_id: uid, reason: 'Moderator-ban' }]);
      if (error) alert("Kunde inte banna: " + error.message);
      fetchAllBans();
      fetchChat();
    }
  };

  const handleVerify = async (id: string, setVerified: boolean) => {
    if (!isMod) return;
    const { error } = await supabase.from('comments').update({ verified: setVerified }).eq('id', id);
    if (error) {
      alert("Kunde inte verifiera: " + error.message);
    } else {
      fetchChat();
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsMod(false);
  };

  if (!user) {
    return <AuthScreen onAuth={setUser} />;
  }

  return (
    <div className="bg-[#0A0C10] text-slate-100 min-h-screen flex flex-col font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
      <style>{`
        .game-font { font-family: 'Orbitron', sans-serif; }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
      
      {/* Decorative Elements */}
      <div className="absolute top-0 left-1/4 w-px h-full bg-white/5 z-0 pointer-events-none"></div>
      <div className="absolute top-0 right-1/4 w-px h-full bg-white/5 z-0 pointer-events-none"></div>

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-[#0A0C10]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-baseline gap-3">
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-fuchsia-500 uppercase game-font">
            GAME HUB
          </h1>
          <span className="text-[10px] font-mono text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30 tracking-widest hidden sm:block">
            v1.0.42-STABLE
          </span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end hidden md:flex">
            <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Network Status</span>
            <span className={`text-xs font-mono flex items-center gap-1.5 ${chatStatus === 'Live' ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${chatStatus === 'Live' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              {chatStatus === 'Live' ? 'SECURE CONNECTION' : 'CONNECTING...'}
            </span>
          </div>
          
          <div className="flex items-center gap-3 relative">
            {isMod && (
              <div className="text-[10px] font-black bg-yellow-500 text-black px-2 py-1 rounded tracking-tighter animate-pulse">
                SYS_MOD
              </div>
            )}
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-10 h-10 rounded-full bg-slate-800 border border-white/20 flex items-center justify-center text-sm font-bold text-blue-400 hover:border-blue-500 transition-colors"
            >
              {(user.user_metadata.username || 'Z').charAt(0).toUpperCase()}
            </button>

            <AnimatePresence>
              {showUserMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-slate-900 border border-white/10 p-2 rounded-xl shadow-2xl z-50 backdrop-blur-md"
                >
                  <div className="p-3 border-b border-white/5 mb-2">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Authenticated As</div>
                    <div className="text-xs font-black truncate">{user.user_metadata.username || user.email}</div>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10 rounded-lg transition-colors uppercase tracking-widest"
                  >
                    <LogOut className="w-4 h-4" /> Log Out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-8 p-8 z-10">
        
        {/* Sidebar: Chat & Status */}
        <aside className="md:col-span-3 flex flex-col gap-4">
          <div className="bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col h-[500px] md:h-[600px] backdrop-blur-sm sticky top-28">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50 rounded-t-2xl">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 select-none">
                Community Feed
              </h3>
              <span className="text-[10px] text-blue-400">2.4k Active</span>
            </div>
            
            <div ref={scrollRef} className="flex-1 p-4 space-y-4 overflow-y-auto custom-scroll">
              <AnimatePresence initial={false}>
                {messages.length === 0 ? (
                  <div className="text-center text-slate-600 py-10 italic text-[10px] uppercase font-bold tracking-widest">Awaiting Messages...</div>
                ) : (
                  messages.map((m) => {
                    const userIsBanned = bannedIds.includes(m.user_id);
                    if (userIsBanned && !isMod) return null;

                    const isMe = m.user_id === user.id;
                    const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString('sv-SE', {hour: '2-digit', minute:'2-digit'}) : '';

                    return (
                      <motion.div 
                        key={m.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-1 relative group"
                      >
                        <div className="flex justify-between text-[10px]">
                          <span className={`font-bold flex items-center gap-1 ${userIsBanned ? 'text-red-500 underline' : m.is_mod ? 'text-yellow-500' : isMe ? 'text-blue-400' : 'text-fuchsia-400'}`}>
                            {userIsBanned ? '[BANNED]' : (m.username || 'Spelare')}
                            {m.is_mod && <ShieldCheck className="w-2.5 h-2.5 text-yellow-500" />}
                            {m.verified && !m.is_mod && <CheckCircle className="w-2 h-2 text-blue-400" />}
                          </span>
                          <span className="text-slate-600">{timeStr}</span>
                        </div>
                        
                        <div className={`text-xs p-2 rounded-lg border-l-2 ${userIsBanned ? 'bg-red-900/10 border-red-500 italic text-slate-500' : isMe ? 'bg-blue-900/10 border-blue-500 text-slate-300' : 'bg-slate-800/50 border-fuchsia-500 text-slate-300'}`}>
                          {userIsBanned ? "Message removed for violating rules." : m.text}
                        </div>

                        {isMod && (
                          <div className="absolute right-0 top-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 p-1 rounded backdrop-blur-sm border border-white/10">
                            <button onClick={() => handleDelete(m.id)} className="text-red-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                            <button onClick={() => handleBan(m.user_id)} className="text-orange-500 hover:text-orange-400"><UserX className="w-3 h-3" /></button>
                            <button onClick={() => handleVerify(m.id, !m.verified)} className="text-green-500 hover:text-green-400"><CheckCircle className="w-3 h-3" /></button>
                          </div>
                        )}
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 bg-black/40 border-t border-white/5 rounded-b-2xl">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePostComment()}
                  placeholder={isBanned ? "BANNED." : "MESSAGING..."}
                  disabled={isBanned}
                  className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs w-full focus:outline-none focus:border-blue-500 text-slate-200 placeholder-slate-600"
                />
                <button 
                  onClick={handlePostComment}
                  disabled={isBanned || !commentInput.trim()}
                  className="p-2 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:bg-slate-800 transition-colors shadow-lg shadow-blue-600/20"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
              <div className="mt-2 text-[8px] text-slate-600 font-bold uppercase tracking-[0.2em] text-center">
                Authenticated Identity: {user.user_metadata.username || 'SYS_USER'}
              </div>
            </div>
          </div>
        </aside>

        {/* Central Area: Welcome & Game Grid */}
        <section className="md:col-span-9 flex flex-col gap-8">
          {/* Header Info */}
          <div className="flex flex-col gap-2">
            <h2 className="text-5xl font-black italic tracking-tighter uppercase game-font">
              Welcome! <span className="text-slate-600">(or not)</span>
            </h2>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">
              Tap a module to initialize session // Follow protocol in communications
            </p>
          </div>

          {/* Dev Update Card */}
          <div className="bg-gradient-to-br from-slate-900 to-black border border-white/10 rounded-2xl p-8 relative overflow-hidden group">
            <div className="absolute -right-12 -top-12 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all duration-700"></div>
            <div className="relative z-10 flex flex-col md:flex-row gap-8">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] font-black bg-blue-600 text-white px-2 py-0.5 rounded tracking-tighter">SYSTEM UPDATE</span>
                  <span className="text-xs text-slate-500 font-mono">05 MARCH 2026</span>
                </div>
                <h3 className="text-3xl font-black italic tracking-tighter mb-4 uppercase">The Portal is Evolving.</h3>
                <div className="text-sm text-slate-400 max-w-xl leading-relaxed space-y-4">
                  <p>Sup and welcome to the Game Portal 🎮 Enable F11 for best experience.</p>
                  <p>
                    I've implemented a <span className="text-white font-bold">BAN & VERIFY</span> system to keep the chat clean. 
                    People who write crap will BE BANNED. Viewing the chat requires VPN or ur own wifi (school blocks it).
                    Go to the repo for the <span className="text-blue-400 font-bold underline cursor-pointer">PROTON VPN</span> link.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {['Zelda', 'Retro Bowl', 'Banana Casino', 'Night Horror 2'].map(game => (
                      <span key={game} className="text-[10px] font-black border border-white/10 px-2 py-1 rounded bg-white/5 text-slate-300">
                        + {game.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="hidden md:block w-px bg-white/10"></div>
              
              <div className="flex flex-col justify-center items-center min-w-[120px]">
                <div className="text-center">
                  <div className="text-6xl font-black text-blue-500">{games.length}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Modules Ready</div>
                </div>
              </div>
            </div>
          </div>

          {/* Game Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {games.map((game) => (
              <motion.div 
                key={game.id}
                whileHover={{ y: -5, scale: 1.02 }}
                className="group bg-slate-900/40 border border-white/10 rounded-xl p-6 flex flex-col items-center gap-4 hover:bg-slate-800/60 hover:border-blue-500/50 transition-all cursor-pointer shadow-xl backdrop-blur-sm"
                onClick={() => window.open(`spel${game.id}.html`, '_blank')}
              >
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center border border-white/5 group-hover:bg-blue-500 group-hover:text-black transition-all duration-300">
                  <game.icon className="w-8 h-8 opacity-70 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-center">
                  <h4 className="text-sm font-black uppercase tracking-tight group-hover:text-blue-400 transition-colors">{game.name}</h4>
                  <p className="text-[10px] text-slate-500 font-bold tracking-widest mt-1 uppercase">Unit {game.id}</p>
                </div>
                <button className="w-full text-[10px] font-black py-2.5 rounded bg-blue-600/10 text-blue-400 border border-blue-600/20 group-hover:bg-blue-600 group-hover:text-white transition-all uppercase tracking-widest">
                  Initialize
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 bg-[#0A0C10] z-10 mt-auto">
        <p className="text-[10px] text-slate-600 font-bold tracking-widest uppercase">
          © 2026 // GAME_HUB_TERMINAL // CREATED BY ZAYN // PROTOCOL V.1.042
        </p>
        <div className="flex gap-8 items-center">
          <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest bg-white/5 px-2 py-1 rounded">
            F11 For Fullscreen
          </span>
          <div className="flex gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span className="w-2 h-2 rounded-full bg-fuchsia-500"></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
