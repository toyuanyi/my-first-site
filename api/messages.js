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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    await ensureTable();

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

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    tableReady = undefined;
    return res.status(500).json({ error: "伺服器發生錯誤，請稍後再試" });
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
