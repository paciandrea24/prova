// backend/auth/verifyFirebaseToken.js
//
// Verifica il token ID Firebase mandato dal client (header
// "Authorization: Bearer <idToken>") ed estrae l'uid, per proteggere le
// rotte che scrivono dati legati a un utente specifico (es. salvataggio
// livrea F1). Non salva/legge nulla: l'identità è tutto ciò che fa.
const admin = require('firebase-admin');

let initialized = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(
                JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
            )
        });
        initialized = true;
    } catch (error) {
        console.error('❌ Errore inizializzazione Firebase Admin:', error.message);
    }
} else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_JSON mancante! Le rotte protette da verifyFirebaseToken risponderanno sempre 503.');
}

async function verifyFirebaseToken(req, res, next) {
    if (!initialized) {
        return res.status(503).json({ error: 'Servizio di autenticazione non configurato' });
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
        return res.status(401).json({ error: 'Token mancante' });
    }

    try {
        const decoded = await admin.auth().verifyIdToken(match[1]);
        req.uid = decoded.uid;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token non valido' });
    }
}

module.exports = { verifyFirebaseToken };
