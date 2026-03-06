const { MongoClient } = require('mongodb');

// Prende la stringa di connessione dalle variabili d'ambiente (o usa locale per test se la metti qui)
const MONGODB_URI = process.env.MONGODB_URI;

let collection;

// Questa è la nostra CACHE IN RAM. Mantiene il gioco velocissimo!
let leaderboardData = {};

// LIMITE RECORD: Riduciamo a 5 per salvare spazio su MongoDB
const MAX_RECORDS_PER_TRACK = 5;

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

            // PULIZIA AUTOMATICA: Se nel DB ci sono già 10 record per qualche pista, 
            // li tagliamo a 5 in modo da alleggerire subito il DB al prossimo salvataggio.
            let needsPruning = false;
            for (const track in leaderboardData) {
                if (leaderboardData[track].length > MAX_RECORDS_PER_TRACK) {
                    leaderboardData[track] = leaderboardData[track].slice(0, MAX_RECORDS_PER_TRACK);
                    needsPruning = true;
                }
            }
            if (needsPruning) saveLeaderboard(); // Salva subito la versione pulita se necessario

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
// LOGICA DEI RECORD AGGIORNATA A 5 POSIZIONI
// ==========================================

// Manteniamo il nome isTop10Record per non dover modificare gli altri file del backend
function isTop10Record(trackName, timeMs) {
    if (!leaderboardData[trackName]) leaderboardData[trackName] = [];
    const trackRecords = leaderboardData[trackName];

    if (trackRecords.length < MAX_RECORDS_PER_TRACK) return true;

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

    // Taglia l'array per tenere solo i migliori 5
    if (leaderboardData[trackName].length > MAX_RECORDS_PER_TRACK) {
        leaderboardData[trackName] = leaderboardData[trackName].slice(0, MAX_RECORDS_PER_TRACK);
    }

    // Invia i dati aggiornati al Cloud!
    saveLeaderboard();

    return leaderboardData[trackName];
}

// Manteniamo il nome getTop10 per non dover modificare gli altri file del backend
function getTop10(trackName) {
    return leaderboardData[trackName] || [];
}

function getAllRecords() {
    return leaderboardData;
}

// Avvia la connessione appena il server si accende
loadLeaderboard();

module.exports = {
    isTop10Record, // Alias per compatibilità con il resto del codice
    addRecord,
    getTop10,      // Alias per compatibilità con il resto del codice
    getAllRecords
};