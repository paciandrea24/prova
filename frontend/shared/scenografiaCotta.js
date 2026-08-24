// frontend/shared/scenografiaCotta.js
//
// Il FORMATO di una scenografia cotta: come si comprime, come si rilegge, e
// quando NON si puo' usare. Rif.
// docs/superpowers/specs/2026-08-23-f1-mappe-immutabili-design.md.
//
// Sta in shared/ perché lo usano due mondi che devono essere d'accordo: il
// cuocitore in Node (backend/tools/f1-cuoci-scenografia.js) e il lettore nel
// browser (frontend/f1.js). Se il formato vivesse in due posti, prima o poi
// scriverebbero cose diverse — ed è esattamente il genere di scarto che qui
// non si vedrebbe finché una tribuna non spunta in mezzo alla pista.
//
// Modulo PURO: niente Three.js, niente fetch, niente filesystem.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScenografiaCotta = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const VERSIONE_FORMATO = 1;

    // Due decimali su coordinate in unità di gioco valgono il centimetro:
    // sotto la soglia del visibile, e sono ciò che porta prova da 1037 KB a
    // 264 (64 gzippati).
    const r = (n) => Math.round((Number(n) || 0) * 100) / 100;

    // FNV-1a a 32 bit, scritto ESATTAMENTE come trackScenery.hashString: un
    // hash diverso per la stessa cosa sarebbe una seconda verità.
    function hash(testo) {
        let h = 0x811c9dc5;
        for (let i = 0; i < testo.length; i++) {
            h ^= testo.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return ('0000000' + (h >>> 0).toString(16)).slice(-8);
    }

    // L'impronta dei campi del tracciato che SPOSTANO gli oggetti. Il nome e
    // il notturno non entrano: se entrassero, rinominare una pista o passarla
    // alla notte butterebbe via una cottura ancora perfettamente buona.
    function improntaDi(trackData) {
        const t = trackData || {};
        const pit = t.pit || {};
        return hash(JSON.stringify([
            t.id,
            t.roadHalfWidth,
            t.targetKm,
            t.startFinish,
            t.controlPoints,
            pit.roadHalfWidth, pit.boxIndex, pit.entryTrigger, pit.controlPoints,
        ]));
    }

    function comprimi(layout, meta) {
        const assets = [];
        const categorie = [];
        const indice = (elenco, v) => {
            let i = elenco.indexOf(v);
            if (i < 0) { i = elenco.length; elenco.push(v); }
            return i;
        };
        const voci = (layout || []).map((v) => [
            indice(assets, v.asset), indice(categorie, v.category),
            r(v.x), r(v.y), r(v.z), r(v.rotY), r(v.scale),
        ]);
        return {
            versione: VERSIONE_FORMATO,
            pista: meta.pista,
            gridSize: meta.gridSize,
            impronta: meta.impronta,
            cottaIl: meta.cottaIl,
            assets, categorie, voci,
        };
    }

    function espandi(file) {
        return (file.voci || []).map((v) => ({
            asset: file.assets[v[0]], category: file.categorie[v[1]],
            x: v[2], y: v[3], z: v[4], rotY: v[5], scale: v[6],
        }));
    }

    // Restituisce il MOTIVO per cui non si può usare, o null se si può.
    // Una stringa e non un booleano perché chi la riceve la stampa: «cottura
    // ignorata» senza il perché è un messaggio che non aiuta nessuno.
    function motivoDiRifiuto(file, trackData, gridSize) {
        if (!file || typeof file !== 'object' || !Array.isArray(file.voci)) {
            return 'file assente o illeggibile';
        }
        if (file.versione !== VERSIONE_FORMATO) {
            return `versione del formato ${file.versione}, questo codice legge la ${VERSIONE_FORMATO}`;
        }
        if (file.pista !== (trackData && trackData.id)) {
            return `cotta per la pista "${file.pista}"`;
        }
        if (file.gridSize !== gridSize) {
            return `cotta per gridSize ${file.gridSize}, questa gara ne ha ${gridSize}`;
        }
        if (file.impronta !== improntaDi(trackData)) {
            return "il tracciato e' cambiato dopo la cottura";
        }
        return null;
    }

    return { VERSIONE_FORMATO, improntaDi, comprimi, espandi, motivoDiRifiuto };
});
