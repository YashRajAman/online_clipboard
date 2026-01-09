const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));

// HTTP Routes
app.get('/api/clipboard', (req, res) => {
    db.get("SELECT * FROM clipboard ORDER BY id DESC LIMIT 1", (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row || { content: '' });
    });
});

app.post('/api/clipboard', (req, res) => {
    const { content } = req.body;
    
    if (!content && content !== '') {
        res.status(400).json({ error: 'Content is required' });
        return;
    }

    // Update the latest entry or insert new one
    db.get("SELECT id FROM clipboard ORDER BY id DESC LIMIT 1", (err, row) => {
        if (row) {
            db.run(
                "UPDATE clipboard SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [content, row.id],
                function(err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    // Broadcast to all WebSocket clients
                    broadcast({ type: 'update', content });
                    
                    res.json({ 
                        id: row.id, 
                        content,
                        message: 'Clipboard updated successfully' 
                    });
                }
            );
        } else {
            db.run(
                "INSERT INTO clipboard (content) VALUES (?)",
                [content],
                function(err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    
                    broadcast({ type: 'update', content });
                    
                    res.json({ 
                        id: this.lastID,
                        content,
                        message: 'Clipboard created successfully' 
                    });
                }
            );
        }
    });
});

// Get clipboard history
app.get('/api/clipboard/history', (req, res) => {
    db.all("SELECT * FROM clipboard ORDER BY updated_at DESC LIMIT 10", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Start HTTP server
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// WebSocket setup for real-time updates
const wss = new WebSocket.Server({ server });

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('New WebSocket client connected');

    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}