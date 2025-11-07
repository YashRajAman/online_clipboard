const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create/connect to database
const db = new sqlite3.Database(path.join(__dirname, 'clipboard.db'));

// Initialize database
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS clipboard (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Insert initial record if table is empty
    db.get("SELECT COUNT(*) as count FROM clipboard", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO clipboard (content) VALUES (?)", ["Welcome to Online Clipboard! Start typing or paste your content here."]);
        }
    });
});

module.exports = db;