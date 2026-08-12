// backend/dev/segnalazioniStore.js
//
// Lettura e scrittura del file delle segnalazioni in gioco (tasto M).
// Separato dalle route perché la parte che può corrompere il file —
// validazione, progressivo, annullamento — dev'essere verificabile con
// `node --test` senza avviare un server.
const fs = require('fs');
const path = require('path');

const FILE_DEFAULT = path.join(__dirname, '..', 'tools', 'f1-segnalazioni.json');

// Tetto di sicurezza: l'autorepeat del tasto o uno script impazzito non
// devono far crescere il file all'infinito.
const MAX_RECORD = 500;

function leggi(file = FILE_DEFAULT) {
    try {
        const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(dati) ? dati : [];
    } catch (err) {
        return [];   // file assente o illeggibile: si riparte da zero
    }
}

function scrivi(file, records) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
}

function numeroFinito(v) { return typeof v === 'number' && Number.isFinite(v); }

// Restituisce null se il record va bene, altrimenti il motivo del rifiuto.
function validaRecord(rec) {
    if (!rec || typeof rec !== 'object') return 'record mancante';
    if (typeof rec.trackId !== 'string' || !rec.trackId || rec.trackId.length > 64) return 'trackId non valido';
    if (typeof rec.sessione !== 'string' || !rec.sessione || rec.sessione.length > 64) return 'sessione non valida';
    if (!rec.pos || !numeroFinito(rec.pos.x) || !numeroFinito(rec.pos.y) || !numeroFinito(rec.pos.z)) return 'pos non valida';
    if (!numeroFinito(rec.headingDeg)) return 'headingDeg non valido';
    return null;
}

function aggiungi(rec, file = FILE_DEFAULT) {
    const errore = validaRecord(rec);
    if (errore) return { ok: false, errore };
    const records = leggi(file);
    if (records.length >= MAX_RECORD) return { ok: false, errore: `raggiunte ${MAX_RECORD} segnalazioni` };
    const n = records.reduce((max, r) => Math.max(max, r.n || 0), 0) + 1;
    // `n` DOPO lo spread: se il client ne manda uno suo, non deve vincere.
    const { n: _ignorato, ...pulito } = rec;
    records.push({ n, ...pulito });
    scrivi(file, records);
    return { ok: true, n };
}

function annullaUltima(sessione, file = FILE_DEFAULT) {
    const records = leggi(file);
    for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].sessione === sessione) {
            const n = records[i].n;
            records.splice(i, 1);
            scrivi(file, records);
            return { ok: true, n };
        }
    }
    return { ok: false, errore: 'niente da annullare' };
}

module.exports = { leggi, aggiungi, annullaUltima, validaRecord, FILE_DEFAULT, MAX_RECORD };
