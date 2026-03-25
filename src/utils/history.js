const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../../data/runtime/history.json');

function readHistory() {
    if (!fs.existsSync(HISTORY_FILE)) {
        return {};
    }
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeHistory(data) {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readHistory, writeHistory };
