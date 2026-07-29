// backend/routes/livery.js
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const { saveLivery, getLivery } = require('../store/liveryStore');

// POST /api/livery — protetta: salva SOLO la livrea dell'uid verificato
// dal token, mai un uid letto dal body (evita che un utente salvi la
// livrea di un altro).
router.post('/api/livery', verifyFirebaseToken, async (req, res) => {
    const { liveryColors, liveryParams } = req.body || {};
    if (!liveryColors || typeof liveryColors !== 'object') {
        return res.status(400).json({ error: 'liveryColors mancante o non valido' });
    }
    try {
        const doc = await saveLivery(req.uid, { liveryColors, liveryParams });
        res.status(200).json(doc);
    } catch (error) {
        console.error('❌ Errore salvataggio livrea:', error.message);
        res.status(500).json({ error: 'Errore salvataggio livrea' });
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
