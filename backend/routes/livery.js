// backend/routes/livery.js
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const { saveLivery, getLivery } = require('../store/liveryStore');
const { generateTheme } = require('../services/themeGenerator');
const { creaLimite } = require('../middleware/limiteRichieste');

// Ogni chiamata a Gemini si paga. Il token Firebase tiene fuori chi non ha un
// account, ma un account si apre in trenta secondi: senza un tetto, una
// persona sola basta a far crescere la bolletta quanto vuole. Dieci temi al
// minuto sono molti di piu' di quanti se ne provino davvero.
const limiteTemi = creaLimite({
    maxRichieste: 10,
    finestraMs: 60 * 1000,
    messaggio: 'Hai chiesto troppi temi di fila, aspetta un minuto'
});

// Una livrea vera pesa ~550 KB di colori. Oltre il doppio non e' piu' una
// livrea: e' qualcuno che usa il database come deposito.
const LIVREA_MAX_BYTE = 1.2 * 1024 * 1024;

// POST /api/livery — protetta: salva SOLO la livrea dell'uid verificato
// dal token, mai un uid letto dal body (evita che un utente salvi la
// livrea di un altro).
router.post('/api/livery', verifyFirebaseToken, async (req, res) => {
    const { liveryColors, liveryParams } = req.body || {};
    if (!liveryColors || typeof liveryColors !== 'object') {
        return res.status(400).json({ error: 'liveryColors mancante o non valido' });
    }
    // Il documento finisce su MongoDB con l'uid come chiave: senza un tetto,
    // il limite vero e' quello del body-parser (5 MB) moltiplicato per
    // quante volte lo si rimanda.
    if (Buffer.byteLength(JSON.stringify({ liveryColors, liveryParams })) > LIVREA_MAX_BYTE) {
        return res.status(413).json({ error: 'Livrea troppo grande' });
    }
    try {
        const doc = await saveLivery(req.uid, { liveryColors, liveryParams });
        res.status(200).json(doc);
    } catch (error) {
        console.error('❌ Errore salvataggio livrea:', error.message);
        res.status(500).json({ error: 'Errore salvataggio livrea' });
    }
});

// POST /api/livery/generate-theme — protetta: la chiamata a Gemini ha un
// costo reale, non va lasciata pubblica (stesso motivo per cui il
// salvataggio richiede token, qui è per evitare abuso/costo, non
// impersonificazione).
router.post('/api/livery/generate-theme', limiteTemi, verifyFirebaseToken, async (req, res) => {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'prompt mancante o non valido' });
    }
    if (prompt.trim().length > 200) {
        return res.status(400).json({ error: 'prompt troppo lungo (max 200 caratteri)' });
    }
    try {
        const theme = await generateTheme(prompt.trim());
        res.status(200).json(theme);
    } catch (error) {
        console.error('❌ Errore generazione tema:', error.message);
        res.status(500).json({ error: 'Errore generazione tema' });
    }
});

// GET /api/livery/:uid — pubblica: la livrea è estetica, visibile a
// chiunque guardi l'auto in pista, nessun token richiesto in lettura.
router.get('/api/livery/:uid', async (req, res) => {
    try {
        const doc = await getLivery(req.params.uid);
        if (!doc) return res.status(404).json({ error: 'Livrea non trovata' });
        res.json(doc);
    } catch (error) {
        console.error('❌ Errore lettura livrea:', error.message);
        res.status(500).json({ error: 'Errore lettura livrea' });
    }
});

module.exports = router;
