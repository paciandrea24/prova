// backend/routes/preferenze.js
//
// Le preferenze di gioco legate all'account. Nate per il volume (blocco I):
// «possiamo fare che lo manteniamo come valore associato agli account, cosi'
// chi ha l'account non deve impostarlo ogni volta?».
//
// ⚠️ ENTRAMBE PROTETTE, anche la lettura — a differenza della livrea, che e'
// pubblica perche' e' estetica e la vedono tutti in pista. Le preferenze sono
// roba di chi le ha scritte: l'uid arriva SEMPRE dal token verificato, mai dal
// percorso o dal corpo, cosi' non esiste un modo di leggere o scrivere quelle
// di un altro.
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const { salvaPreferenze, leggiPreferenze } = require('../store/preferenzeStore');

// GET /api/preferenze — quelle di chi chiede, o un oggetto vuoto se non ne ha
// mai salvate. ⚠️ 200 con {} e non 404: «non ho preferenze» e' la condizione
// NORMALE di un account nuovo, non un errore da gestire nel client.
router.get('/api/preferenze', verifyFirebaseToken, async (req, res) => {
    try {
        const doc = await leggiPreferenze(req.uid);
        if (!doc) return res.json({});
        const { _id, updatedAt, ...preferenze } = doc;
        res.json(preferenze);
    } catch (error) {
        console.error('❌ Errore lettura preferenze:', error.message);
        res.status(500).json({ error: 'Errore lettura preferenze' });
    }
});

// POST /api/preferenze — unisce quello che arriva a quello che c'e' gia'.
// Il corpo passa per il filtro dello store: i campi non previsti spariscono,
// quindi questa rotta non e' un deposito.
router.post('/api/preferenze', verifyFirebaseToken, express.json({ limit: '4kb' }), async (req, res) => {
    try {
        const doc = await salvaPreferenze(req.uid, req.body || {});
        res.json(doc);
    } catch (error) {
        // Senza MONGODB_URI (sviluppo in locale) non si salva, e va bene cosi':
        // il client tiene comunque il suo valore in localStorage. Si risponde
        // con un codice che dice «non adesso», non «hai sbagliato tu».
        if (/MONGODB_URI/.test(error.message)) {
            return res.status(503).json({ error: 'Archivio preferenze non configurato' });
        }
        console.error('❌ Errore salvataggio preferenze:', error.message);
        res.status(500).json({ error: 'Errore salvataggio preferenze' });
    }
});

module.exports = router;
