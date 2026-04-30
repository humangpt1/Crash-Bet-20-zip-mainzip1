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
import { LogOut, User, Wallet, Plus } from "lucide-react";

function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

export default function GamePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [walletOpen, setWalletOpen] = useState(false);

  const {
    gameState,
    activeBets,
    history,
    myBets,
    placeBet,
    cashout,
    slotBalances: updatedSlotBalances,
  } = useGame();

  const [placingSlots, setPlacingSlots] = useState<Record<number, boolean>>({});
  const [cashingSlots, setCashingSlots] = useState<Record<number, boolean>>({});
  const [slotBalances, setSlotBalances] = useState<Record<number, number>>({
    0: 0,
    1: 0,
  });

  useEffect(() => {
    if (!user) setLocation("/auth");
  }, [user, setLocation]);

  // Sync slot balances from server (2 slots)
  useEffect(() => {
    if (updatedSlotBalances) {
      setSlotBalances({
        0: updatedSlotBalances[0] ?? 0,
        1: updatedSlotBalances[1] ?? 0,
      });
    }
  }, [updatedSlotBalances]);

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

  const totalBalance = (slotBalances[0] ?? 0) + (slotBalances[1] ?? 0);
  const displayName = user?.phone || user?.username || "Player";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-16 border-b border-border/50 bg-card/50 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black tracking-tighter text-primary text-glow">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-background/50 px-3 py-2 rounded-full border border-white/5">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-xs">{displayName}</span>
          </div>

          <button
            onClick={() => setWalletOpen(true)}
            className="flex items-center gap-2 bg-success/10 text-success px-4 py-2 rounded-full border border-success/20 box-glow-success hover:bg-success/20 transition-colors"
          >
            <Wallet className="w-4 h-4" />
            <span className="font-mono font-bold text-sm">
              {formatKsh(totalBalance / 100)} KSH
            </span>
            <Plus className="w-3.5 h-3.5" />
          </button>

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

      <main className="flex-1 p-4 lg:p-8 max-w-[1600px] mx-auto w-full flex flex-col gap-6">
        <div className="w-full bg-card/30 p-2 rounded-xl border border-white/5">
          <HistoryBar history={history} />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[600px]">
          <div className="flex-1 flex flex-col gap-6">
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
                slotBalances={slotBalances}
              />
            </div>
          </div>

          <div className="w-full lg:w-[400px] shrink-0">
            <LiveBets bets={activeBets} gameState={gameState} />
          </div>
        </div>
      </main>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
