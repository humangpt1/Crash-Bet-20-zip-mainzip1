import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGame } from "@/hooks/use-game";
import { useLocation } from "wouter";
import { GameCanvas } from "@/components/GameCanvas";
import { BetPanel } from "@/components/BetPanel";
import { LiveBets } from "@/components/LiveBets";
import { HistoryBar } from "@/components/HistoryBar";
import { WalletModal } from "@/components/WalletModal";
import { Button } from "@/components/ui/button";
import {
  LogOut,
  User,
  ArrowDownToLine,
  ArrowUpFromLine,
  MessageCircle,
  Share2,
  Trophy,
  Copy,
  CheckCheck,
  Gift,
  Zap,
} from "lucide-react";

function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

type WalletTab = "deposit" | "withdraw" | "history";
type MainTab = "game" | "referrals";

const WHATSAPP_HELP_URL =
  "https://wa.me/254739119490?text=Hi%2C+I+need+help+with+Crash.Bet";

export default function GamePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>("deposit");
  const [mainTab, setMainTab] = useState<MainTab>("game");

  const {
    gameState,
    activeBets,
    history,
    myBets,
    placeBet,
    cashout,
    walletBalance,
  } = useGame();

  const [placingSlots, setPlacingSlots] = useState<Record<number, boolean>>({});
  const [cashingSlots, setCashingSlots] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!user) setLocation("/auth");
  }, [user, setLocation]);

  const handlePlaceBet = async (
    amount: number,
    autoCashout?: number | null,
    playerIndex?: number,
    queueForNext?: boolean,
  ) => {
    if (playerIndex === undefined) return;
    setPlacingSlots((p) => ({ ...p, [playerIndex]: true }));
    try {
      await placeBet({ amount, autoCashout, playerIndex, queueForNext });
    } finally {
      setPlacingSlots((p) => ({ ...p, [playerIndex]: false }));
    }
  };

  const handleCashout = async (playerIndex: number) => {
    setCashingSlots((p) => ({ ...p, [playerIndex]: true }));
    try {
      await cashout(playerIndex);
    } finally {
      setCashingSlots((p) => ({ ...p, [playerIndex]: false }));
    }
  };

  const openWallet = (tab: WalletTab) => {
    setWalletTab(tab);
    setWalletOpen(true);
  };

  const onlineCount = gameState.onlineCount ?? 95;
  const maskedPhone =
    user?.phone
      ? (() => {
          const local = user.phone.startsWith("254")
            ? "0" + user.phone.slice(3)
            : user.phone;
          if (local.length < 6) return local;
          return local.slice(0, 4) + "*".repeat(local.length - 6) + local.slice(-2);
        })()
      : user?.username ?? "Player";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ──────────── HEADER ──────────── */}
      <header className="h-14 border-b border-white/10 bg-card/60 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-3 sm:px-5 gap-2">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-lg sm:text-xl font-black tracking-tighter text-primary text-glow">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
          <div className="flex items-center gap-1 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-mono text-green-400 font-semibold">
              {onlineCount.toLocaleString()} online
            </span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline font-mono font-bold text-sm text-emerald-400">
            KES {formatKsh(walletBalance / 100)}
          </span>

          <button
            onClick={() => openWallet("deposit")}
            data-testid="btn-deposit"
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-black font-bold text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-xl shadow-lg shadow-emerald-500/30 transition"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Deposit</span>
          </button>

          <button
            onClick={() => openWallet("withdraw")}
            data-testid="btn-withdraw"
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 active:scale-95 text-white font-bold text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-xl shadow-lg shadow-red-500/30 transition"
          >
            <ArrowUpFromLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Withdraw</span>
          </button>

          <button
            onClick={() => setMainTab("referrals")}
            className="hidden sm:flex items-center gap-1 text-muted-foreground hover:text-primary transition px-2 py-2 rounded-lg hover:bg-white/5"
            title="Referrals — earn KES 50 per friend"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            className="text-muted-foreground hover:text-foreground w-8 h-8"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* ──────────── MOBILE BALANCE BAR ──────────── */}
      <div className="sm:hidden flex items-center justify-between px-4 py-2 bg-card/40 border-b border-white/5">
        <div className="flex items-center gap-2">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-mono">
            {maskedPhone}
          </span>
        </div>
        <span className="font-mono font-bold text-sm text-emerald-400">
          KES {formatKsh(walletBalance / 100)}
        </span>
      </div>

      {/* ──────────── TAB NAV ──────────── */}
      <div className="flex border-b border-white/5 bg-card/30 px-4">
        <button
          onClick={() => setMainTab("game")}
          className={`flex items-center gap-1.5 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
            mainTab === "game"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="w-4 h-4" />
          Game
        </button>
        <button
          onClick={() => setMainTab("referrals")}
          className={`flex items-center gap-1.5 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
            mainTab === "referrals"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Gift className="w-4 h-4" />
          Referrals
        </button>
      </div>

      {/* ──────────── MAIN ──────────── */}
      {mainTab === "game" && (
        <main className="flex-1 p-3 sm:p-4 lg:p-8 max-w-[1600px] mx-auto w-full flex flex-col gap-4">
          <div className="w-full bg-card/30 p-2 rounded-xl border border-white/5">
            <HistoryBar history={history} />
          </div>

          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
            <div className="flex-1 flex flex-col gap-4">
              <GameCanvas gameState={gameState} />
              <BetPanel
                gameState={gameState}
                myBets={myBets}
                onPlaceBet={handlePlaceBet}
                onCashout={handleCashout}
                placingSlots={placingSlots}
                cashingSlots={cashingSlots}
                setPlacingSlots={setPlacingSlots}
                setCashingSlots={setCashingSlots}
                walletBalance={walletBalance}
              />
            </div>

            <div className="w-full lg:w-[400px] shrink-0 min-h-[380px]">
              <LiveBets bets={activeBets} gameState={gameState} />
            </div>
          </div>

          {/* ── Pesa Cups Coming Soon Banner ── */}
          <div className="w-full rounded-2xl overflow-hidden border border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 via-amber-500/5 to-yellow-500/10 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-yellow-300 text-sm sm:text-base tracking-wide uppercase">
                    Pesa Cups
                  </span>
                  <span className="text-[10px] font-bold bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-500/30 uppercase tracking-wider">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Weekly tournaments with massive prize pools — compete to top the leaderboard!
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-yellow-400 font-bold text-xs shrink-0 animate-pulse">
              <span>Stay Tuned</span>
            </div>
          </div>
        </main>
      )}

      {mainTab === "referrals" && (
        <main className="flex-1 p-3 sm:p-4 lg:p-8 max-w-[900px] mx-auto w-full">
          <ReferralsPage />
        </main>
      )}

      {/* ──────────── FOOTER ──────────── */}
      <footer className="border-t border-white/5 py-4 px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground/60">
        <span>© {new Date().getFullYear()} Crash.Bet · Play Responsibly · 18+</span>
        <div className="flex items-center gap-4">
          <a
            href={WHATSAPP_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-green-400 transition"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Help via WhatsApp</span>
          </a>
          <span>·</span>
          <button
            onClick={() => openWallet("history")}
            className="hover:text-primary transition"
          >
            Transaction History
          </button>
        </div>
      </footer>

      {/* ──────────── FLOATING WHATSAPP BUTTON ──────────── */}
      <a
        href={WHATSAPP_HELP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-4 z-50 flex items-center gap-2 bg-[#25D366] hover:bg-[#20c05a] text-white font-semibold text-sm px-4 py-3 rounded-full shadow-2xl shadow-green-500/40 active:scale-95 transition"
        title="Get help on WhatsApp"
      >
        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.556 4.116 1.526 5.845L0 24l6.335-1.652A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.007-1.37l-.357-.214-3.76.98 1.007-3.67-.234-.374A9.818 9.818 0 1112 21.818z" />
        </svg>
        <span className="hidden sm:inline">Help</span>
      </a>

      <WalletModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        initialTab={walletTab}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Referrals Page
// ──────────────────────────────────────────────────────────────
function ReferralsPage() {
  const [referralData, setReferralData] = React.useState<{
    referralCode?: string;
    referralLink?: string;
    referralCount?: number;
    referralEarnings?: number;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/referral", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setReferralData(d))
      .catch(() => {});
  }, []);

  const link = referralData?.referralLink ?? referralData?.referralCode ?? "";

  const copyLink = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const earnings = referralData?.referralEarnings ?? 0;
  const count = referralData?.referralCount ?? 0;

  const steps = [
    { n: "1", label: "Share your link", desc: "Send your unique referral link to a friend via WhatsApp, SMS, or social media." },
    { n: "2", label: "Friend signs up", desc: "Your friend registers using your link and deposits for the first time." },
    { n: "3", label: "You earn KES 50", desc: "KES 50 is instantly credited to your wallet for every qualifying referral." },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Hero card */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/20 p-6 flex flex-col sm:flex-row items-center gap-6">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <Gift className="w-8 h-8 text-primary" />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-2xl font-black text-foreground">
            Earn <span className="text-primary text-glow">KES 50</span> Per Friend
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Invite your friends to Crash.Bet. Every friend who signs up and deposits earns you KES 50 — instantly.
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-card border border-white/5 p-5 flex flex-col items-center gap-1">
          <div className="text-3xl font-black font-mono text-primary">{count}</div>
          <div className="text-xs uppercase text-muted-foreground tracking-wider">Friends Referred</div>
        </div>
        <div className="rounded-2xl bg-card border border-white/5 p-5 flex flex-col items-center gap-1">
          <div className="text-3xl font-black font-mono text-emerald-400">
            KES {formatKsh(earnings)}
          </div>
          <div className="text-xs uppercase text-muted-foreground tracking-wider">Total Earned</div>
        </div>
      </div>

      {/* Referral link card */}
      <div className="rounded-2xl bg-card border border-white/10 p-5 flex flex-col gap-3">
        <div className="text-xs uppercase text-muted-foreground tracking-wider font-bold">Your Referral Link</div>
        <div className="flex items-center gap-2 bg-background/60 rounded-xl px-4 py-3 border border-white/5">
          <span className="flex-1 font-mono text-sm text-foreground truncate min-w-0">
            {link || "Loading…"}
          </span>
          <button
            onClick={copyLink}
            disabled={!link}
            className="flex items-center gap-1.5 bg-primary/20 hover:bg-primary/30 text-primary font-bold text-xs px-3 py-1.5 rounded-lg transition shrink-0"
          >
            {copied ? (
              <><CheckCheck className="w-3.5 h-3.5" /> Copied!</>
            ) : (
              <><Copy className="w-3.5 h-3.5" /> Copy</>
            )}
          </button>
        </div>

        {/* Share buttons */}
        <div className="flex gap-2 flex-wrap">
          <a
            href={`https://wa.me/?text=Nilikuwa%20nikiplay%20Crash.Bet%20napata%20pesa%20nyingi%21%20Jiunge%20hapa%3A%20${encodeURIComponent(link)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] font-bold text-xs px-4 py-2 rounded-xl transition border border-[#25D366]/20"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.123.556 4.116 1.526 5.845L0 24l6.335-1.652A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.007-1.37l-.357-.214-3.76.98 1.007-3.67-.234-.374A9.818 9.818 0 1112 21.818z"/>
            </svg>
            Share on WhatsApp
          </a>
          <button
            onClick={copyLink}
            disabled={!link}
            className="flex items-center gap-2 bg-muted/60 hover:bg-muted text-foreground font-bold text-xs px-4 py-2 rounded-xl transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share Link
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="rounded-2xl bg-card border border-white/5 p-5 flex flex-col gap-4">
        <div className="text-sm font-black uppercase tracking-wider text-foreground">How It Works</div>
        <div className="flex flex-col gap-3">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-4 items-start">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 font-black text-primary text-sm">
                {s.n}
              </div>
              <div>
                <div className="font-bold text-sm text-foreground">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Terms note */}
      <p className="text-[11px] text-muted-foreground/50 text-center">
        Referral bonus credited after your friend's first successful deposit of at least KES 100. One bonus per unique phone number.
      </p>
    </div>
  );
}

