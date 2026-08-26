// frontend/shared/ordineScript.test.js
//
// OGNI PAGINA CARICA I MODULI NELL'ORDINE GIUSTO.
//
// ⚠️ PERCHE' ESISTE. Il 2026-08-26 `f1.html` ha cominciato a caricare
// `trackAcrobatico.js` senza `trackSegmenti.js`, da cui dipende: nel browser
// `root.TrackSegmenti` era undefined, la costruzione del circuito moriva dentro
// `inserisciNeiCampioni` e il gioco restava fermo su «Dati del circuito…».
// Nessun test lo diceva — i moduli in Node si richiedono da soli — e a vederlo
// e' stato l'utente, che aspettava davanti a una barra di caricamento.
//
// La sonda headless con cui avevo guardato il tubo NON lo aveva preso: caricava
// trackSegmenti.js perche' l'avevo scritta io, mentre la pagina vera no. Una
// sonda che non e' la pagina vera prova la pagina che vorresti, non quella che
// hai.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const SHARED = __dirname;

// Le dipendenze che un modulo UMD dichiara nel suo ramo BROWSER: la riga
// `root.Nome = factory(root.Dep1, root.Dep2)`.
function dipendenzeBrowser(file) {
    const src = fs.readFileSync(path.join(SHARED, file), 'utf8');
    const m = src.match(/root\.\w+\s*=\s*factory\(([^)]*)\)/);
    if (!m) return [];
    return (m[1].match(/root\.(\w+)/g) || []).map(s => s.replace('root.', ''));
}

// Da `TrackSegmenti` al file che lo definisce.
//
// ⚠️ Niente RegExp costruita da stringa: la prima stesura usava
// `new RegExp(\`root\\.${nome}\\s*=\`)` e i backslash si perdevano lungo la
// strada — la regex diventava `root.TrackSegmentis*=`, non trovava piu' niente
// e la funzione rispondeva sempre `null`. Il test passava anche togliendo
// davvero trackSegmenti.js da f1.html: verde, e cieco. Un confronto letterale
// non ha modi di sbagliarsi.
function fileCheDefinisce(nome) {
    for (const f of fs.readdirSync(SHARED)) {
        if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
        const src = fs.readFileSync(path.join(SHARED, f), 'utf8');
        if (src.includes('root.' + nome + ' =') || src.includes('root.' + nome + '=')) return f;
    }
    return null;
}

const PAGINE = fs.readdirSync(FRONTEND).filter(f => f.endsWith('.html') && !f.startsWith('__'));

for (const pagina of PAGINE) {
    test(`${pagina}: ogni modulo condiviso arriva dopo quelli che gli servono`, () => {
        const html = fs.readFileSync(path.join(FRONTEND, pagina), 'utf8');
        const caricati = (html.match(/src="shared\/([\w.-]+\.js)/g) || [])
            .map(s => s.replace('src="shared/', ''));
        for (let i = 0; i < caricati.length; i++) {
            for (const dip of dipendenzeBrowser(caricati[i])) {
                const serve = fileCheDefinisce(dip);
                if (!serve) continue;                       // dipendenza esterna (THREE, ecc.)
                const dove = caricati.indexOf(serve);
                assert.ok(dove !== -1,
                    `${pagina} carica ${caricati[i]}, che ha bisogno di ${serve} (${dip}): non c'e'`);
                assert.ok(dove < i,
                    `${pagina}: ${serve} arriva DOPO ${caricati[i]}, che lo usa`);
            }
        }
    });
}
