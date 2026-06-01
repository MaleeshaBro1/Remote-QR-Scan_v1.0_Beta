const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// Open database
const db = new sqlite3.Database('./qrdata.db', (err) => {
  if (err) return console.error('DB error:', err.message);
  console.log('Connected to QRdata database.');
});

// Users to create
const usersToCreate = [
  { username: "admin", password: "123456789", role: "admin" },
  { username: "user", password: "1234", role: "user" },
];

// Function to add users sequentially
(async () => {
  for (const user of usersToCreate) {
    try {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
          [user.username, hashedPassword, user.role],
          function(err) {
            if (err) {
              console.error(`Error creating ${user.username}:`, err.message);
              resolve(); // Continue even if one fails
            } else {
              console.log(`Created ${user.username} with role ${user.role}`);
              resolve();
            }
          }
        );
      });
    } catch (err) {
      console.error(`Hashing error for ${user.username}:`, err.message);
    }
  }

  db.close((err) => {
    if (err) console.error('Error closing DB:', err.message);
    else console.log('Database closed. All users processed.');
  });
})();