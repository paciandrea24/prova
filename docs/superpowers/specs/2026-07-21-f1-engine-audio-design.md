# F1 — audio motore posizionale legato alla velocità

## Problema

Il gioco F1 non ha suoni motore. L'utente ha fornito un clip
(`audio macchina.mp3`: accelerazione → cambio marcia → nuova accelerazione)
da adattare come suono motore per tutte le auto in gara, con volume/pitch
che seguono la velocità reale di ciascuna auto.

## Contesto tecnico esistente

- `frontend/f1.js` ha già una `THREE.PerspectiveCamera` che segue l'auto del
  giocatore (terza/prima persona, vedi funzione di update camera).
- Ogni auto (locale e remota) è un `THREE.Group` costruito in
  `loadCarModel(playerColor, onReady)` (righe 114-208): il modello GLB viene
  centrato, colorato, le ruote vengono trovate/create, poi
  `scene.add(group); onReady(group);`.
- Il server già trasmette `target.speed` per **ogni** auto in `serverState`
  (usato oggi solo per HUD velocità del giocatore locale e per la rotazione
  delle ruote di tutte le auto, righe 814-823 di `f1.js`) — nessuna modifica
  necessaria lato server per avere questo dato.
- `MAX_SPEED` lato server è **6.2** (dopo la modifica di velocità realistica
  di questa sessione, vedi
  `docs/superpowers/specs/2026-07-21-f1-velocita-frenata-mescole-design.md`).

## Design

### Asset

- Copiare il file fornito in `frontend/assets/audio/engine.mp3` (nuova
  cartella, stesso pattern di `frontend/assets/kenney/`).

### Audio 3D posizionale

- Un `THREE.AudioListener` viene creato una volta e aggiunto come figlio
  della `camera` esistente: eredita automaticamente la posizione/orientamento
  della telecamera che segue il giocatore.
- Il buffer del clip viene caricato una volta all'avvio (`THREE.AudioLoader`,
  await prima che venga chiamato il primo `loadCarModel`).
- Ogni auto (locale e di altri giocatori) riceve un proprio
  `THREE.PositionalAudio(listener)` come figlio del suo `group`, dentro
  `loadCarModel` stesso (un solo punto di codice serve sia per
  `myCarGroup` sia per `otherCars[color]`, che oggi chiamano entrambi questa
  funzione): eredita la posizione 3D dell'auto, quindi Three.js calcola da
  solo attenuazione di distanza e non serve alcun calcolo manuale.
- Il loop parte subito (`.play()`) alla creazione di ogni auto; se il
  contesto audio è ancora sospeso (politica autoplay del browser) la
  riproduzione resta silenziosamente in coda finché non arriva il primo
  gesto dell'utente sulla pagina (click o tasto), gestito con un listener
  one-time che chiama `listener.context.resume()`.

### Mappatura velocità → pitch/volume

Ad ogni frame di `animate()`, nello stesso ciclo che già itera
`Object.entries(serverState)` per aggiornare posizione/ruote di ogni auto:

```js
const frac = Math.min(1, Math.abs(target.speed || 0) / 6.2);
engineSound.setPlaybackRate(0.7 + frac * 0.9);   // 0.7x fermo → 1.6x a tutta velocità
engineSound.setVolume(0.15 + frac * 0.85);       // 0.15 fermo/idle → 1.0 a tutta velocità
```

- Il clip intero viene semplicemente loopato in continuazione: niente
  taglio in spezzoni. Se il risultato non convince all'ascolto, l'utente
  fornirà i timestamp esatti per tagliare accelerazione/cambio/accelerazione
  in file separati — non è nello scope di questa prima iterazione.
- `6.2` è hardcoded lato client e deve restare in sync a mano con
  `MAX_SPEED` in `backend/sockets/games/f1GameSocket.js` se in futuro viene
  ritoccato ancora (nessun endpoint oggi espone questa costante al client).
- Volume/pitch fluttuano in continuo (non on/off): evita click e sparizioni
  brusche quando l'auto rallenta.

### Distanza/attenuazione

- `setRefDistance(15)`, `setRolloffFactor(1.5)` come default di partenza
  (dimensioni auto ~2.6×4.7 unità, quindi 15 unità = qualche lunghezza auto
  prima che il volume inizi a calare) — **da tarare a orecchio** in
  localhost con più tab aperte, non c'è modo di validarlo senza ascoltare.

## Cosa NON cambia

- Nessuna modifica al backend (`f1GameSocket.js`): il campo `speed` esiste
  già nello stato trasmesso.
- Nessun taglio del file audio in questa iterazione.
- Nessun suono diverso per mescola/usura gomme: fuori scope, non richiesto.

## Verifica

Manuale in localhost con almeno due tab (per sentire l'audio posizionale di
un'altra auto che si avvicina/allontana):
- Cliccare/premere un tasto per sbloccare l'audio, poi accelerare: il pitch
  deve salire con la velocità, il volume aumentare.
- Rilasciare/frenare: pitch e volume devono scendere di conseguenza.
- Con due tab, verificare che il motore dell'altra auto si senta più forte
  quando è vicina e più debole quando è lontana.
- Verificare che non ci siano click/scatti udibili nel loop (punto di
  giunzione inizio/fine del file) — se fastidiosi, valutare in una
  iterazione successiva un fade-in/out o il taglio in spezzoni.
