# La città abitata (blocco G, fase G2) — design

**Data:** 2026-08-27
**Blocco:** G, fase 2. La G1 è chiusa e validata dall'utente («è bellissimo,
complimenti. fps mi sembrano ok»).
**Spec madri:** `2026-08-26-f1-ambientazione-cittadina-design.md`,
`2026-08-27-f1-facciate-asset-design.md`.

## Cosa resta da fare, e cosa è caduto

La G1 ha dato alla città il suo muro: un nastro che chiude la vista, vestito di
facciate scolpite. Quello che manca è **la vita fra la barriera e i palazzi**.

⚠️ **Una voce della spec originale è caduta**: «i negozi dell'FPS davanti alla
facciata». Nasceva da quando la città era un nastro dipinto e serviva qualcosa
di solido nei punti che si guardano da vicino; oggi le facciate sono modelli
veri e i negozi ce li hanno già dentro (vetrine, tende, portoni, insegne).
Aggiungere davanti asset di un altro gioco, con un'altra palette, sarebbe
ridondante e stonato. **Non si fa.**

## Le quattro voci

### 1. Il marciapiede è vuoto (la più visibile)

Fra la barriera e la prima facciata ci sono **24 unità di asfalto liscio** su
tutto il giro. Lì va la vita urbana, modellata con lo stesso kit delle facciate
(`voxelKit`, stile voxel dettagliato): lampioni, semafori, fermate dell'autobus,
edicole, cassonetti, tavolini di bar, transenne, auto parcheggiate a bordo
strada.

Si posano con il meccanismo che esiste già — voci di layout della scenografia,
istanziate come tutto il resto — ma **a partire dal muro**, come le tribune, non
dal profilo della città: sono roba di bordo pista, e devono restare davanti alle
facciate come tutto ciò che sta di là dalla barriera.

### 2. Gli sponsor sulle barriere

Pannelli inventati da noi (decisione dell'utente del 26-08: nessun marchio
reale) al posto del bianco-rosso continuo. Vale in città e, se sta bene, ovunque.

### 3. Il lusso attorno a box e traguardo

È la zona che si guarda **da fermi** — griglia, podio, pit stop — e l'unica dove
conviene spendere modelli veri: hospitality, terrazze, verde curato. Richiesta
dell'utente dalla carrellata: «i circuiti sono delle zone per ricchi... la zona
intorno al rettilineo del traguardo e in generale ai box è curatissima e
lussuosa».

### 4. In città il paddock esterno NON si genera

Oggi motorhome, camion, container, tende e parcheggio nascono a ~200 unità dalla
pista, cioè **dietro le facciate**: invisibili, e pagati a ogni frame. Misurato
su citta-prova: 49 oggetti.

Parole dell'utente (2026-08-27): «credo che in questo caso cittadino il paddock
esterno non abbia senso averlo, se tanto è dietro gli edifici non lo vediamo
mai».

⚠️ **Da NON togliere**: gli edifici della corsia box (`pitsGarageClosed`,
`pitsOffice`), il podio, la torre di controllo, i box dei piloti. Quelli stanno
dentro il recinto, davanti alle facciate, e si vedono.

## Ordine

Si comincia dalla 4 — è la più corta e si misura da sola (oggetti generati) —
poi la 1, che è quella che si vede di più, poi 2 e 3.

## Invarianti

- Le piste **senza** `ambientazione: "citta"` non cambiano di un vertice.
- Ciò che si posa sul marciapiede resta **davanti** alle facciate: vale
  l'invariante già in vigore, «niente di bordo pista finisce dentro una
  facciata», che gira su ogni pista della cartella.
- Niente marchi reali sugli sponsor.
- Gli asset nuovi passano dal **gate di approvazione**: render prima di
  cablarli in gioco.
