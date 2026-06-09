const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');

const app = express();

const path = require("path");
app.use(express.static(path.join(__dirname, "../frontend")));

const PORT = 5000;
const SECRET_KEY = 'super_secret';
app.use(cors());
app.use(express.json());

// --- Database Setup ---
const db = new sqlite3.Database('./qrdata.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to QRdata database.');
});

// Users table with role
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'user'
)`);

// QR entries table
db.run(`CREATE TABLE IF NOT EXISTS qr_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qr_code TEXT,
  district TEXT,
  dealership TEXT,
  user_id INTEGER,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
)`);

// --- Middleware ---

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// --- Routes ---

// Register
app.post("/register", async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
      [username, hashedPassword, role || "user"],
      function(err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ id: this.lastID, username, role: role || "user" });
      }
    );
  } catch (err) {
    res.status(500).json({ error: "Server error hashing password" });
  }
});

// Login
app.post("/login", (req, res) => {
  console.log("Raw body:", req.body);
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: "User not found" });

    if (await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: "1h" });
      res.json({ token });
    } else {
      res.status(400).json({ error: "Password incorrect" });
    }
  });
});

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: `Hello ${req.user.username}, you are authenticated!` });
});


// Add QR entry
app.post("/qr", authenticateToken, (req, res) => {
  const { qr_code, district, dealership } = req.body;
  if (!qr_code) return res.status(400).json({ error: "QR code required" });
  
  db.get(
    "SELECT * FROM qr_entries WHERE qr_code = ?",
    [qr_code],
    (err, row) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      if (row) {
        return res.status(400).json({
          error: "Chassis number already exists",
        });
      }
      db.run(
        `INSERT INTO qr_entries (qr_code, district, dealership, user_id) VALUES (?, ?, ?, ?)`,
          [qr_code, district, dealership, req.user.id],
            function(err) {
              if (err) return res.status(400).json({ error: err.message });
                res.json({ id: this.lastID, qr_code, district, dealership });
          });
    }
  )
});

// Get all QR entries (any user)
app.get("/qrtable", authenticateToken, (req, res) => {
  db.all(
    `SELECT qr_entries.id, qr_code, district, dealership, users.username, created_at
     FROM qr_entries
     JOIN users ON qr_entries.user_id = users.id`,
    [],
    (err, rows) => {
      if (err) return res.status(400).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Search/filter QR entries
app.get("/qr/search", authenticateToken, (req, res) => {
  const { user, startDate, endDate } = req.query;
  let query = `SELECT qr_entries.id, qr_code, district, dealership, users.username, created_at
               FROM qr_entries
               JOIN users ON qr_entries.user_id = users.id
               WHERE 1=1`;
  const params = [];

  if (user) {
    query += " AND users.username = ?";
    params.push(user);
  }
  if (startDate) {
    query += " AND created_at >= ?";
    params.push(startDate);
  }
  if (endDate) {
    query += " AND created_at <= ?";
    params.push(endDate);
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(rows);
  });
});

// Export CSV (admin only)
app.get("/qr/export", authenticateToken, requireAdmin, async (req, res) => {
  db.all(
    `SELECT qr_entries.id, qr_code, district, dealership, users.username, created_at
     FROM qr_entries
     JOIN users ON qr_entries.user_id = users.id`,
    [],
    async(err, rows) => {
      if (err) return res.status(400).json({ error: err.message });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("QR Entries");

      worksheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "QR Code", key: "qr_code", width: 20 },
        { header: "District", key: "district", width: 20 },
        { header: "Dealership", key: "dealership", width: 20 },
        { header: "Username", key: "username", width: 20 },
        { header: "Created At", key: "created_at", width: 20 },
      ];

      rows.forEach((row) => {
        worksheet.addRow(row);
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=qr_entries.xlsx"
      );

      await workbook.xlsx.write(res);
      res.end();

    }
  );
});

// --- Start server ---
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
