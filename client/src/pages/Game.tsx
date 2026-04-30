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
import { LogOut, User, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

type WalletTab = "deposit" | "withdraw" | "history";

export default function GamePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>("deposit");

  const { gameState, activeBets, history, myBets, placeBet, cashout, walletBalance } =
    useGame();

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

  const displayName = user?.phone || user?.username || "Player";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-16 border-b border-border/50 bg-card/50 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-3 sm:px-4 lg:px-8 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl sm:text-2xl font-black tracking-tighter text-primary text-glow truncate">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Wallet pill (read-only summary) */}
          <div className="hidden sm:flex items-center gap-2 bg-background/50 px-3 py-2 rounded-full border border-white/5">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-xs">{displayName}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline font-mono font-bold text-sm text-success">
              KES {formatKsh(walletBalance / 100)}
            </span>

            <button
              onClick={() => openWallet("deposit")}
              className="flex items-center gap-1 bg-success/90 hover:bg-success text-black font-semibold text-xs sm:text-sm px-3 py-2 rounded-full shadow-md shadow-success/30 active:scale-95 transition"
              data-testid="button-deposit-header"
            >
              <ArrowDownToLine className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">Deposit</span>
            </button>

            <button
              onClick={() => openWallet("withdraw")}
              className="flex items-center gap-1 bg-red-500/90 hover:bg-red-500 text-white font-semibold text-xs sm:text-sm px-3 py-2 rounded-full shadow-md shadow-red-500/30 active:scale-95 transition"
              data-testid="button-withdraw-header"
            >
              <ArrowUpFromLine className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">Withdraw</span>
            </button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Mobile: balance bar under header */}
      <div className="sm:hidden flex items-center justify-between px-4 py-2 bg-card/40 border-b border-white/5">
        <span className="text-xs text-muted-foreground">{displayName}</span>
        <span className="font-mono font-bold text-sm text-success">
          KES {formatKsh(walletBalance / 100)}
        </span>
      </div>

      <main className="flex-1 p-3 sm:p-4 lg:p-8 max-w-[1600px] mx-auto w-full flex flex-col gap-4 sm:gap-6">
        <div className="w-full bg-card/30 p-2 rounded-xl border border-white/5">
          <HistoryBar history={history} />
        </div>

        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 h-full min-h-[600px]">
          <div className="flex-1 flex flex-col gap-4 sm:gap-6">
            <div className="w-full">
              <GameCanvas gameState={gameState} />
            </div>

            <div className="mt-auto">
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
          </div>

          <div className="w-full lg:w-[400px] shrink-0">
            <LiveBets bets={activeBets} gameState={gameState} />
          </div>
        </div>
      </main>

      <WalletModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        initialTab={walletTab}
      />
    </div>
  );
}
