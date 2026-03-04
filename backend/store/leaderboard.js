const { MongoClient } = require('mongodb');

// Prende la stringa di connessione dalle variabili d'ambiente (o usa locale per test se la metti qui)
const MONGODB_URI = process.env.MONGODB_URI;

let collection;

// Questa è la nostra CACHE IN RAM. Mantiene il gioco velocissimo!
let leaderboardData = {};

async function loadLeaderboard() {
    if (!MONGODB_URI) {
        console.warn("⚠️ MONGODB_URI mancante! Uso solo la memoria RAM temporanea.");
        return;
    }

    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('RacingGameDB'); // Nome del tuo database
        collection = db.collection('leaderboards');

        // Cerchiamo il nostro "file JSON" nel database
        const data = await collection.findOne({ _id: 'global_leaderboard' });

        if (data && data.records) {
            leaderboardData = data.records;
            console.log("🏆 Leaderboard scaricata dal Database Cloud con successo!");
        } else {
            // Se non esiste ancora, lo creiamo vuoto
            await collection.insertOne({ _id: 'global_leaderboard', records: {} });
            console.log("🆕 Creato nuovo file leaderboard nel Database Cloud.");
        }
    } catch (error) {
        console.error("❌ Errore di connessione a MongoDB:", error);
    }
}

// Invia i dati al DB in modo asincrono (in background)
async function saveLeaderboard() {
    if (!collection) return;
    try {
        await collection.updateOne(
            { _id: 'global_leaderboard' },
            { $set: { records: leaderboardData } },
            { upsert: true }
        );
        console.log("💾 Record salvato sul Database Cloud!");
    } catch (error) {
        console.error("❌ Errore nel salvataggio su DB:", error);
    }
}

// ==========================================
// LE FUNZIONI SOTTO RIMANGONO IDENTICHE A PRIMA!
// ==========================================

function isTop10Record(trackName, timeMs) {
    if (!leaderboardData[trackName]) leaderboardData[trackName] = [];
    const trackRecords = leaderboardData[trackName];
    if (trackRecords.length < 10) return true;
    const worstRecord = trackRecords[trackRecords.length - 1];
    return timeMs < worstRecord.time;
}

function addRecord(trackName, playerName, playerColor, timeMs) {
    if (!leaderboardData[trackName]) leaderboardData[trackName] = [];

    const newRecord = {
        name: playerName.toUpperCase().substring(0, 3),
        color: playerColor,
        time: timeMs,
        date: new Date().toISOString()
    };

    leaderboardData[trackName].push(newRecord);
    leaderboardData[trackName].sort((a, b) => a.time - b.time);

    if (leaderboardData[trackName].length > 10) {
        leaderboardData[trackName] = leaderboardData[trackName].slice(0, 10);
    }

    // Qui chiama la nuova funzione che invia i dati al Cloud!
    saveLeaderboard();

    return leaderboardData[trackName];
}

function getTop10(trackName) {
    return leaderboardData[trackName] || [];
}

function getAllRecords() {
    return leaderboardData;
}

// Avvia la connessione appena il server si accende
loadLeaderboard();

module.exports = {
    isTop10Record,
    addRecord,
    getTop10,
    getAllRecords
};