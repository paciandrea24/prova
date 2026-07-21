# F1 — aumento velocità realistico + ribilanciamento freni e mescole

## Problema

Le auto in gara viaggiano a 220 km/h base (231 con Soft) ma non danno la sensazione
di andare forte. L'utente vuole velocità in stile F1 vera (top speed ~320-360 km/h),
con i freni potenziati di conseguenza per non creare uno squilibrio (auto troppo
veloci per gli spazi di frenata attuali), e le 3 mescole riadattate correttamente
alla nuova base.

## Fattore di scala

Tutti i numeri sotto derivano da un unico fattore **R = 1.55** (+55%, nel range
"realistico F1" scelto dall'utente tra +50% e +60%). Tenerlo come costante unica
concettuale, anche se nel codice si traduce in singole costanti separate.

## 1. Velocità massima e accelerazione

File: `backend/sockets/games/f1GameSocket.js`

- `MAX_SPEED`: `4.0` → `6.2`
  - km/h base (Medium, `speedMult 1.00`): 220 → **341**
  - Soft (`1.05`): 231 → **358**
  - Hard (`0.95`): 209 → **324**
  - (display: invariato, resta `speed * 55` in `frontend/f1.js:823`, la scala
    automaticamente ai nuovi valori)
- `ACCEL`: `0.12` → `0.186` (scalato ×R)
  - Tempo per raggiungere il nuovo massimo resta ~1.7s (33.3 tick), come oggi —
    scelta dell'utente: auto più scattanti in valore assoluto, stesso ritmo
    percepito in accelerazione.

## 2. Frenata

La frenata è un decremento lineare costante per tick (non un modello a curva),
quindi lo spazio d'arresto scala con **v² / decelerazione**. Per mantenere lo
spazio di frenata vicino a quello attuale (~47.6 unità da top speed a zero),
la decelerazione frenante deve crescere di **R² ≈ 2.4x**, non solo ×R.

- Frenata oggi: `ACCEL * 1.4` = `0.168`/tick
- Frenata nuova: deve valere **`0.4036`/tick** → rispetto al nuovo `ACCEL`
  (0.186), il moltiplicatore relativo sale da **1.4× a ~2.17×**
- Riga da modificare: `p.speed = Math.max(p.speed - ACCEL * 1.4, -maxSpeed / 2);`
  → cambiare `1.4` in una nuova costante (es. `BRAKE_MULT = 2.17`)
- Il tetto di retromarcia (`-maxSpeed / 2`) non richiede modifiche: si scala da
  solo con `maxSpeed`.
- Smorzamento laterale in frenata (`p.vx *= 0.94; p.vz *= 0.94;`) invariato:
  è un fattore moltiplicativo per tick, scale-invariant.

## 3. Effetti collaterali tecnici (necessari, non richiesti esplicitamente)

- `FRICTION` (rallentamento a gas rilasciato, senza frenare): `0.050` →
  **`0.120`** (×R², stesso ragionamento dei freni — altrimenti il coast-down
  sembra non rallentare quasi per niente rispetto a oggi)
- `PIT_AUTO_SPEED`: `1.0` → **`1.55`** (×R, per restare al 25% della nuova
  `MAX_SPEED` — il commento nel codice lo documenta esplicitamente come "25%
  di MAX_SPEED")
- `COLLISION_SUBSTEPS`: `8` → **`13`**. Con `MAX_SPEED` più alta, la chiusura
  massima tra due auto per tick sale da 8 a 12.4 unità; con soli 8 sottostep il
  margine di sicurezza contro l'attraversamento (che il commento originale
  fissava a ~2.6x sotto la zona di contatto minima) si riduce troppo. 13
  sottostep ripristinano lo stesso margine.

## 4. Mescole e usura

File: `backend/sockets/games/f1GameSocket.js`, oggetto `TYRE_COMPOUNDS`.

- **Nessuna modifica ai moltiplicatori** (`speedMult`/`gripMult`): Soft
  `1.05/1.00`, Medium `1.00/0.95`, Hard `0.95/0.90` restano identici — si
  applicano sopra il nuovo `MAX_SPEED`/`GRIP`, quindi le differenze relative
  tra mescole restano invariate, solo in valori assoluti più alti.
- **Usura invariata**: `applyTyreWear` calcola l'usura per distanza percorsa
  normalizzata sulla lunghezza del giro (`wearPerUnitDist = 100 /
  (WEAR_LAPS_AT_MEDIUM * track.lapLength)`), non sul tempo. Una gomma che
  "dura 5 giri" continua a durarne 5 anche con auto più veloci — il modello è
  già auto-consistente rispetto alla velocità, nessun intervento necessario.
- `WEAR_SPEED_PENALTY`/`WEAR_GRIP_PENALTY` (percentuali): invariati, non
  dipendono da valori assoluti di velocità.

## Cosa NON cambia (fuori scope)

- `GRIP` (0.78) e `TURN_SPEED` (0.048): non toccati, non richiesti
  dall'utente. Nota: a parità di `TURN_SPEED`, a velocità più alta il raggio
  di sterzata effettivo aumenta — comportamento realistico (più difficile
  girare stretto ad alta velocità), non un difetto da correggere.
- Nessun tracciato esistente (Monza, Monte Rosso, Interlagos) viene
  modificato: la scelta di mantenere lo spazio di frenata simile a oggi serve
  proprio a evitare di dover ritoccare le zone di frenata/ingresso box già
  testate.
- Nessun effetto audio/visivo aggiuntivo (FOV dinamico, motion blur, pitch
  del motore legato alla velocità): non presenti nel codice attuale, fuori
  scope per questa modifica (solo fisica).

## Verifica

Da fare in localhost con due tab, come da convenzione di progetto:
- Qualifica e gara su almeno un tracciato con rettilineo lungo (Monza) e uno
  più tecnico (Monte Rosso/Interlagos)
- Verificare che l'ingresso in corsia box non venga mancato per frenata
  insufficiente
- Provare le 3 mescole e controllare che i km/h mostrati a schermo
  corrispondano ai target sopra
- Verificare che due auto ravvicinate a piena velocità non si attraversino
  (collisioni)
