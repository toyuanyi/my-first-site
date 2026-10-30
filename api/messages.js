import { createHash, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// The GitHub Pages copy of the site calls this API from another origin.
const ALLOWED_ORIGINS = ["https://toyuanyi.github.io"];

const NAME_MAX = 30;
const MESSAGE_MAX = 200;
const LIST_LIMIT = 50;

let tableReady;
function ensureTable() {
  tableReady ??= sql`
    CREATE TABLE IF NOT EXISTS guestbook (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  return tableReady;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    await ensureTable();

    // Lets the page check a password before showing delete buttons.
    if (req.method === "GET" && req.query.auth === "check") {
      return res.status(isAdmin(req) ? 204 : 401).end();
    }

    if (req.method === "DELETE") {
      if (!isAdmin(req)) return res.status(401).json({ error: "沒有刪除權限" });
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "留言編號不正確" });
      const deleted = await sql`DELETE FROM guestbook WHERE id = ${id} RETURNING id`;
      if (deleted.length === 0) return res.status(404).json({ error: "找不到這則留言" });
      return res.status(204).end();
    }

    if (req.method === "GET") {
      const rows = await sql`
        SELECT id, name, message, created_at
        FROM guestbook
        ORDER BY created_at DESC
        LIMIT ${LIST_LIMIT}`;
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

      // Honeypot: real visitors never see or fill this field.
      if (body.website) return res.status(201).json({ ok: true });

      const name = String(body.name ?? "").trim();
      const message = String(body.message ?? "").trim();
      if (!name || name.length > NAME_MAX) {
        return res.status(400).json({ error: `名字請填 1–${NAME_MAX} 個字` });
      }
      if (!message || message.length > MESSAGE_MAX) {
        return res.status(400).json({ error: `留言請填 1–${MESSAGE_MAX} 個字` });
      }

      const [row] = await sql`
        INSERT INTO guestbook (name, message)
        VALUES (${name}, ${message})
        RETURNING id, name, message, created_at`;
      return res.status(201).json(row);
    }

    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    tableReady = undefined;
    return res.status(500).json({ error: "伺服器發生錯誤，請稍後再試" });
  }
}

// ADMIN_TOKEN is set in the Vercel project's environment variables.
// Without it, deleting is disabled for everyone.
function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  const header = req.headers.authorization || "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
