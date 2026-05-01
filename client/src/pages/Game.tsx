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
  Users,
  MessageCircle,
  Share2,
} from "lucide-react";

function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

type WalletTab = "deposit" | "withdraw" | "history";

const WHATSAPP_HELP_URL =
  "https://wa.me/254739119490?text=Hi%2C+I+need+help+with+Crash.Bet";

export default function GamePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>("deposit");
  const [showReferral, setShowReferral] = useState(false);

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

  const onlineCount = gameState.onlineCount ?? 30;
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
          {/* Online pill */}
          <div className="flex items-center gap-1 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-mono text-green-400 font-semibold">
              {onlineCount.toLocaleString()} online
            </span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Balance — desktop only */}
          <span className="hidden sm:inline font-mono font-bold text-sm text-emerald-400">
            KES {formatKsh(walletBalance / 100)}
          </span>

          {/* Deposit button — bright green */}
          <button
            onClick={() => openWallet("deposit")}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-black font-bold text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-xl shadow-lg shadow-emerald-500/30 transition"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Deposit</span>
          </button>

          {/* Withdraw button — bright red */}
          <button
            onClick={() => openWallet("withdraw")}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 active:scale-95 text-white font-bold text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-xl shadow-lg shadow-red-500/30 transition"
          >
            <ArrowUpFromLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>Withdraw</span>
          </button>

          {/* Referral share */}
          <button
            onClick={() => setShowReferral((v) => !v)}
            className="hidden sm:flex items-center gap-1 text-muted-foreground hover:text-primary transition px-2 py-2 rounded-lg hover:bg-white/5"
            title="Invite friends — earn KES 50 per referral"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {/* Logout */}
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

      {/* Referral banner (shown when toggled) */}
      {showReferral && (
        <ReferralBanner onClose={() => setShowReferral(false)} />
      )}

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

      {/* ──────────── MAIN ──────────── */}
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
      </main>

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

function ReferralBanner({ onClose }: { onClose: () => void }) {
  const [code, setCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/referral", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCode(d.referralLink ?? d.referralCode))
      .catch(() => {});
  }, []);

  const copyLink = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-card/80 border-b border-white/10 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-2">
      <div className="flex-1">
        <p className="font-semibold text-sm text-foreground flex items-center gap-2">
          <Share2 className="w-4 h-4 text-primary" />
          Refer friends — earn KES 50 per referral
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {code ? code : "Loading your referral link…"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={copyLink}
          disabled={!code}
          className="text-xs bg-primary/20 hover:bg-primary/30 text-primary px-3 py-1.5 rounded-lg font-medium transition"
        >
          {copied ? "Copied!" : "Copy Link"}
        </button>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs px-2 py-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
