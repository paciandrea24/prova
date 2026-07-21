# F1 — campioni motore reali (sostituzione pacchetto CC0)

## Problema

Il suono motore implementato in `frontend/f1.js` (non committato) usa 6
campioni WAV presi da un pacchetto CC0 di OpenGameArt
(`frontend/assets/audio/engine_rpm/loop_0.wav` … `loop_5.wav`). Testato
dall'utente in localhost: **bocciato** — "sembra un motore di una macchina
elettrica, non di una F1. e ogni tanto ci sono dei suoni che danno
fastidio".

Questo spec sostituisce il *contenuto* audio con campioni presi da una
registrazione reale di un motore F1 (Alpine 2023), lasciando invariata
l'architettura di riproduzione già esistente e funzionante.

## Contesto tecnico esistente

`frontend/f1.js` ha già, per ogni auto (locale e remota):

- `THREE.AudioListener` sulla camera + `THREE.PositionalAudio` per auto
  (posizione 3D, nessun buffer diretto: serve solo da nodo di destinazione).
- `createEngineRpmSynth(destNode)`: carica N buffer WAV in loop continuo,
  ciascuno con un proprio `GainNode`, e li crossfada ogni frame con una
  finestra triangolare in base a `bandPos = frac * (N-1)`, dove
  `frac = velocità_corrente / ENGINE_REF_MAX_SPEED` (0..1). Oggi N=6.
- 8 marce fisse (`ENGINE_N_GEARS = 8`) calcolate dalla stessa `frac`, con
  isteresi (`ENGINE_GEAR_HYSTERESIS`) per evitare sfarfallio ai confini —
  usate solo per decidere quando far scattare il "clunk" di cambio marcia
  (`playGearClunk`, sintetizzato con oscillatore + rumore filtrato, non un
  file audio). Il calcolo della marcia è **indipendente** dal crossfade dei
  campioni: restano due sistemi paralleli guidati dalla stessa `frac`.
- Volume acceso/spento in base a "il motore sta accelerando o
  decelerando" (variazione di velocità rispetto all'ultimo frame, con
  finestra di tenuta `ENGINE_ACTIVE_HOLD_MS`) — nessun contenuto sonoro
  diverso tra le due fasi, solo on/off.

Questa architettura resta **invariata**: cambia solo il numero e il
contenuto dei campioni.

## Design

### Asset

- Sorgente: `alpine_2023_f1_engine.mp3` (24s, motore F1 Alpine 2023),
  fornito dall'utente sul proprio Desktop. Struttura nota: primi 12s = giri
  che salgono passando per i cambi marcia; restanti 12s = decelerazione poi
  ri-accelerazione.
- L'utente taglia manualmente (con un editor audio a sua scelta) 8 pezzi da
  0.5s ciascuno dai primi 12s, agli intervalli:

  | file | intervallo |
  |---|---|
  | `accel_0.mp3` | 0.0s – 0.5s |
  | `accel_1.mp3` | 1.5s – 2.0s |
  | `accel_2.mp3` | 3.0s – 3.5s |
  | `accel_3.mp3` | 4.5s – 5.0s |
  | `accel_4.mp3` | 6.0s – 6.5s |
  | `accel_5.mp3` | 7.5s – 8.0s |
  | `accel_6.mp3` | 9.0s – 9.5s |
  | `accel_7.mp3` | 10.5s – 11.0s |

  Un campione per marcia (`ENGINE_N_GEARS = 8`), spaziati regolarmente ogni
  1.5s lungo la salita di giri. Esportati in `.mp3` (non `.wav`): `THREE.AudioLoader`
  usa `decodeAudioData` del Web Audio API, che supporta mp3 senza differenze
  di codice.
- I file vanno messi in `frontend/assets/audio/engine_rpm/`, sovrascrivendo
  i 6 `loop_i.wav` CC0 attuali (che vengono eliminati).

### Modifiche a `frontend/f1.js`

- L'array di indici caricati da `Promise.all` passa da `[0,1,2,3,4,5]` a
  `[0,1,2,3,4,5,6,7]`.
- Il path caricato passa da `/assets/audio/engine_rpm/loop_${i}.wav` a
  `/assets/audio/engine_rpm/accel_${i}.mp3`.
- Il commento che oggi attribuisce i campioni al pacchetto CC0 di
  OpenGameArt va aggiornato per riflettere la nuova origine (registrazione
  reale Alpine 2023, tagliata dall'utente).
- Nessun'altra modifica: `createEngineRpmSynth`, il calcolo di `frac`, il
  crossfade, le marce, il clunk e la logica di volume restano identici — il
  cambio da 6 a 8 buffer è assorbito automaticamente da `synth.gains.length`
  (già usato come base del calcolo di `bandPos`, nessun valore hardcoded a
  6 nel codice).

### Pulizia

- Eliminare `frontend/assets/audio/engine_loop.mp3` ed
  `frontend/assets/audio/engine_shift.mp3`: residuo di un tentativo
  precedente (taglio manuale dal file "audio macchina.mp3" originale),
  abbandonato e mai referenziato nel codice attuale.

## Cosa NON cambia / fuori scope

- **Nessun layer di decelerazione/rilascio motore** in questa iterazione:
  i restanti 12s del file sorgente (decelerazione poi ri-accelerazione) non
  vengono usati. Il volume continua a spegnersi/accendersi in base alla
  variazione di velocità come già oggi, senza contenuto sonoro dedicato.
  Deferito a un'iterazione futura (probabile naming `decel_*.wav`, stessa
  cartella).
- Nessuna modifica al clunk di cambio marcia (resta sintetizzato).
- Nessuna modifica al backend: `target.speed` è già trasmesso per ogni
  auto, nessun cambiamento necessario.
- Nessun pitch-shift dei campioni: ogni campione suona alla sua velocità
  naturale di registrazione, come già oggi.

## Verifica

Manuale in localhost, stessa procedura già in uso per questa feature:

- Cliccare/premere un tasto per sbloccare l'audio, poi accelerare da fermo
  a tutta velocità: il timbro deve essere riconoscibile come motore F1
  (non elettrico) lungo tutta la salita, senza suoni fastidiosi o click
  udibili nei punti di giunzione tra campioni.
- Rilasciare/frenare: il volume deve scendere come già oggi (nessun nuovo
  comportamento atteso qui).
- Con due tab, verificare l'audio posizionale (più forte da vicino, più
  debole da lontano) come già oggi — invariato dall'architettura esistente.
