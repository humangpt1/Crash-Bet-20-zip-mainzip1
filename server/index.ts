import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// -----------------------------
// Middleware
// -----------------------------
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// Request logger for API routes
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    if (path.startsWith("/api")) {
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// -----------------------------
// Async Initialization
// -----------------------------
(async () => {
  const auth = await import("./auth");

  // --- BOOTSTRAP PRIMARY ADMIN ---
  // Phone-based admin for the operator (also valid for username login).
  try {
    const adminPhone = "254746100508";
    const adminUsername = "admin";
    const adminPassword = "12345678";
    const hashed = await auth.hashPassword(adminPassword);
    await storage.upsertAdminByPhone(adminPhone, hashed, adminUsername);
    console.log(`Admin ready: ${adminUsername} / phone ${adminPhone}`);
  } catch (err) {
    console.error("Failed to bootstrap admin user:", err);
  }

  // --- REGISTER ROUTES ---
  await registerRoutes(httpServer, app);

  // -----------------------------
  // Error Handler
  // -----------------------------
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) return next(err);

    res.status(status).json({ message });
  });

  // -----------------------------
  // Static or Vite Dev Setup
  // -----------------------------
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // -----------------------------
  // Start Server
  // -----------------------------
  const port = parseInt(process.env.PORT || "5000", 10);

  httpServer.listen(port, () => {
    log(`serving on port ${port}`);

    // ── Webhook URL reminder ──
    // The MegaPay dashboard needs this URL set as the webhook endpoint.
    const publicHost =
      process.env.REPLIT_DEV_DOMAIN ||
      process.env.REPL_SLUG
        ? `https://${process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG + "." + process.env.REPL_OWNER + ".repl.co"}`
        : `http://localhost:${port}`;
    log(`MegaPay webhook URL → ${publicHost}/api/wallet/webhook`, "webhook");
    log(`Set this URL in your MegaPay dashboard under API / Account Settings.`, "webhook");
  });
})();