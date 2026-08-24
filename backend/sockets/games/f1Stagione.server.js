// backend/sockets/games/f1Stagione.server.js
//
// Tutto quello che una PARTITA deve sapere del campionato: quale pista si corre
// adesso, chi sono i suoi piloti, e come un ordine d'arrivo diventa una riga di
// risultati.
//
// Sta fuori da f1GameSocket.js per due ragioni: quel file e' gia' enorme, e il
// campionato sta ATTORNO alla partita, non dentro — cosi' si prova senza
// montare un socket.
//
// Le REGOLE (punti, classifica, calendario) non sono qui: stanno in
// frontend/shared/f1Stagione.js, che gira uguale sul client. Qui c'e' solo il
// collegamento fra i due mondi.
const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
const seasonStore = require('../../store/seasonStore');

// Le impostazioni con cui far ripartire la pagina per la PROSSIMA gara.
// Partono da quelle correnti — la lobby ne ha altre che non ci riguardano, e
// buttarle sarebbe un modo silenzioso di cambiarle.
function impostazioniPerLaProssimaGara(stagione, settingsCorrenti) {
    if (!stagione || F1Stagione.finita(stagione)) return null;
    return Object.assign({}, settingsCorrenti || {}, {
        trackId: F1Stagione.garaCorrente(stagione),
        // Stringhe come le manda la lobby: chi legge queste impostazioni fa
        // parseInt e confronti con 'false', e due formati diversi per lo stesso
        // campo sono esattamente il tipo di scarto che e' gia' costato caro.
        gridSize: String((stagione.impostazioni && stagione.impostazioni.gridSize) || 6),
        botsEnabled: (stagione.impostazioni && stagione.impostazioni.botsEnabled) === false ? 'false' : 'true',
        formato: 'stagione',
        stagioneId: stagione._id,
        // La differenza fra "sono in campionato e scelgo" e "sono in campionato
        // e sto correndo": senza, la pagina che riparte riaprirebbe il
        // calendario invece della pista.
        stagioneInCorso: true,
        // I bot viaggiano QUI dentro e non si rileggono dal database al momento
        // del join: createBots e' sincrona e sta nel mezzo di joinF1Game, dove
        // aspettare Mongo vorrebbe dire far attendere ogni giocatore che entra.
        // Le impostazioni il server ce le ha gia' in mano.
        botStagione: (stagione.piloti || [])
            .filter(p => p.bot)
            .map(p => ({ colore: p.colore, nome: p.nome })),
    });
}

// Chi e' questo pilota, dentro la stagione.
//
// Gli umani per UID e i bot per COLORE, e non e' un dettaglio: l'uid e' l'unica
// cosa stabile di un umano (il colore lo puo' cambiare in lobby fra una gara e
// l'altra), mentre un bot un uid non ce l'ha e il suo colore glielo impone la
// stagione apposta (vedi createBots).
function idPilotaDi(stagione, giocatore) {
    const piloti = (stagione && stagione.piloti) || [];
    if (!giocatore.isBot && giocatore.uid) {
        const p = piloti.find(x => !x.bot && x.uid === giocatore.uid);
        return p ? p.id : null;
    }
    const p = piloti.find(x => x.bot && x.colore === giocatore.color);
    return p ? p.id : null;
}

// L'ordine d'arrivo, tradotto negli id della stagione. Chi non appartiene alla
// stagione viene SALTATO invece di far fallire tutto: un pilota in piu' in
// pista e' un problema, ma non e' un buon motivo per perdere il risultato di
// tutti gli altri.
function ordineDelPodio(stagione, podium) {
    return (podium || [])
        .map(p => idPilotaDi(stagione, p))
        .filter(Boolean);
}

// L'usura di ogni macchina alla bandiera, tradotta negli id della stagione.
// Stessa regola di ordineDelPodio: chi non appartiene alla stagione viene
// SALTATO invece di far fallire tutto.
//
// `damageParts` puo' mancare (giocatore costruito a mano, o entrato e uscito
// prima che la fisica girasse): vale macchina nuova, come ovunque.
function usuraDeiPiloti(stagione, players) {
    const usura = {};
    for (const giocatore of Object.values(players || {})) {
        const id = idPilotaDi(stagione, giocatore);
        if (!id) continue;
        usura[id] = Object.assign(F1Stagione.vetturaNuova(), giocatore.damageParts || {});
    }
    return usura;
}

// L'UNICO punto in cui una stagione viene scritta. Subito dopo la bandiera a
// scacchi, mai a meta' weekend: e' cosi' che "chi chiude il browser perde il
// weekend, non la stagione" diventa vero senza doverlo programmare — non
// esiste nessun altro momento in cui si sarebbe potuto salvare.
async function registraGara(stagione, podium, players) {
    const aggiornata = F1Stagione.registraRisultato(stagione, {
        ordine: ordineDelPodio(stagione, podium),
        usura: usuraDeiPiloti(stagione, players),
    });
    await seasonStore.salva(aggiornata);
    return aggiornata;
}

module.exports = { impostazioniPerLaProssimaGara, idPilotaDi, ordineDelPodio, usuraDeiPiloti, registraGara };
