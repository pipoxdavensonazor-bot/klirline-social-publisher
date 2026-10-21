// Utilisateurs Klirline + roles, separes des futurs clients.
// JWT court (12 h) dans Authorization: Bearer. Mot de passe : scrypt (stdlib).
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { saveDb, uid } from "./lib.js";

const ROLES = ["admin", "redacteur", "lecteur"];

function hashPw(pw, salt) {
  return scryptSync(String(pw), salt, 64).toString("hex");
}

export function register(env, db, { email, password, role, org }) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Email invalide"), { status: 400 });
  if (String(password || "").length < 12) throw Object.assign(new Error("Mot de passe : 12 caracteres minimum"), { status: 400 });
  if (!ROLES.includes(role)) role = "redacteur";
  if (db.users.some((u) => u.email === email)) throw Object.assign(new Error("Compte existant"), { status: 409 });
  const salt = randomBytes(16).toString("hex");
  const user = { id: uid(), email, salt, hash: hashPw(password, salt), role, org: org || "klirline", createdAt: new Date().toISOString() };
  db.users.push(user); saveDb(env, db);
  return publicUser(user);
}

export function login(env, db, { email, password }) {
  email = String(email || "").trim().toLowerCase();
  const user = db.users.find((u) => u.email === email);
  if (!user) throw Object.assign(new Error("Identifiants invalides"), { status: 401 });
  const h = hashPw(password, user.salt);
  const a = Buffer.from(h), b = Buffer.from(user.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error("Identifiants invalides"), { status: 401 });
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw Object.assign(new Error("JWT_SECRET must be at least 32 characters"), { status: 503 });
  const token = jwt.sign({ sub: user.id, role: user.role, org: user.org }, env.JWT_SECRET, { expiresIn: "12h" });
  return { token, user: publicUser(user) };
}

export function publicUser(u) { return { id: u.id, email: u.email, role: u.role, org: u.org }; }

export function authMiddleware(env, db, ...roles) {
  return (req, res, next) => {
    try {
      const h = req.headers.authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7) : null;
      if (!token) return res.status(401).json({ error: "auth-required" });
      if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return res.status(503).json({ error: "auth-not-configured" });
      const payload = jwt.verify(token, env.JWT_SECRET);
      const user = db.users.find((u) => u.id === payload.sub);
      if (!user) return res.status(401).json({ error: "unknown-user" });
      if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: "forbidden-role" });
      req.user = user; next();
    } catch { return res.status(401).json({ error: "bad-token" }); }
  };
}
