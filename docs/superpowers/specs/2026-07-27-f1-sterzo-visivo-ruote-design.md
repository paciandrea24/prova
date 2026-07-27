# F1 — sterzo visivo ruote anteriori

## Contesto

L'utente ha condiviso due file esterni al repo per esplorare nuove
possibilità sul modello auto F1:

- `livrea base.glb` — un possibile modello auto alternativo a quello
  attuale (`frontend/assets/custom/f1Car.glb`). L'utente preferisce già
  esteticamente il modello attuale; la valutazione del nuovo modello resta
  **fuori scope** per questo giro (vedi sotto).
- `editor livree.html` — un editor standalone in Three.js (non parte del
  repo) che costruisce un'auto F1 voxel proceduralmente e la anima in una
  "drive mode": le ruote anteriori ruotano sul proprio asse verticale in
  base allo sterzo (oltre al rotolamento), dando un effetto di sterzata
  visibile.

L'utente vuole portare un effetto analogo (ruote anteriori che sterzano
in curva) nel gioco vero, sul modello auto **attuale**, senza toccare il
sistema di asset esistente.

## Obiettivo

Le ruote anteriori del modello auto (proprio, avversari, bot) ruotano
visivamente in base a quanto si sta sterzando in quel momento. Effetto
puramente cosmetico: nessun impatto su fisica, hitbox o gameplay.

## Vincoli/verifiche dal codice esistente

- Il client riceve oggi per ogni auto, ad ogni tick di broadcast
  (`backend/sockets/games/f1GameSocket.js`, blocco `out[color]` ~riga
  1178): `x, z, angle, trackIndex, speed, ...` — **non** l'input di
  sterzo istantaneo.
- Il server calcola già l'input di sterzo clampato in
  `game.players[playerColor].inputs.steer` (-1..1,
  `f1GameSocket.js` ~riga 339-343) e lo usa in
  `backend/sockets/games/physics/SteeringModel.js::applySteering` per
  aggiornare `p.angle` (yaw dell'auto, non l'angolo ruota).
- Il modello auto attuale (`frontend/assets/custom/f1Car.glb`) ha le
  ruote nominate esplicitamente `wheelHub_FL/FR/RL/RR` (verificato in
  `backend/tools/f1CarVoxelize.py:44-47`), quindi la distinzione
  anteriore/posteriore è già derivabile dal nome.
- `frontend/shared/carLoader.js::loadCarModel` oggi raccoglie TUTTE le
  ruote (per nome `wheel`/`tyre`/`tire`, righe ~166-184) in un'unica
  lista `group.userData.wheels`, usata in `frontend/f1.js` (~riga
  1542-1546) per il solo rotolamento (`rotation.x`), identica per le 4
  ruote — nessuna distinzione anteriore/posteriore esiste oggi lato
  client.
- Fallback esistenti in `carLoader.js`: ruote per bounding-box (righe
  ~187-196) o ruote cilindriche sintetiche con posizione nota (righe
  ~203-222, anteriori a Z positivo). In entrambi i fallback la
  distinzione anteriore/posteriore resta derivabile dalla posizione Z.

## Modifiche

### 1. Server — `backend/sockets/games/f1GameSocket.js`

Nel blocco broadcast `out[color]` (~riga 1178), aggiungere:

```js
steerInput: p.inputs.steer,
```

Nessuna altra modifica: il valore è già calcolato e clampato altrove,
si tratta solo di includerlo nel payload già esistente. Non tocca la
fisica.

### 2. `frontend/shared/carLoader.js`

In `loadCarModel`, quando si raccolgono i nodi ruota (sezione
`namedWheels`/`wheelParentSet`), classificare ciascuna ruota come
anteriore o posteriore:

- **Ruote nominate**: il nome (già disponibile, usato per il match
  `wheel`/`tyre`/`tire`) viene controllato anche per `fl`/`fr`
  (anteriore) vs `rl`/`rr` (posteriore), case-insensitive.
- **Fallback bounding-box/sintetiche**: la posizione Z del nodo (già
  nota in entrambi i fallback) determina anteriore (Z>0) / posteriore
  (Z<0), stessa convenzione già usata nel codice esistente per le ruote
  sintetiche (vedi commento riga ~310 di `f1.js`: "z negativo = retro
  auto").

Risultato: `group.userData.frontWheels` (sottoinsieme di
`group.userData.wheels`, solo le ruote anteriori). Se nessuna ruota è
classificabile come anteriore (caso limite, non previsto con gli asset
attuali), l'array resta vuoto e l'effetto si disattiva da solo — nessun
errore, nessun fallback aggiuntivo da scrivere.

### 3. `frontend/f1.js` — loop di rendering

Vicino alla rotazione ruote esistente (~riga 1542-1546), oltre al
rotolamento già presente:

- Mantenere un angolo di sterzo smussato per auto,
  `carGroup.userData.steerAngle` (stato persistente come già
  `wheelRot`), aggiornato ogni frame con un lerp verso
  `target.steerInput * MAX_WHEEL_STEER_RAD`.
- Applicare `wheel.rotation.y = steerAngle` a tutte le ruote in
  `frontWheels` (le ruote posteriori restano invariate, solo
  rotolamento).
- Costanti nuove (vicino alle altre costanti di tuning del file):
  - `MAX_WHEEL_STEER_RAD` — angolo massimo di rotazione visiva ruota,
    punto di partenza **0.35 rad (~20°)**, stesso ordine di grandezza
    del clamp `±0.4` usato nell'editor di riferimento dell'utente. Da
    tarare a vista nel banco prova/localhost.
  - Costante di lerp per la transizione (valore di partenza da
    allineare alle altre costanti di smoothing già presenti nel file,
    es. lo stesso stile di `LERP` usato per posizione/pitch).

**Perché un lerp lato client e non l'input grezzo diretto**: l'input da
tastiera è binario (-1/0/1, scatta di colpo tra i due estremi); un lerp
dà una transizione morbida e realistica nella rotazione della ruota
invece di uno scatto secco. È puro effetto estetico — la fisica reale
dell'auto (che usa l'input grezzo `inputs.steer` in
`SteeringModel.js`) non cambia in alcun modo.

**Perché usare il valore trasmesso dal server anche per la propria
auto** (invece di usare l'input locale istantaneo, disponibile senza
attendere il round-trip): tenere un unico percorso di codice per
auto propria/avversari/bot evita casi speciali; la latenza aggiuntiva
(un tick di broadcast, tipicamente 50ms) è impercettibile per un
effetto puramente cosmetico come la rotazione ruota.

## Testing

1. **Banco prova bot** (`frontend/f1-testbench.html`, già presente nel
   repo): permette di vedere l'effetto su più bot in curva
   contemporaneamente, senza bisogno di due tab per il multiplayer.
2. **Verifica utente in localhost multiplayer**, come da convenzione di
   progetto, prima di qualunque commit.

## Fuori scope

- Il nuovo modello auto (`livrea base.glb`) — resta in standby, nessun
  collegamento al gioco in questo giro. Una valutazione futura (se
  l'utente la richiede) sarà un sotto-progetto separato con proprio
  spec/piano.
- Qualunque altro effetto visto nell'editor di riferimento (es. il
  leggero spostamento del muso in curva, righe 652-654 del file
  `editor livree.html`) — non richiesto esplicitamente, non incluso.
- Taratura fine di `MAX_WHEEL_STEER_RAD`/costante di lerp oltre una
  prima stima ragionevole — si affina a vista durante il testing.
