import React, { useEffect, useRef, useState } from "react";
import { type GameState } from "@/hooks/use-game";

interface GameCanvasProps {
  gameState: GameState;
}

export function GameCanvas({ gameState }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(Date.now());
  const visualMultiplierRef = useRef<number>(1.0);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", updateSize);
    updateSize();
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (gameState.status === "betting") {
      const start = Date.now();
      const duration = 5000;
      const timer = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.ceil((duration - (Date.now() - start)) / 1000),
        );
        setCountdown(remaining);
      }, 100);
      return () => clearInterval(timer);
    }
  }, [gameState.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      const now = Date.now();
      lastTimeRef.current = now;

      ctx.clearRect(0, 0, width, height);

      // Grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      const gridSize = 50;
      const offsetX =
        gameState.status === "active" ? -((now % 1000) / 1000) * gridSize : 0;
      ctx.beginPath();
      for (let x = offsetX; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = height; y > 0; y -= gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      if (gameState.status === "betting") {
        visualMultiplierRef.current = 1.0;

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = 60;
        const rotation = ((now % 1000) / 1000) * Math.PI * 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, rotation, rotation + Math.PI * 0.4);
        ctx.strokeStyle = "#ff2a5f";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#ffffff";
        const pulse = 1 + Math.sin(now / 200) * 0.05;
        ctx.font = `bold ${48 * pulse}px "Space Grotesk", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(countdown.toString(), centerX, centerY);
        ctx.shadowBlur = 0;

        // Idle plane bottom-left
        drawPlane(ctx, 50, height - 50, 0, "#ffffff");
      } else if (
        gameState.status === "active" ||
        gameState.status === "crashed"
      ) {
        if (gameState.status === "active") {
          const target = Math.max(1, gameState.multiplier);
          visualMultiplierRef.current +=
            (target - visualMultiplierRef.current) * 0.1;
        } else {
          visualMultiplierRef.current =
            gameState.crashPoint || gameState.multiplier;
        }

        const m = visualMultiplierRef.current;
        const scaleMax = Math.max(2.0, m * 1.2);

        const getX = (val: number) => {
          const progress = Math.min(1, (val - 1) / (scaleMax - 1));
          return 50 + progress * (width * 0.7);
        };
        const getY = (val: number) => {
          const progress = Math.min(1, (val - 1) / (scaleMax - 1));
          return height - 50 - progress * (height * 0.6);
        };

        const currentX = getX(m);
        const currentY = getY(m);

        // Trail (curve)
        ctx.beginPath();
        ctx.moveTo(50, height - 50);
        const cp1x = currentX * 0.5;
        const cp1y = height - 50;
        ctx.quadraticCurveTo(cp1x, cp1y, currentX, currentY);

        ctx.strokeStyle =
          gameState.status === "crashed"
            ? "rgba(255,42,95,0.7)"
            : "rgba(255,42,95,0.9)";
        ctx.lineWidth = 4;
        ctx.shadowBlur = 12;
        ctx.shadowColor = "rgba(255,42,95,0.8)";
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Fill under curve
        ctx.lineTo(currentX, height);
        ctx.lineTo(50, height);
        ctx.fillStyle =
          gameState.status === "crashed"
            ? "rgba(255,42,95,0.08)"
            : "rgba(255,42,95,0.18)";
        ctx.fill();

        // Plane orientation
        const angle = Math.atan2(currentY - cp1y, currentX - cp1x);
        const planeColor =
          gameState.status === "crashed" ? "#666666" : "#ff2a5f";
        drawPlane(ctx, currentX, currentY, angle, planeColor);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [dimensions, gameState, countdown]);

  /**
   * Clean arrowhead-style plane silhouette.
   * Sleek, minimal, points along +X (forward).
   */
  const drawPlane = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    color: string,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Outer glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;

    // Main arrowhead body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(22, 0);          // nose tip
    ctx.lineTo(-14, -12);       // back-top wing tip
    ctx.lineTo(-6, 0);          // notch
    ctx.lineTo(-14, 12);        // back-bottom wing tip
    ctx.closePath();
    ctx.fill();

    // Subtle inner highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-8, -6);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 6);
    ctx.closePath();
    ctx.fill();

    // Cockpit dot
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(8, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-[350px] md:h-[500px] bg-card rounded-2xl overflow-hidden border border-border shadow-2xl ${gameState.status === "crashed" ? "animate-shake border-destructive/50" : ""}`}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%" }}
        className="absolute inset-0 z-0"
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
        {gameState.status === "betting" && (
          <div className="text-4xl md:text-6xl font-black text-white text-glow mb-4">
            PREPARING
          </div>
        )}

        {(gameState.status === "active" ||
          gameState.status === "crashed") && (
          <div className="flex flex-col items-center">
            <div
              className={`text-6xl md:text-9xl font-black font-mono tracking-tighter ${
                gameState.status === "crashed"
                  ? "text-destructive text-glow opacity-80"
                  : "text-primary text-glow"
              }`}
            >
              {gameState.multiplier.toFixed(2)}x
            </div>
            {gameState.status === "crashed" && (
              <div className="text-2xl md:text-4xl font-bold text-destructive mt-4 tracking-widest uppercase">
                CRASHED
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
