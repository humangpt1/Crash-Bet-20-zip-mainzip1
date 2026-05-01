import React from "react";
import { type PlayerBet, type GameState } from "@/hooks/use-game";

export function formatKsh(cents: number) {
  return Math.floor(cents / 100).toLocaleString("en-KE") + " KSH";
}

interface LiveBetsProps {
  bets: PlayerBet[];
  gameState: GameState;
}

export function LiveBets({ bets, gameState }: LiveBetsProps) {
  const total = bets.reduce((a, b) => a + b.bet.amount, 0);

  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 flex flex-col h-[400px] md:h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-border/50 bg-background/40 flex justify-between items-center gap-2">
        <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Players
        </h3>
        <div className="text-xs font-mono text-muted-foreground text-right">
          <span className="text-foreground font-semibold">{bets.length}</span>{" "}
          bets · {formatKsh(total)}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        {bets.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
            Waiting for bets…
          </div>
        ) : (
          bets.map((pb) => <BetRow key={pb.bet.id} pb={pb} gameState={gameState} />)
        )}
      </div>
    </div>
  );
}

function BetRow({ pb, gameState }: { pb: PlayerBet; gameState: GameState }) {
  const { bet, user } = pb;
  const isWon = bet.status === "won";
  const isLost = bet.status === "lost";
  const isActive = bet.status === "active";

  const currentWin =
    isActive || isWon
      ? (bet.winAmount ?? Math.floor(bet.amount * gameState.multiplier))
      : 0;

  const displayName = user.username || `Player ${user.id}`;
  const initials = displayName.slice(0, 2).toUpperCase();

  let rowBg = "bg-white/5 hover:bg-white/8";
  let textColor = "text-foreground";
  if (isWon) {
    rowBg = "bg-emerald-500/10 border border-emerald-500/30";
    textColor = "text-emerald-400";
  }
  if (isLost) {
    rowBg = "opacity-40";
    textColor = "text-muted-foreground";
  }
  if (isActive && gameState.status === "active") {
    rowBg = "bg-yellow-500/10 border border-yellow-500/20";
  }

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all ${rowBg}`}
    >
      {/* Avatar */}
      <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center font-bold text-[10px] text-muted-foreground shrink-0">
        {initials}
      </div>

      {/* Phone */}
      <span className={`flex-1 font-mono truncate ${textColor}`}>
        {displayName}
      </span>

      {/* Bet amount */}
      <span className="font-mono text-muted-foreground shrink-0">
        {formatKsh(bet.amount)}
      </span>

      {/* Status / cashout */}
      <span
        className={`font-mono font-bold shrink-0 min-w-[54px] text-right ${
          isWon
            ? "text-emerald-400"
            : isActive && gameState.status === "active"
            ? "text-yellow-400"
            : "text-muted-foreground/50"
        }`}
      >
        {isWon
          ? `+${formatKsh(currentWin)}`
          : isActive && gameState.status === "active"
          ? `${gameState.multiplier.toFixed(2)}x`
          : isLost
          ? "BUST"
          : "-"}
      </span>
    </div>
  );
}
