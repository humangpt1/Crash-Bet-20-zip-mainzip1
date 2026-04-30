import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, normalisePhone, insertUserSchema } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

function getClientIp(req: Request): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || undefined;
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "crash-betting-secret",
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({ checkPeriod: 86400000 }),
    cookie: { secure: app.get("env") === "production" },
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Single passport strategy that accepts EITHER phone (normal users)
  // OR username (legacy admins). We expose `usernameField: "identifier"`.
  passport.use(
    new LocalStrategy(
      { usernameField: "identifier", passwordField: "password" },
      async (identifier, password, done) => {
        try {
          let user: SelectUser | undefined;
          const phone = normalisePhone(identifier);
          if (phone) {
            user = await storage.getUserByPhone(phone);
          }
          if (!user) {
            user = await storage.getUserByUsername(identifier);
          }
          if (!user || !(await comparePasswords(password, user.password))) {
            return done(null, false, { message: "Invalid credentials" });
          }
          if (user.isBlocked) {
            return done(null, false, {
              message: user.blockReason || "Account is blocked",
            });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // -----------------------------
  // Register (phone + password)
  // -----------------------------
  app.post("/api/register", async (req, res, next) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: parsed.error.errors[0]?.message || "Invalid input",
        });
      }
      const { phone, password } = parsed.data;

      const existingByPhone = await storage.getUserByPhone(phone);
      if (existingByPhone) {
        return res.status(400).json({ message: "Phone number already registered" });
      }

      const ip = getClientIp(req);
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        phone,
        password: hashedPassword,
      });

      // Track IP for fraud detection
      if (ip) await storage.updateUserMeta(user.id, { lastIp: ip });

      // Flag if many accounts from same IP
      if (ip) {
        const count = await storage.countAccountsByIp(ip);
        if (count >= 3) {
          await storage.logFraudEvent({
            userId: user.id,
            eventType: "multi_account_same_ip",
            severity: count >= 5 ? "high" : "warn",
            ip,
            details: { count },
          });
        }
      }

      await storage.ensureSlots(user.id);

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(sanitizeUser(user));
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------
  // Login (phone OR username)
  // -----------------------------
  app.post("/api/login", (req, res, next) => {
    // Accept either { phone, password } from normal users or
    // { username, password } from admins.
    if (!req.body.identifier) {
      req.body.identifier = req.body.phone || req.body.username;
    }
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user)
        return res
          .status(401)
          .json({ message: info?.message || "Invalid credentials" });
      req.login(user, async (err) => {
        if (err) return next(err);
        const ip = getClientIp(req);
        if (ip) await storage.updateUserMeta(user.id, { lastIp: ip });
        res.status(200).json(sanitizeUser(user));
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/me", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(sanitizeUser(req.user));
  });
}

function sanitizeUser(user: SelectUser) {
  const { password, ...rest } = user;
  return rest;
}
