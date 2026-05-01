import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, wsEvents } from "@shared/routes";
import { type Bet } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "./use-auth";

export type GameStatus = "betting" | "active" | "crashed";

export interface GameState {
  status: GameStatus;
  multiplier: number;
  roundId?: number;
  elapsed: number;
  crashPoint?: number;
  onlineCount?: number;
}

export interface PlayerBet {
  bet: Bet;
  user: { id: number; username: string };
  playerIndex: number;
}

export function useGame() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);

  const [gameState, setGameState] = useState<GameState>({
    status: "betting",
    multiplier: 1.0,
    elapsed: 0,
  });

  const [visibleBets, setVisibleBets] = useState<PlayerBet[]>([]);

  // ─────────────────────────────────────────────
  // Initial Game State
  // ─────────────────────────────────────────────
  useQuery({
    queryKey: ["gameState"],
    queryFn: async () => {
      const res = await fetch(api.game.state.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch initial game state");
      const data = await res.json();
      setGameState((prev) => ({ ...prev, ...data }));
      return data;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // ─────────────────────────────────────────────
  // Wallet (single shared balance, in cents)
  // ─────────────────────────────────────────────
  const { data: wallet } = useQuery({
    queryKey: [api.wallet.summary.path],
    queryFn: async () => {
      if (!user) return null;
      const res = await fetch(api.wallet.summary.path, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return await res.json();
    },
    enabled: !!user,
    refetchInterval: 4000,
    staleTime: 3000,
  });

  const walletBalance = wallet?.totalBalance ?? user?.walletBalance ?? 0;

  // ─────────────────────────────────────────────
  // History
  // ─────────────────────────────────────────────
  const { data: history = [] } = useQuery({
    queryKey: ["gameHistory"],
    queryFn: async () => {
      const res = await fetch(api.game.history.path, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  // ─────────────────────────────────────────────
  // WebSocket
  // ─────────────────────────────────────────────
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (user) {
          ws.send(JSON.stringify({ type: "auth", userId: user.id }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);

          switch (type) {
            case wsEvents.SERVER_STATE_UPDATE:
              setGameState((prev) => ({ ...prev, ...payload }));
              break;

            case wsEvents.SERVER_ROUND_START:
              setGameState({
                status: "betting",
                multiplier: 1.0,
                elapsed: 0,
                roundId: payload.roundId,
              });
              setVisibleBets((prev) =>
                prev.filter((b) => b.bet.status !== "active"),
              );
              break;

            case wsEvents.SERVER_ROUND_CRASH:
              setGameState((prev) => ({
                ...prev,
                status: "crashed",
                multiplier: payload.crashPoint,
                crashPoint: payload.crashPoint,
              }));

              queryClient.invalidateQueries({ queryKey: ["gameHistory"] });

              setVisibleBets((prev) =>
                prev.map((pb) =>
                  pb.bet.status === "active"
                    ? { ...pb, bet: { ...pb.bet, status: "lost" } }
                    : pb,
                ),
              );

              setTimeout(() => {
                setVisibleBets((prev) =>
                  prev.filter((b) => b.bet.status !== "lost"),
                );
              }, 8000);
              break;

            case wsEvents.SERVER_BET_PLACED:
              setVisibleBets((prev) => {
                // Only collapse the SAME user's prior bet on the SAME slot —
                // every other player's bets must remain visible so the
                // live-bets feed actually shows the room's activity.
                const filtered = prev.filter(
                  (b) =>
                    !(
                      b.playerIndex === payload.bet?.playerIndex &&
                      b.user?.id === payload.user?.id
                    ),
                );
                return [...filtered, payload].sort(
                  (a, b) => (b.bet.amount ?? 0) - (a.bet.amount ?? 0),
                );
              });
              break;

            case wsEvents.SERVER_BET_CASHED_OUT:
              setVisibleBets((prev) => {
                const updated = prev.map((pb) =>
                  pb.bet.id === payload.bet.id
                    ? {
                        ...pb,
                        bet: { ...pb.bet, ...payload.bet, status: "won" },
                      }
                    : pb,
                );

                return updated.filter((b) => {
                  if (b.bet.status === "lost") return false;
                  if (b.bet.status === "won") {
                    return Date.now() - (b.bet.createdAt ?? 0) < 8000;
                  }
                  return true;
                });
              });
              break;

            case wsEvents.SERVER_BALANCE_UPDATE:
              // Server now sends { walletBalance } — refresh wallet summary.
              queryClient.invalidateQueries({
                queryKey: [api.wallet.summary.path],
              });
              break;

            case wsEvents.SERVER_WALLET_UPDATE:
              if (payload?.event === "deposit_success") {
                toast({
                  title: "Deposit confirmed",
                  description: `KES ${Math.floor((payload.amount ?? 0) / 100).toLocaleString()} added to your wallet.`,
                });
              } else if (payload?.event === "withdrawal_paid") {
                toast({
                  title: "M-Pesa sent",
                  description: `KES ${Math.floor((payload.amount ?? 0) / 100).toLocaleString()} paid out${payload.receipt ? " — " + payload.receipt : ""}.`,
                });
              } else if (payload?.event === "withdrawal_rejected") {
                toast({
                  title: "Withdrawal reversed",
                  description: payload.reason || "Funds returned to your wallet.",
                  variant: "destructive",
                });
              }
              queryClient.invalidateQueries({
                queryKey: [api.wallet.summary.path],
              });
              queryClient.invalidateQueries({
                queryKey: [api.wallet.transactions.path],
              });
              break;
          }
        } catch (err) {
          console.error("WS message parse error:", err);
        }
      };

      ws.onclose = () => {
        const delay = reconnectTimeout ? 5000 : 2000;
        reconnectTimeout = setTimeout(connect, delay);
      };

      ws.onerror = (err) => console.error("WebSocket error:", err);
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [queryClient, user, toast]);

  // ─────────────────────────────────────────────
  const placeBetMutation = useMutation({
    mutationFn: async ({
      amount,
      autoCashout,
      playerIndex,
      queueForNext = false,
    }: {
      amount: number;
      autoCashout?: number | null;
      playerIndex: number;
      queueForNext?: boolean;
    }) => {
      const res = await fetch(api.bets.place.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount,
          autoCashout: autoCashout ?? null,
          playerIndex,
          saveNextBet: queueForNext,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to place bet");
      }

      return res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Bet failed",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gameHistory"] });
      queryClient.invalidateQueries({ queryKey: [api.wallet.summary.path] });
    },
  });

  // ─────────────────────────────────────────────
  // CASHOUT
  // ─────────────────────────────────────────────
  const cashoutMutation = useMutation({
    mutationFn: async (playerIndex: number) => {
      const res = await fetch(api.bets.cashout.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ playerIndex }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Cashout failed");
      }

      return res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Cashout failed",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.wallet.summary.path] });
    },
  });

  const myBets = useMemo(
    () => (user ? visibleBets.filter((pb) => pb.user.id === user.id) : []),
    [visibleBets, user],
  );

  return {
    gameState,
    activeBets: visibleBets,
    myBets,
    history,
    walletBalance,
    placeBet: placeBetMutation.mutateAsync,
    isPlacingBet: placeBetMutation.isPending,
    cashout: cashoutMutation.mutateAsync,
    isCashingOut: cashoutMutation.isPending,
  };
}
