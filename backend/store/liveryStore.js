// Salvataggio/lettura della livrea F1 per utente su MongoDB (collection
// "liveries", un documento per uid Firebase). A differenza di
// leaderboard.js NON tiene una cache RAM: le letture sono rare (solo
// quando un'auto con quella livrea entra in scena), non un hot path —
// query diretta a Mongo per richiesta.
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

let collectionPromise = null;

function getCollection() {
    if (!MONGODB_URI) return null;
    if (!collectionPromise) {
        collectionPromise = MongoClient.connect(MONGODB_URI)
            .then(client => client.db('RacingGameDB').collection('liveries'));
    }
    return collectionPromise;
}

async function saveLivery(uid, { liveryColors, liveryParams }) {
    const collectionP = getCollection();
    if (!collectionP) {
        throw new Error('MONGODB_URI mancante: impossibile salvare la livrea');
    }
    const collection = await collectionP;
    const doc = {
        liveryColors,
        liveryParams: liveryParams || null,
        updatedAt: new Date().toISOString()
    };
    await collection.updateOne({ _id: uid }, { $set: doc }, { upsert: true });
    return { _id: uid, ...doc };
}

async function getLivery(uid) {
    const collectionP = getCollection();
    if (!collectionP) return null;
    const collection = await collectionP;
    return collection.findOne({ _id: uid });
}

module.exports = { saveLivery, getLivery };
