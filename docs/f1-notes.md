# F1 — note tecniche

## Racing line precalcolata per i bot (`backend/tools/f1RaceLineOptimizer.js`)

I bot IA seguono, quando disponibile, una **linea di guida precalcolata offline**
per pista invece di calcolare l'apice delle curve in tempo reale — più veloce
e senza rischio di uscire di pista sulle chicane strette (vedi
`docs/superpowers/specs/2026-07-24-f1-bot-cornering-redesign-design.md` per il
perché il calcolo a runtime è stato abbandonato).

### Come generare la linea per una pista nuova

Dopo aver creato/salvato la pista con l'editor (`frontend/tracks/<id>.json`
deve già esistere), dalla cartella `backend/`:

```
node tools/f1RaceLineOptimizer.js <trackId>
```

Esempio per più piste in una volta:

```
node tools/f1RaceLineOptimizer.js monza prova --hops=30
```

- `--hops=N` (default 30): quante perturbazioni casuali extra tentare dopo
  l'ottimizzazione principale, per uscire da eventuali ottimi locali. Più alto
  = risultato potenzialmente migliore ma più lento. 30 è un buon compromesso;
  usare 40-50 solo se si vuole spremere l'ultimo mezzo secondo.
- Tempo di calcolo: qualche minuto per pista (scala con la lunghezza del
  giro — una pista 2x più lunga di Monza impiega circa 2x).
- Scrive `backend/tools/<trackId>-raceline.json` — **questo è l'unico file
  che serve**: `trackLoader.js` lo carica automaticamente all'avvio del
  server se esiste, nessun'altra configurazione necessaria.
- Se il file non esiste per una pista, il bot usa il calcolo geometrico a
  runtime di sempre (nessuna differenza rispetto a prima) — è un fallback
  sicuro, non un errore.

### Quando rigenerarla

- **Ogni volta che la GEOMETRIA della pista cambia** (punti di controllo
  spostati, pista ridisegnata) — la linea salvata è tarata sulla forma
  esatta di quel momento; su una pista modificata resta comunque "legale"
  (non manda mai fuori pista, l'ottimizzatore si autolimita) ma non più
  ottimale.
- Non serve rigenerarla se cambi solo `roadHalfWidth`/nome/altri metadati
  non geometrici — ma in caso di dubbio, ri-lanciare il comando non fa mai
  danno (sovrascrive il file esistente).

### Bisogna riavviare il server?

Sì — `trackLoader.js` mette in cache la pista al primo caricamento nel
processo; un server già in esecuzione non vede un file `-raceline.json`
nuovo o aggiornato finché non viene riavviato.

### Verifica rapida senza aprire il browser

```
node tools/f1LapSimulator.js <trackId>
```

Usa la fisica esatta del gioco (nessuna duplicazione): se la racing line
è attiva, il tempo dovrebbe essere sensibilmente più basso del calcolo a
runtime "vecchio stile" — confrontabile lanciando lo stesso comando dopo
aver rinominato temporaneamente `<trackId>-raceline.json`.

### Nota sul tempo mostrato in gioco vs il simulatore

Il tempo mostrato **in partita reale** (qualifica/gara) è quasi sempre più
alto di quello del simulatore, per bot E umano allo stesso modo — misurato:
il timer di Windows/Node non riesce a far scattare il tick di gioco (50ms)
con precisione, quindi il gioco gira leggermente più lento in tempo reale
(non è un bug della racing line, né qualcosa che vale la pena rincorrere:
essendo uniforme su tutti i piloti non cambia l'equilibrio della gara). Usare
`f1LapSimulator.js`/`f1RaceLineOptimizer.js` come riferimento per confrontare
"prima vs dopo", non aspettarsi che il numero mostrato in gioco combaci
esattamente.
