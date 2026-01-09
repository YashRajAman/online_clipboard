// Global variables
let ws = null;
let autoSaveTimeout = null;
let lastContent = '';
const ENCRYPTION_KEY = 'online-clipboard-secure-key'; // Shared passphrase
let cachedKey = null;

// DOM elements
const clipboardContent = document.getElementById('clipboardContent');
const saveBtn = document.getElementById('saveBtn');
const refreshBtn = document.getElementById('refreshBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const charCount = document.getElementById('charCount');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    loadClipboard();
    setupEventListeners();
});

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        updateConnectionStatus('connected');
        showNotification('Connected to server', 'success');
    };
    
    ws.onclose = () => {
        updateConnectionStatus('disconnected');
        showNotification('Disconnected from server', 'error');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error', 'error');
    };
    
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
            const content = await decryptText(data.content);
            if (content !== clipboardContent.value) {
                clipboardContent.value = content;
                updateCharCount();
                showNotification('Clipboard updated from another device', 'info');
            }
        }
    };
}

// Update connection status indicator
function updateConnectionStatus(status) {
    statusDot.className = `status-dot ${status}`;
    statusText.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
}

// Setup event listeners
function setupEventListeners() {
    // Text area input event
    clipboardContent.addEventListener('input', () => {
        updateCharCount();
        
        // Auto-save after 2 seconds of no typing
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            if (clipboardContent.value !== lastContent) {
                saveClipboard(true);
            }
        }, 2000);
    });
    
    // Button click events
    saveBtn.addEventListener('click', () => saveClipboard());
    refreshBtn.addEventListener('click', loadClipboard);
    copyBtn.addEventListener('click', copyToClipboard);
    clearBtn.addEventListener('click', clearClipboard);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + S to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveClipboard();
        }
        // Ctrl/Cmd + R to refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            loadClipboard();
        }
    });
}

// Update character count
function updateCharCount() {
    const count = clipboardContent.value.length;
    charCount.textContent = count.toLocaleString();
}

// Load clipboard content
async function loadClipboard() {
    try {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        
        const response = await fetch('/api/clipboard');
        const data = await response.json();
        
        if (data.content !== undefined) {
            const content = await decryptText(data.content);
            clipboardContent.value = content;
            lastContent = content;
            updateCharCount();
            showNotification('Clipboard loaded', 'success');
        }
    } catch (error) {
        console.error('Error loading clipboard:', error);
        showNotification('Failed to load clipboard', 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    }
}

// Save clipboard content
async function saveClipboard(isAutoSave = false) {
    try {
        const content = clipboardContent.value;
        
        if (!isAutoSave) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        const encryptedContent = await encryptText(content);
        
        const response = await fetch('/api/clipboard', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: encryptedContent }),
        });
        
        if (response.ok) {
            lastContent = content;
            if (!isAutoSave) {
                showNotification('Clipboard saved successfully', 'success');
            }
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Error saving clipboard:', error);
        showNotification('Failed to save clipboard', 'error');
    } finally {
        if (!isAutoSave) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
        }
    }
}

// Copy to clipboard
async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(clipboardContent.value);
        showNotification('Copied to clipboard!', 'success');
        
        // Visual feedback
        copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy to Clipboard';
        }, 2000);
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        // Fallback method
        clipboardContent.select();
        document.execCommand('copy');
        showNotification('Copied to clipboard!', 'success');
    }
}

// Clear clipboard
async function clearClipboard() {
    if (confirm('Are you sure you want to clear the clipboard?')) {
        clipboardContent.value = '';
        updateCharCount();
        await saveClipboard();
        showNotification('Clipboard cleared', 'info');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// --- Encryption Helpers ---

async function getCryptoKey() {
    if (cachedKey) return cachedKey;
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(ENCRYPTION_KEY),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    // Use a fixed salt to ensure the same key is derived on all devices
    cachedKey = await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode("online-clipboard-salt"),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    return cachedKey;
}

async function encryptText(text) {
    try {
        const key = await getCryptoKey();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encoded = enc.encode(text);
        
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encoded
        );
        
        // Combine IV and ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        
        return arrayBufferToBase64(combined);
    } catch (e) {
        console.error('Encryption failed:', e);
        return text;
    }
}

async function decryptText(base64) {
    try {
        const combined = base64ToArrayBuffer(base64);
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        const key = await getCryptoKey();
        
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(iv) },
            key,
            ciphertext
        );
        
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (e) {
        // Return original text if decryption fails (handles legacy plain text)
        return base64;
    }
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    constHZ = 0x8000; // Chunk size to avoid stack overflow on large texts
    for (let i = 0; i < len; i += constHZ) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + constHZ));
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}