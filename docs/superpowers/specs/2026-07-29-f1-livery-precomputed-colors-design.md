# F1 — 4b/B': applicare in gara colori-livrea già calcolati

## Contesto

Sostituisce l'approccio precedente (vedi
`docs/superpowers/specs/2026-07-29-f1-livery-ingame-port-design.md`,
superseduto). Invece di ricalcolare i pattern dal vivo ad ogni
caricamento auto (fragile — vedi i bug reali risolti in
[[project_f1_livery_ingame_port]]: texture pristina necessaria,
saturazione HSL instabile vicino al nero, centro laterale sbagliato,
ecc.), l'idea dell'utente: il calcolo (pattern + trasferimento ombra,
stesso algoritmo già provato dell'editor esterno) gira **una sola volta**
quando il giocatore salva la propria livrea — non nel gioco. Il gioco si
limita a caricare colori-per-voxel già pronti e "incollarli" sulla
geometria — nessun calcolo, nessuno dei problemi già risolti stasera può
ripresentarsi perché non c'è più nessuna logica di ricostruzione dal vivo.

**Garanzia data all'utente e confermata accettabile**: i colori/pattern
saranno identici (stesso dato salvato), ma la resa visiva finale in gara
non sarà pixel-per-pixel identica all'anteprima dell'editor — il gioco
usa `ACESFilmicToneMapping` + luce solare/ombre dinamiche di pista,
l'editor `NoToneMapping` + luci da studio senza ombre sull'auto. Stessa
livrea, contesto di illuminazione diverso (normale, non un difetto).

## Scope di questo sotto-progetto (B')

Solo la capacità del gioco di **caricare e applicare** un array di colori
già calcolato — non tocca ancora come quell'array viene PRODOTTO (quello
è D, l'editor integrato con pulsante "Salva") né dove viene SALVATO/
recuperato per account (quello è A) né come arriva agli altri giocatori
in rete (quello è C). Per verificare B' in isolamento, si usa una
**fixture statica** (JSON pre-calcolato una tantum, congelato dal
calcolo già funzionante dello spike di stasera) al posto di un vero
salvataggio account.

## Architettura

`carLoader.js::loadCarModel(playerColor, onReady, deps, liveryColors)`:
nuovo 4° parametro opzionale. `liveryColors` è un oggetto
`{ [meshName]: Float32Array|number[] }` (una tripletta RGB per vertice,
stesso ordine dell'attributo `position` di quella mesh — Chassis/Nose/
Plank). Se assente: comportamento identico a oggi (tinta singola via
`recolorLiveryTexture`), nessuna regressione per chi non ha una livrea
salvata. Se presente, per ciascuna mesh con un array corrispondente:

1. Clona la geometria (ogni istanza auto — propria e avversari — deve
   avere il proprio buffer colore, altrimenti dipingerne una le
   dipingerebbe tutte).
2. Scrive l'array come nuovo attributo `color` sulla geometria clonata.
3. Rimuove `material.map` (THREE.js moltiplica texture×vertexColor
   quando entrambi attivi — lezione già imparata stasera, va tolta la
   texture perché il colore-livrea sia l'unica fonte) e imposta
   `material.vertexColors = true`.

Ruote/ali/halo/tcam: NESSUN cambiamento, restano gestite esattamente
come oggi da `recolorLiveryTexture`/`isFixedMesh`.

## Fixture di test (non è ancora il salvataggio vero)

Si congela UNA VOLTA il calcolo già funzionante di
`frontend/shared/liveryPattern.js` (spike di stasera, pattern
`racing_stripes`, colori rosso/bianco/nero già verificati visivamente
dall'utente): si esegue il gioco con lo spike attivo, si aggiunge
temporaneamente un dump (`JSON.stringify` dell'array colori risultante
per Chassis/Nose/Plank + `download` del file) e si salva il risultato
come `frontend/assets/custom/f1CarTestLivery.json` (fixture committata
nel repo, non generata a runtime). `f1.js` userà questa fixture come
`liveryColors` di test per TUTTE le auto (propria e avversari), al posto
del calcolo dal vivo — stesso identico aspetto già validato stasera, ma
raggiunto per "incollaggio" invece che per calcolo.

`frontend/shared/liveryPattern.js` (il modulo dello spike) non serve più
nel gioco dopo questo cambio — resta nel repo come riferimento (o si
rimuove, da decidere in fase di pulizia finale) ma non viene più
richiamato da `f1.js`/`carLoader.js`.

## Test/verifica

- Con la fixture caricata: stesso identico aspetto già confermato
  dall'utente stasera (sidepods rossi, striscia bianca centrata sul
  nose, filetto accento) — su TUTTE le auto in pista, non solo la
  propria.
- Verifica che un'auto SENZA fixture (se testata rimuovendo
  temporaneamente il parametro) torni al comportamento di oggi (tinta
  singola), nessuna regressione.
- Nessun test automatico (nessun framework di test per questo frontend,
  verifica manuale in browser — stesso limite già documentato per lo
  spike).

## Fuori scope (prossimi sotto-progetti)

- **D**: schermata di personalizzazione livrea integrata nella
  piattaforma (di fatto l'editor, con un "Salva" oltre a "Esporta
  .glb") — è lì che l'array-colori VERO verrà prodotto, non più una
  fixture congelata.
- **A**: salvataggio backend (MongoDB + verifica token Firebase via
  `firebase-admin`, primo cambio backend di tutto il percorso 4a/4b).
- **C**: in gara, come sapere quale livrea mostrare sulle auto
  avversarie — probabile che il socket comunichi solo "il giocatore X ha
  una livrea salvata" (id/riferimento), e ogni client la scarichi
  separatamente via richiesta HTTP invece di passarla dentro il flusso
  socket (payload piccolo, dati pesanti fuori dal socket).
