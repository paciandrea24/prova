// backend/routes/f1Stagioni.js
//
// Le stagioni salvate: elenco, creazione, lettura. Sono l'unica cosa del gioco
// legata a un ACCOUNT, quindi passano di qui e non dal socket.
//
// PERCHE' HTTP E NON SOCKET. Il socket sa il colore e un gettone di lobby, non
// l'account: l'uid che `joinF1Game` porta con se' e' DICHIARATO dal client e
// nessuno lo verifica — va benissimo per chiedere una livrea (e' estetica), non
// per decidere di chi e' un salvataggio. Qui l'uid arriva dal token Firebase
// verificato, esattamente come in routes/livery.js.
//
// PERCHE' I PILOTI LI DICE LA PARTITA. Se la lista arrivasse dal client, uno
// potrebbe infilare l'uid di un estraneo fra i piloti e fargli comparire nella
// lista una stagione che non ha mai giocato. La fonte e' `activeGames`: chi e'
// davvero connesso a quella partita in questo momento.
const express = require('express');
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const seasonStore = require('../store/seasonStore');
const { activeGames } = require('../store/activeGames');
const { listTracks } = require('../sockets/games/trackLoader');
const { pickBotColors, MAX_GRID_SIZE } = require('../sockets/games/f1Bot');
const F1Stagione = require('../../frontend/shared/f1Stagione.js');

const NOME_MAX = 40;

// I piloti della stagione: gli umani connessi a quella partita, piu' i bot che
// servono a riempire la griglia. Fissati QUI una volta sola e mai piu' toccati:
// e' quello che rende confrontabili le classifiche fra un weekend e l'altro
// (Rif. docs/superpowers/specs/2026-08-19-f1-stagioni-design.md, «Il modello
// dei dati»).
//
// I bot hanno colore e nome stabili per tutta la stagione. Oggi nascono ad ogni
// partita con colori sorteggiati; dal passo 3 sara' la stagione a dettarli.
function costruisciPiloti(game, gridSize, botsEnabled) {
    const umani = Object.values(game.players)
        .filter(p => !p.isBot)
        .map(p => ({ uid: p.uid || null, colore: p.color, bot: false }));
    const posti = Math.min(MAX_GRID_SIZE, Math.max(umani.length, gridSize));
    const quantiBot = botsEnabled === false ? 0 : posti - umani.length;
    const coloriBot = pickBotColors(umani.map(u => u.colore), quantiBot);
    const bot = coloriBot.map((colore, i) => ({ uid: null, colore, bot: true, nome: `Bot ${i + 1}` }));
    return umani.concat(bot);
}

function creaRouter(opzioni) {
    const autentica = (opzioni && opzioni.autentica) || verifyFirebaseToken;
    const router = express.Router();

    // Le stagioni in cui corro. Non serve la partita: e' roba dell'account.
    router.get('/api/f1/stagioni', autentica, async (req, res) => {
        try {
            const stagioni = await seasonStore.elencoPerUid(req.uid);
            res.json({ stagioni });
        } catch (err) {
            console.error('GET /api/f1/stagioni:', err);
            res.status(500).json({ error: 'Impossibile leggere le stagioni' });
        }
    });

    router.post('/api/f1/stagioni', autentica, express.json(), async (req, res) => {
        const { lobbyId, nome, quanteGare, gridSize, botsEnabled } = req.body || {};
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') {
            return res.status(400).json({ error: 'Nessuna partita F1 attiva in questa lobby' });
        }
        // Chi crea dev'essere in pista: senza questo si potrebbe creare una
        // stagione dentro la partita di qualcun altro, e infilarcisi dentro.
        const presenti = Object.values(game.players).filter(p => !p.isBot).map(p => p.uid);
        if (!presenti.includes(req.uid)) {
            return res.status(403).json({ error: 'Non stai giocando in questa lobby' });
        }

        const piste = listTracks().map(t => t.id);
        const { min, max } = F1Stagione.intervalloGare(piste.length);
        const n = Number(quanteGare);
        if (!Number.isFinite(n) || n < min || n > max) {
            return res.status(400).json({ error: `Le gare devono essere fra ${min} e ${max}` });
        }

        const piloti = costruisciPiloti(game, Number(gridSize) || 6, botsEnabled !== false);
        const stagione = F1Stagione.creaStagione({
            nome: String(nome || '').slice(0, NOME_MAX),
            creataDa: req.uid,
            piloti,
            calendario: F1Stagione.sorteggiaCalendario(piste, n),
            impostazioni: { botsEnabled: botsEnabled !== false, gridSize: piloti.length },
        });

        try {
            const salvata = await seasonStore.salva(stagione);
            res.status(201).json({ stagione: salvata });
        } catch (err) {
            console.error('POST /api/f1/stagioni:', err);
            res.status(500).json({ error: 'Impossibile salvare la stagione' });
        }
    });

    // 404 e non 403 per chi non ci corre: che una stagione ESISTA con quell'id
    // e' gia' un'informazione, e non ha ragione di uscire.
    router.get('/api/f1/stagioni/:id', autentica, async (req, res) => {
        try {
            const stagione = await seasonStore.leggi(req.params.id);
            if (!stagione) return res.status(404).json({ error: 'Stagione non trovata' });
            const ciCorro = (stagione.piloti || []).some(p => p.uid === req.uid);
            if (!ciCorro) return res.status(404).json({ error: 'Stagione non trovata' });
            res.json({ stagione });
        } catch (err) {
            console.error('GET /api/f1/stagioni/:id:', err);
            res.status(500).json({ error: 'Impossibile leggere la stagione' });
        }
    });

    return router;
}

module.exports = { creaRouter, costruisciPiloti };
