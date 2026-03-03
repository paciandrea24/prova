const fs = require('fs');
const path = require('path');

// Il percorso in cui salveremo il nostro file JSON
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

// Struttura di default se il file non esiste ancora
let leaderboardData = {
    // Esempio di come sarà strutturato internamente:
    // "Monza": [],
    // "Spa-Francorchamps": [],
    // "Baku (Diagonal Version)": []
};

// 1. CARICAMENTO INIZIALE
function loadLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            leaderboardData = JSON.parse(data);
            console.log("🏆 Leaderboard caricata con successo!");
        } else {
            // Se non esiste, lo crea vuoto
            saveLeaderboard();
        }
    } catch (error) {
        console.error("❌ Errore nel caricamento della Leaderboard:", error);
    }
}

// 2. SALVATAGGIO SU FILE
function saveLeaderboard() {
    try {
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboardData, null, 4));
    } catch (error) {
        console.error("❌ Errore nel salvataggio della Leaderboard:", error);
    }
}

// 3. CONTROLLA SE È UN NUOVO RECORD (Top 10)
// Restituisce true se il tempo merita di entrare in classifica
function isTop10Record(trackName, timeMs) {
    if (!leaderboardData[trackName]) {
        leaderboardData[trackName] = [];
    }

    const trackRecords = leaderboardData[trackName];

    // Se ci sono meno di 10 record, entra di diritto!
    if (trackRecords.length < 10) return true;

    // Se ci sono già 10 record, controlliamo se il nostro tempo è MIGLIORE (minore) dell'ultimo (il 10°)
    const worstRecord = trackRecords[trackRecords.length - 1];
    if (timeMs < worstRecord.time) return true;

    return false;
}

// 4. SALVA IL NUOVO RECORD
function addRecord(trackName, playerName, playerColor, timeMs) {
    if (!leaderboardData[trackName]) {
        leaderboardData[trackName] = [];
    }

    const newRecord = {
        name: playerName.toUpperCase().substring(0, 3), // Forza 3 caratteri maiuscoli (Es. "AND")
        color: playerColor,
        time: timeMs,
        date: new Date().toISOString()
    };

    leaderboardData[trackName].push(newRecord);

    // Riordina i record dal più veloce (tempo minore) al più lento
    leaderboardData[trackName].sort((a, b) => a.time - b.time);

    // Taglia l'array per mantenere SOLO i migliori 10!
    if (leaderboardData[trackName].length > 10) {
        leaderboardData[trackName] = leaderboardData[trackName].slice(0, 10);
    }

    // Salva sul file fisico
    saveLeaderboard();

    return leaderboardData[trackName]; // Restituisce la nuova Top 10 aggiornata
}

// 5. OTTIENI LA TOP 10 DI UNA MAPPA
function getTop10(trackName) {
    return leaderboardData[trackName] || [];
}

// Aggiungi questa funzione:
function getAllRecords() {
    return leaderboardData;
}

// Eseguiamo il caricamento appena il server si avvia
loadLeaderboard();

module.exports = {
    isTop10Record,
    addRecord,
    getTop10,
    getAllRecords
};