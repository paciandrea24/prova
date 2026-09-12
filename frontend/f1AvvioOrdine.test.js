// frontend/f1AvvioOrdine.test.js
//
// ⚠️ `node --test backend/` NON esegue questo file: serve `node --test frontend/`.
//
// UNA FUNZIONE CHIAMATA ALL'AVVIO NON PUO' LEGGERE UNA VARIABILE DICHIARATA
// SOTTO DI LEI.
//
// Perché questo test esiste: ho aggiunto `preparaVisiera()` in cima a f1.js,
// dove il gioco si inizializza, e la funzione era definita millecinquecento
// righe più sotto insieme alle sue `let`. Una `function` è hoisted, quindi la
// chiamata sembrava legittima — ma `let` e `const` no: stanno in "temporal dead
// zone" fino alla loro riga, e leggerle prima è un ReferenceError. Il gioco si
// piantava sul caricamento con «Cannot access 'visieraCanvas' before
// initialization», e l'ha visto l'utente: `node --check` controlla la sintassi,
// e quello è un errore di ESECUZIONE.
//
// Il controllo è volutamente grezzo — niente parser, solo righe e indentazione —
// perché deve girare in un secondo su un file da settemila righe. Prende le
// chiamate che il gioco esegue SUBITO (quelle al primo livello dell'IIFE) e
// guarda se il corpo della funzione tocca variabili che a quel punto non
// esistono ancora.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SORGENTE = path.join(__dirname, 'f1.js');
const righe = fs.readFileSync(SORGENTE, 'utf8').split(/\r?\n/);

// Le variabili `let`/`const` dichiarate al primo livello dell'IIFE, con la riga
// in cui nascono. Solo quel livello: dentro una funzione la TDZ è un altro
// discorso, e quelle non sono visibili da fuori.
function variabiliDiPrimoLivello() {
    const mappa = new Map();
    righe.forEach((riga, i) => {
        const m = riga.match(/^ {4}(?:let|const)\s+([A-Za-z_$][\w$]*)/);
        if (!m) return;
        // Più nomi sulla stessa riga: `let a = null, b = null;`
        const dichiarazione = riga.slice(riga.indexOf(m[1]));
        for (const nome of dichiarazione.split(/[=;]/)[0].split(',').map(s => s.trim()).filter(Boolean)) {
            const pulito = nome.match(/^([A-Za-z_$][\w$]*)/);
            if (pulito && !mappa.has(pulito[1])) mappa.set(pulito[1], i + 1);
        }
        if (!mappa.has(m[1])) mappa.set(m[1], i + 1);
    });
    return mappa;
}

// Le funzioni dichiarate al primo livello: nome -> [rigaInizio, rigaFine].
function funzioniDiPrimoLivello() {
    const mappa = new Map();
    righe.forEach((riga, i) => {
        const m = riga.match(/^ {4}(?:async )?function\s+([A-Za-z_$][\w$]*)\s*\(/);
        if (!m) return;
        // La funzione finisce alla prima riga `    }` allo stesso livello.
        let fine = righe.length;
        for (let j = i + 1; j < righe.length; j++) {
            if (/^ {4}\}/.test(righe[j])) { fine = j; break; }
        }
        mappa.set(m[1], [i + 1, fine + 1]);
    });
    return mappa;
}

// Le chiamate eseguite SUBITO: `    nomeFunzione(...)` al primo livello, che
// non siano una dichiarazione né dentro un commento.
function chiamateImmediate(funzioni) {
    const fuori = [];
    righe.forEach((riga, i) => {
        const m = riga.match(/^ {4}([A-Za-z_$][\w$]*)\s*\(/);
        if (!m) return;
        if (/^ {4}(?:async )?function\b/.test(riga)) return;
        if (/^ {4}(?:if|for|while|switch|catch|return|await|new)\b/.test(riga)) return;
        if (funzioni.has(m[1])) fuori.push({ nome: m[1], riga: i + 1 });
    });
    return fuori;
}

test('avvio: nessuna funzione chiamata prima che esistano le sue variabili', () => {
    const variabili = variabiliDiPrimoLivello();
    const funzioni = funzioniDiPrimoLivello();
    const chiamate = chiamateImmediate(funzioni);
    assert.ok(chiamate.length > 0, 'nessuna chiamata immediata trovata: il test non sta misurando niente');

    const guai = [];
    for (const { nome, riga } of chiamate) {
        const [inizio, fine] = funzioni.get(nome);
        let corpo = righe.slice(inizio, fine - 1).join(String.fromCharCode(10));
        // ⚠️ In una funzione `async`, tutto quel che sta dopo il primo `await`
        // gira quando l'inizializzazione del file e' finita da un pezzo: le
        // variabili di sotto a quel punto ESISTONO. Senza questo taglio il test
        // segnalava `caricaVolumeDallAccount`, che legge una variabile
        // dichiarata cinquemila righe sotto — ma dopo tre await, quindi sta
        // benissimo. Un test che grida al lupo su codice sano si impara a
        // ignorare, e allora tanto valeva non scriverlo.
        const primoAwait = corpo.indexOf(String.fromCharCode(97,119,97,105,116,32));
        if (primoAwait >= 0) corpo = corpo.slice(0, primoAwait);
        // Gli identificatori toccati dal corpo, senza stringhe e commenti:
        // altrimenti una parola dentro un messaggio conta come variabile.
        const pulito = corpo
            .replace(/\/\/[^\n]*/g, ' ')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
            .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
            .replace(/`(?:[^`\\]|\\.)*`/g, ' ');
        for (const parola of new Set(pulito.match(/[A-Za-z_$][\w$]*/g) || [])) {
            const nasce = variabili.get(parola);
            if (nasce === undefined) continue;
            if (nasce > riga) {
                guai.push(`${nome}() è chiamata alla riga ${riga} ma legge \`${parola}\`, dichiarata alla ${nasce}`);
            }
        }
    }
    assert.deepEqual(guai, [],
        'una `function` è hoisted, le sue `let`/`const` no: alla chiamata sono in temporal dead zone e il gioco muore sul caricamento.\n  '
        + guai.join('\n  '));
});
