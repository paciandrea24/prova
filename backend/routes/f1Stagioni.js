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

        // Quanti piloti si corre decide QUALI PISTE possono entrare in
        // calendario, non il contrario: una corsia box corta non ospita venti
        // box (vedi maxDrivers in trackLoader.listTracks), quindi con venti
        // piloti quella pista semplicemente non si corre.
        //
        // La strada opposta — un tetto di piloti pari alla pista piu' stretta
        // di tutte — era gia' scritta e l'ho buttata: basta UNA pista stretta
        // perche' diventi impossibile creare qualunque campionato, e le piste
        // le disegna l'utente con l'editor. L'ha dimostrato un test rosso, dove
        // una pista di prova temporanea faceva rifiutare anche sei piloti.
        //
        // Il controllo sta QUI e non solo nella schermata: un limite che vive
        // solo nella UI e' un limite che il server non ha.
        const quantiPiloti = Number(gridSize) || 6;
        const adatte = listTracks().filter(t => (t.maxDrivers || MAX_GRID_SIZE) >= quantiPiloti);
        const piste = adatte.map(t => t.id);

        const { min, max } = F1Stagione.intervalloGare(piste.length);
        const n = Number(quanteGare);
        if (!Number.isFinite(n) || n < min || n > max) {
            return res.status(400).json({
                error: `Con ${quantiPiloti} piloti ci sono ${piste.length} piste adatte:`
                    + ` le gare devono essere fra ${min} e ${max}`,
            });
        }
        // Meno piste adatte del minimo di gare: non e' una questione di
        // arrotondamenti, quel campionato non esiste. Dirlo con i numeri.
        if (piste.length < F1Stagione.MIN_GARE) {
            return res.status(400).json({
                error: `Con ${quantiPiloti} piloti solo ${piste.length} piste hanno i box per tutti,`
                    + ` e un campionato ne vuole almeno ${F1Stagione.MIN_GARE}: servono meno piloti`,
            });
        }

        const piloti = costruisciPiloti(game, quantiPiloti, botsEnabled !== false);
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

            // Se la richiesta dice da quale lobby arriva, si risponde anche se
            // quella stagione e' ripartibile QUI e ORA. La regola e' dettata
            // dall'utente: si riprende solo con esattamente gli stessi
            // giocatori, ne' uno in meno ne' uno in piu' (vedi
            // F1Stagione.siPuoRiprendere, dove sta anche la conseguenza da
            // conoscere: se un amico non torna piu', quel salvataggio resta
            // bloccato).
            //
            // Si RISPONDE lo stesso, con l'esito accanto invece di negare: una
            // stagione che non si puo' riprendere deve comunque comparire e
            // dire perche', se no sembra sparita.
            let ripresa = null;
            const game = activeGames.get(req.query.lobbyId);
            if (game && game.gameId === 'f1') {
                const uidPresenti = Object.values(game.players)
                    .filter(p => !p.isBot && p.uid).map(p => p.uid);
                ripresa = F1Stagione.siPuoRiprendere(stagione, uidPresenti);
            }
            res.json({ stagione, ripresa });
        } catch (err) {
            console.error('GET /api/f1/stagioni/:id:', err);
            res.status(500).json({ error: 'Impossibile leggere la stagione' });
        }
    });

    // Cancellare una stagione: solo chi l'ha CREATA.
    //
    // In multiplayer una stagione appartiene a tutti quelli che ci corrono —
    // sta nella lista di ognuno, e ognuno puo' riprenderla — ma cancellarla la
    // toglie a tutti insieme, ed e' l'unica operazione irreversibile qui
    // dentro. Chi ci corre la vede e la gioca; chi l'ha avviata la puo'
    // buttare.
    router.delete('/api/f1/stagioni/:id', autentica, async (req, res) => {
        try {
            const stagione = await seasonStore.leggi(req.params.id);
            // Stesso silenzio della lettura: a un estraneo non si dice
            // nemmeno che quell'id esiste.
            if (!stagione) return res.status(404).json({ error: 'Stagione non trovata' });
            const ciCorro = (stagione.piloti || []).some(p => p.uid === req.uid);
            if (!ciCorro) return res.status(404).json({ error: 'Stagione non trovata' });
            if (stagione.creataDa !== req.uid) {
                return res.status(403).json({ error: 'Puoi cancellare solo le stagioni che hai creato tu' });
            }
            await seasonStore.cancella(req.params.id);
            res.json({ cancellata: true });
        } catch (err) {
            console.error('DELETE /api/f1/stagioni/:id:', err);
            res.status(500).json({ error: 'Impossibile cancellare la stagione' });
        }
    });

    return router;
}

module.exports = { creaRouter, costruisciPiloti };
