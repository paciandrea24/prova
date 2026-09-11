// backend/store/preferenzeStore.js
//
// Le preferenze di un giocatore con account, su MongoDB (collection
// "preferenze", un documento per uid Firebase). Stessa forma di liveryStore:
// nessuna cache in RAM, le letture sono una all'avvio della partita.
//
// ⚠️ NON E' UN DEPOSITO CHIAVE-VALORE. Il client manda quello che vuole, e
// senza un elenco di campi ammessi questa rotta diventerebbe spazio disco
// gratis per chiunque abbia un account (lo stesso motivo per cui la livrea ha
// un tetto di dimensione). Ogni preferenza nuova si aggiunge QUI, con la sua
// regola di validita': quello che non e' in elenco viene buttato via in
// silenzio, non salvato «per ogni evenienza».
//
// Perche' generico e non una rotta per il volume: il tutorial (blocco J) deve
// comparire «solo la prima volta che un utente loggato gioca», e cioe' e' la
// prossima preferenza che arriva qui. Due rotte gemelle per due campi sarebbe
// il momento sbagliato per accorgersene.
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

let collectionPromise = null;

function getCollection() {
    if (!MONGODB_URI) return null;
    if (!collectionPromise) {
        collectionPromise = MongoClient.connect(MONGODB_URI)
            .then(client => client.db('RacingGameDB').collection('preferenze'));
    }
    return collectionPromise;
}

// nome -> funzione che restituisce il valore da salvare, oppure undefined se
// quel che e' arrivato non va bene.
const AMMESSE = {
    // Il volume del gioco, 0..1. Arrotondato al decimo come i passi dei tasti:
    // un client che mandasse 0.37 non deve creare uno stato che l'interfaccia
    // non sa piu' rappresentare.
    volume: (v) => {
        // ⚠️ `typeof` e non `Number(v)`: Number(null), Number([]) e Number('')
        // valgono tutti ZERO, e sarebbero passati per un volume legittimo.
        // Chi manda spazzatura si sarebbe trovato il gioco muto, e nessuno
        // avrebbe saputo perche'.
        if (typeof v !== 'number' || !isFinite(v)) return undefined;
        return Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    },
    // Il riquadro che spiega la procedura di partenza: false una volta che il
    // giocatore l'ha chiuso. Si salva il «non mostrarmelo piu'», non il
    // contrario: un account nuovo non ha il campo e quindi lo vede, che e'
    // esattamente quel che serve.
    aiutoPartenza: (v) => (typeof v === 'boolean' ? v : undefined),
    // La legenda degli strumenti da amministratore, a schermo in gara. E' un
    // INTERRUTTORE e non un «mai piu'»: si spegne per giocare e si riaccende
    // per provare. La vede comunque solo chi e' in F1_ADMIN_UIDS — questa
    // preferenza dice se mostrarla, non chi puo' vederla.
    legendaAdmin: (v) => (typeof v === 'boolean' ? v : undefined),
};

// Tiene solo i campi ammessi e validi. Esportata perche' e' la regola, e una
// regola si prova da sola senza un database dietro.
function filtraPreferenze(grezze) {
    const out = {};
    if (!grezze || typeof grezze !== 'object') return out;
    for (const [nome, valida] of Object.entries(AMMESSE)) {
        if (!Object.prototype.hasOwnProperty.call(grezze, nome)) continue;
        const valore = valida(grezze[nome]);
        if (valore !== undefined) out[nome] = valore;
    }
    return out;
}

// ⚠️ Unisce, non sostituisce: salvare il volume non deve cancellare il fatto
// che il tutorial e' gia' stato visto. Chi chiama manda solo cio' che cambia.
async function salvaPreferenze(uid, grezze) {
    const collectionP = getCollection();
    if (!collectionP) {
        throw new Error('MONGODB_URI mancante: impossibile salvare le preferenze');
    }
    const campi = filtraPreferenze(grezze);
    if (!Object.keys(campi).length) return { _id: uid, ...campi };
    const collection = await collectionP;
    const doc = { ...campi, updatedAt: new Date().toISOString() };
    await collection.updateOne({ _id: uid }, { $set: doc }, { upsert: true });
    return { _id: uid, ...doc };
}

async function leggiPreferenze(uid) {
    const collectionP = getCollection();
    if (!collectionP) return null;
    const collection = await collectionP;
    return collection.findOne({ _id: uid });
}

module.exports = { salvaPreferenze, leggiPreferenze, filtraPreferenze };
