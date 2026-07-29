// frontend/shared/firebaseConfig.js
//
// Config Firebase per il sistema di login. PASSI MANUALI (una tantum,
// sulla console Firebase: https://console.firebase.google.com) prima
// che questo file funzioni:
//   1. Crea un progetto Firebase nuovo (o riusa uno esistente).
//   2. Authentication -> Sign-in method -> abilita "Email/Password" e
//      "Google".
//   3. Authentication -> Settings -> Authorized domains -> aggiungi il
//      dominio Render effettivo dell'app (es. "tuoapp.onrender.com"),
//      oltre a "localhost" che c'e' gia' di default.
//   4. Project settings -> General -> "Your apps" -> aggiungi una Web
//      app (se non esiste) -> copia i valori mostrati e incollali qui
//      sotto al posto dei placeholder REPLACE_ME.
//
// Questi valori NON sono un segreto: Firebase li protegge tramite gli
// Authorized domains sopra, non tramite segretezza della chiave — è
// normale e sicuro che stiano in un file JS pubblico lato client.

const FIREBASE_CONFIG = {
    apiKey: "REPLACE_ME",
    authDomain: "REPLACE_ME.firebaseapp.com",
    projectId: "REPLACE_ME",
    storageBucket: "REPLACE_ME.appspot.com",
    messagingSenderId: "REPLACE_ME",
    appId: "REPLACE_ME"
};

let firebaseAuth = null;
let firebaseConfigError = null;

try {
    if (FIREBASE_CONFIG.apiKey === "REPLACE_ME") {
        throw new Error(
            "Firebase non configurato: sostituisci i valori REPLACE_ME in " +
            "frontend/shared/firebaseConfig.js con quelli del tuo progetto Firebase."
        );
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
} catch (err) {
    firebaseConfigError = err;
    console.error('[firebaseConfig]', err.message);
}
