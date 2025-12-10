// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// PUBLIC MAPPES MED STATISKE FILER (Render)
app.use(express.static(path.join(__dirname, 'public')));

// DATABASE FIL
const DB_FILE = path.join(__dirname, 'db.json');
let db = { times: [] };

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) {
        console.error("Fejl ved læsning af db.json", e);
    }
} else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// API ROUTES
app.get('/api/times', (req, res) => {
    const date = req.query.date;
    if (date) return res.json(db.times.filter(t => t.date === date));
    res.json(db.times);
});

app.post('/api/book', (req, res) => {
    const { date, time, name, phone, note } = req.body;
    if (!date || !time || !name)
        return res.status(400).json({ error: "Manglende data" });

    const slot = db.times.find(t => t.date === date && t.time === time);
    if (!slot) return res.status(404).json({ error: "Tid findes ikke" });
    if (slot.booked) return res.status(409).json({ error: "Allerede booket" });

    slot.booked = true;
    slot.name = name;
    slot.phone = phone || "";
    slot.note = note || "";
    slot.booked_at = new Date().toISOString();

    saveDB();
    res.json({ message: "Booking bekræftet" });
});

app.post('/api/admin/add-time', (req, res) => {
    const { date, time } = req.body;
    if (!date || !time)
        return res.status(400).json({ error: "Manglende data" });

    const exists = db.times.find(t => t.date === date && t.time === time);
    if (exists)
        return res.status(409).json({ error: "Findes allerede" });

    db.times.push({ date, time, booked: false });
    saveDB();
    res.json({ message: "Tid tilføjet" });
});

app.post('/api/admin/delete-time', (req, res) => {
    const { date, time } = req.body;
    db.times = db.times.filter(t => !(t.date === date && t.time === time));
    saveDB();
    res.json({ message: "Tid slettet" });
});

// HEALTH ENDPOINT
app.get('/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Server kører på port ${PORT}`));
