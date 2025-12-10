// server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
// Hvis du vil serve static filer fra public folder (valgfrit)
app.use(express.static(path.join(__dirname, "public")));

// Brug DATABASE_URL fra Render (fx: postgres://user:pass@host:5432/dbname)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: environment variable DATABASE_URL is not set.");
  process.exit(1);
}

// På Render skal SSL bruges (rejectUnauthorized false)
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialiser tabeller (kører ved start)
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS times (
        id SERIAL PRIMARY KEY,
        date VARCHAR(20) NOT NULL,
        time VARCHAR(20) NOT NULL,
        booked BOOLEAN DEFAULT false,
        name VARCHAR(200),
        phone VARCHAR(50),
        note TEXT,
        booked_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_times_date_time ON times(date, time);
    `);

    // bookings kan hentes fra times hvor booked = true, men laver tabel hvis du vil adskille
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        time_id INTEGER REFERENCES times(id),
        name VARCHAR(200),
        phone VARCHAR(50),
        note TEXT,
        booked_at TIMESTAMP DEFAULT now()
      );
    `);
    console.log("DB initialized");
  } catch (err) {
    console.error("DB init error:", err);
  } finally {
    client.release();
  }
}

// Call init
initDB().catch(err => console.error(err));

// ---------- API ----------

// Health
app.get("/health", (req, res) => res.json({ status: "ok" }));

// GET /api/times?date=YYYY-MM-DD  (if no date -> return all)
app.get("/api/times", async (req, res) => {
  const date = req.query.date;
  try {
    if (date) {
      const result = await pool.query(
        "SELECT * FROM times WHERE date = $1 ORDER BY time",
        [date]
      );
      return res.json(result.rows);
    } else {
      const result = await pool.query("SELECT * FROM times ORDER BY date, time");
      return res.json(result.rows);
    }
  } catch (err) {
    console.error("GET /api/times error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/add-time  { date, time }
app.post("/api/admin/add-time", async (req, res) => {
  const { date, time } = req.body;
  if (!date || !time) return res.status(400).json({ error: "date and time required" });

  try {
    // Use INSERT ... ON CONFLICT to avoid duplicates because of unique index
    const q = `
      INSERT INTO times(date, time, booked)
      VALUES ($1, $2, false)
      ON CONFLICT ON CONSTRAINT ux_times_date_time
      DO NOTHING
      RETURNING *;
    `;
    const result = await pool.query(q, [date, time]);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Tid findes allerede" });
    }
    return res.json({ message: "Tid tilføjet", slot: result.rows[0] });
  } catch (err) {
    console.error("POST /api/admin/add-time error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/delete-time  { date, time }  (keeps API similar to yours)
app.post("/api/admin/delete-time", async (req, res) => {
  const { date, time } = req.body;
  if (!date || !time) return res.status(400).json({ error: "date and time required" });

  try {
    const result = await pool.query("DELETE FROM times WHERE date = $1 AND time = $2 RETURNING *", [date, time]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Tid ikke fundet" });
    return res.json({ message: "Tid slettet" });
  } catch (err) {
    console.error("POST /api/admin/delete-time error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/book  { date, time, name, phone, note }
app.post("/api/book", async (req, res) => {
  const { date, time, name, phone, note } = req.body;
  if (!date || !time || !name) return res.status(400).json({ error: "date,time,name required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // find the slot FOR UPDATE (avoid race)
    const findQ = "SELECT * FROM times WHERE date = $1 AND time = $2 FOR UPDATE";
    const findRes = await client.query(findQ, [date, time]);
    if (findRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tid findes ikke" });
    }
    const slot = findRes.rows[0];
    if (slot.booked) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Tid allerede booket" });
    }

    // mark booked on times
    const booked_at = new Date();
    const updateQ = "UPDATE times SET booked = true, name=$1, phone=$2, note=$3, booked_at=$4 WHERE id = $5 RETURNING *";
    const updateRes = await client.query(updateQ, [name, phone || null, note || null, booked_at, slot.id]);

    // insert to bookings table
    await client.query(
      "INSERT INTO bookings(time_id, name, phone, note, booked_at) VALUES ($1,$2,$3,$4,$5)",
      [slot.id, name, phone || null, note || null, booked_at]
    );

    await client.query("COMMIT");
    return res.json({ message: "Booking bekræftet", slot: updateRes.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /api/book error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// Fallback route for '/' -> option to show simple message
app.get("/", (req, res) => res.send("Villads Cutz API (Postgres) is running"));

app.listen(PORT, () => console.log(`Server kører på port ${PORT}`));
