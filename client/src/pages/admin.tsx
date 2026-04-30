import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Bet } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Activity, Users } from "lucide-react";
import { GameCanvas } from "@/components/GameCanvas";
import { useGame } from "@/hooks/use-game";

// Helpers – assuming backend stores values in cents
const formatKsh = (cents: number) => `KSH ${(cents / 100).toFixed(2)}`;
const toCents = (ksh: number) => Math.round(ksh * 100);

export default function AdminPage() {
  const { toast } = useToast();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const { gameState } = useGame();

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: currentBets } = useQuery<
    { bet: Bet; user: User; playerIndex: number }[]
  >({
    queryKey: ["/api/bets/current"],
    refetchInterval: 1000,
  });

  const setBalanceMutation = useMutation({
    mutationFn: async ({
      userId,
      balance,
      playerIndex,
    }: {
      userId: number;
      balance: number;
      playerIndex: number;
    }) => {
      // If your backend expects KSH → send balance directly
      // If backend expects cents → send toCents(balance)
      await apiRequest("POST", "/api/admin/set-balance", {
        userId,
        balance, // ← change to toCents(balance) if backend wants cents
        playerIndex,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Balance updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalBetsCents = useMemo(
    () => currentBets?.reduce((sum, b) => sum + b.bet.amount, 0) ?? 0,
    [currentBets],
  );

  const totalPayoutCents = useMemo(
    () => currentBets?.reduce((sum, b) => sum + (b.bet.winAmount || 0), 0) ?? 0,
    [currentBets],
  );

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <header className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <h1 className="text-3xl font-black tracking-tighter">
            ADMIN <span className="text-primary">CONTROL</span>
          </h1>
          <div className="flex gap-4">
            <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-500 block">STATUS</span>
              <span className="font-bold uppercase text-primary">
                {gameState.status}
              </span>
            </div>
            <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-500 block">MULTIPLIER</span>
              <span className="font-bold font-mono text-primary">
                {gameState.multiplier.toFixed(2)}x
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Live Canvas & Stats */}
          <div className="lg:col-span-8 space-y-6">
            <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> LIVE CANVAS VIEW
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <GameCanvas gameState={gameState} />
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="p-4">
                  <CardTitle className="text-xs text-zinc-500 uppercase">
                    Total Bets
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-2xl font-black">
                  {formatKsh(totalBetsCents)}
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="p-4">
                  <CardTitle className="text-xs text-zinc-500 uppercase">
                    Total Payout
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-2xl font-black text-primary">
                  {formatKsh(totalPayoutCents)}
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="p-4">
                  <CardTitle className="text-xs text-zinc-500 uppercase">
                    Net House
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-2xl font-black text-green-500">
                  {formatKsh(totalBetsCents - totalPayoutCents)}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Player Management */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="bg-zinc-900 border-zinc-800 h-fit">
              <CardHeader className="border-b border-zinc-800 bg-zinc-900/50 p-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> PLAYER SLOTS VIEW
                </CardTitle>
              </CardHeader>

              <CardContent className="p-4 space-y-4 max-h-[800px] overflow-y-auto">
                {users?.map((user) => (
                  <div
                    key={user.id}
                    className="p-4 rounded-lg bg-black/40 border border-zinc-800 space-y-4"
                  >
                    <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                      <div className="font-bold text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-zinc-500" />
                        {user.username}
                        <span className="text-[10px] text-zinc-600">
                          ID: {user.id}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {user.slots?.map((slot: any) => (
                        <div
                          key={slot.id}
                          className="bg-zinc-900/50 p-3 rounded border border-zinc-800/50"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="text-[10px] text-zinc-500 font-bold uppercase">
                                Slot {slot.playerIndex + 1}
                              </div>
                              <div className="text-xl font-black text-white">
                                {formatKsh(slot.balance)}
                              </div>
                            </div>

                            {currentBets?.find(
                              (b) =>
                                b.user.id === user.id &&
                                b.playerIndex === slot.playerIndex,
                            ) && (
                              <div className="text-right">
                                <div className="text-[10px] text-primary font-bold uppercase">
                                  Active Bet
                                </div>
                                <div className="text-sm font-bold">
                                  {formatKsh(
                                    currentBets.find(
                                      (b) =>
                                        b.user.id === user.id &&
                                        b.playerIndex === slot.playerIndex,
                                    )!.bet.amount,
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-5 gap-1 mb-2">
                            {[10, 50, 100, 500, 1000].map((kshAmount) => (
                              <Button
                                key={kshAmount}
                                variant="outline"
                                className="h-6 text-[9px] p-0 border-zinc-700 hover:bg-zinc-800"
                                onClick={() => {
                                  const currentKsh = slot.balance / 100;
                                  const newKsh = currentKsh + kshAmount;
                                  setBalanceMutation.mutate({
                                    userId: user.id,
                                    balance: toCents(newKsh),
                                    playerIndex: slot.playerIndex,
                                  });
                                }}
                              >
                                +{kshAmount}
                              </Button>
                            ))}
                          </div>

                          <div className="flex gap-2">
                            <Input
                              type="number"
                              placeholder="Set balance (KSH)"
                              className="h-7 text-xs bg-black border-zinc-700"
                              value={
                                inputs[`${user.id}-${slot.playerIndex}`] || ""
                              }
                              onChange={(e) =>
                                setInputs({
                                  ...inputs,
                                  [`${user.id}-${slot.playerIndex}`]:
                                    e.target.value,
                                })
                              }
                            />
                            <Button
                              size="sm"
                              className="h-7 px-4 text-[10px] font-bold"
                              onClick={() => {
                                const val = parseFloat(
                                  inputs[`${user.id}-${slot.playerIndex}`],
                                );
                                if (!isNaN(val) && val >= 0) {
                                  setBalanceMutation.mutate({
                                    userId: user.id,
                                    balance: toCents(val),
                                    playerIndex: slot.playerIndex,
                                  });
                                  // Optional: clear input after set
                                  setInputs((prev) => ({
                                    ...prev,
                                    [`${user.id}-${slot.playerIndex}`]: "",
                                  }));
                                }
                              }}
                            >
                              SET
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
