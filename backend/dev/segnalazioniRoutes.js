// backend/dev/segnalazioniRoutes.js
//
// Route di sviluppo per le segnalazioni in gioco (tasto M). Registrate solo
// fuori produzione da server.js, come /dev/minimap. Sottili per scelta: la
// logica sta nello store, che è testabile senza rete.
const express = require('express');
const store = require('./segnalazioniStore');

function registra(app, file = store.FILE_DEFAULT) {
    // Parser locale: le route stanno PRIMA dei parser globali di server.js,
    // esattamente come /dev/minimap. 32kb sono un'abbondanza per un record
    // che ne pesa meno di uno.
    app.post('/dev/f1-marker', express.json({ limit: '32kb' }), (req, res) => {
        const esito = store.aggiungi(req.body, file);
        if (!esito.ok) return res.status(400).json(esito);
        const { trackId, pos } = req.body;
        console.log(`📍 Segnalazione ${esito.n} — ${trackId} (${pos.x}, ${pos.z})`);
        res.json(esito);
    });

    app.post('/dev/f1-marker/annulla', express.json({ limit: '4kb' }), (req, res) => {
        const sessione = req.body && req.body.sessione;
        if (typeof sessione !== 'string' || !sessione) {
            return res.status(400).json({ ok: false, errore: 'sessione mancante' });
        }
        const esito = store.annullaUltima(sessione, file);
        if (esito.ok) console.log(`📍 Segnalazione ${esito.n} annullata`);
        res.json(esito);
    });
}

module.exports = { registra };
