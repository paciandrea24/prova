// backend/routes/admin.js
//
// Chi puo' vedere gli strumenti di sviluppo dentro il gioco (pannello di
// taratura F9, premiazione finta F8, usura/guasti G, hitbox, segnalazioni...).
//
// ⚠️ NON E' UNA BARRIERA DI SICUREZZA, ed e' giusto dirlo qui: tutto quel che
// sblocca sta nel client, e chi sa aprire gli strumenti del browser ci arriva
// comunque. Serve a togliere di mezzo roba da sviluppo a chi gioca e basta,
// non a proteggere un segreto. Per quello non c'e' niente da proteggere: gli
// strumenti leggono lo stato che il giocatore ha gia'.
//
// La lista sta in una VARIABILE D'AMBIENTE e non nelle preferenze
// dell'account: le preferenze le scrive il giocatore, e un permesso che ti dai
// da solo non e' un permesso.
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');

// F1_ADMIN_UIDS: uid Firebase separati da virgola. Assente = nessun admin,
// che e' la condizione giusta per un server pubblico appena acceso.
function uidAmministratori() {
    return String(process.env.F1_ADMIN_UIDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function eAdmin(uid) {
    return !!uid && uidAmministratori().includes(uid);
}

// GET /api/admin — dice a chi chiede se e' un amministratore.
//
// Restituisce anche il PROPRIO uid, e non e' una svista: e' il modo in cui ti
// leggi l'identificativo da mettere in F1_ADMIN_UIDS la prima volta, senza
// doverlo cercare nella console di Firebase. L'uid non e' un segreto — viaggia
// gia' nello stato di gara per recuperare le livree.
router.get('/api/admin', verifyFirebaseToken, (req, res) => {
    res.json({ uid: req.uid, admin: eAdmin(req.uid) });
});

module.exports = router;
module.exports.eAdmin = eAdmin;
module.exports.uidAmministratori = uidAmministratori;
