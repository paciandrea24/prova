// backend/store/seasonStore.js
//
// Le stagioni salvate, su MongoDB (collection "seasons", un documento per
// stagione). Stessa forma di liveryStore.js: query dirette, nessuna cache in
// RAM — si leggono quando si apre il pannello stagioni, non venti volte al
// secondo.
//
// ⚠️ RIPIEGO IN MEMORIA. A differenza di liveryStore, qui senza MONGODB_URI
// NON si solleva un errore: si tiene tutto in una Map. Il motivo è concreto —
// nel `.env` di sviluppo MONGODB_URI non c'è (ci sono solo Firebase e Gemini),
// e senza ripiego la modalità stagioni sarebbe intestabile in locale.
//
// Il ripiego è onesto solo se si sa che c'è: le stagioni salvate così **muoiono
// quando si riavvia `node server.js`**. In produzione, dove MONGODB_URI c'è,
// non viene mai usato. L'avviso in console esce una volta sola all'avvio, non
// ad ogni salvataggio, se no diventa rumore che si smette di leggere.
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;

let collectionPromise = null;
const inMemoria = new Map();
let avvisato = false;

function getCollection() {
    if (!MONGODB_URI) {
        if (!avvisato) {
            avvisato = true;
            console.warn('⚠️ [stagioni] MONGODB_URI mancante: le stagioni restano in memoria '
                + 'e si perdono al riavvio del server. In produzione non succede.');
        }
        return null;
    }
    if (!collectionPromise) {
        collectionPromise = MongoClient.connect(MONGODB_URI)
            .then(client => client.db('RacingGameDB').collection('seasons'));
    }
    return collectionPromise;
}

function nuovoId() {
    return crypto.randomUUID();
}

async function salva(stagione) {
    const doc = Object.assign({}, stagione);
    if (!doc._id) doc._id = nuovoId();
    const collectionP = getCollection();
    if (!collectionP) {
        // La copia è voluta: chi ha chiamato non deve poter modificare quello
        // che sta "sul disco" continuando a usare il suo oggetto.
        inMemoria.set(doc._id, JSON.parse(JSON.stringify(doc)));
        return doc;
    }
    const collection = await collectionP;
    const { _id, ...resto } = doc;
    await collection.updateOne({ _id }, { $set: resto }, { upsert: true });
    return doc;
}

async function leggi(id) {
    const collectionP = getCollection();
    if (!collectionP) {
        const d = inMemoria.get(id);
        return d ? JSON.parse(JSON.stringify(d)) : null;
    }
    const collection = await collectionP;
    return collection.findOne({ _id: id });
}

// Le stagioni in cui quell'uid CORRE — non solo quelle che ha creato: in
// multiplayer la stagione la crea uno solo, ma sta nella lista di tutti quelli
// che ci corrono, altrimenti gli altri non potrebbero mai riprenderla.
// Dalla più recente alla più vecchia.
async function elencoPerUid(uid) {
    if (!uid) return [];
    const collectionP = getCollection();
    if (!collectionP) {
        return Array.from(inMemoria.values())
            .filter(s => (s.piloti || []).some(p => p.uid === uid))
            .sort((a, b) => String(b.aggiornataIl).localeCompare(String(a.aggiornataIl)))
            .map(s => JSON.parse(JSON.stringify(s)));
    }
    const collection = await collectionP;
    return collection.find({ 'piloti.uid': uid }).sort({ aggiornataIl: -1 }).toArray();
}

async function cancella(id) {
    const collectionP = getCollection();
    if (!collectionP) return inMemoria.delete(id);
    const collection = await collectionP;
    const esito = await collection.deleteOne({ _id: id });
    return esito.deletedCount > 0;
}

// Solo per i test: svuota il ripiego in memoria.
function _svuota() {
    inMemoria.clear();
}

module.exports = { salva, leggi, elencoPerUid, cancella, nuovoId, _svuota };
