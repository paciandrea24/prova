# F1 Stagioni — passo 5b: le rifiniture della premiazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development) per eseguire questo piano task per task. I passi usano checkbox (`- [ ]`).

**Stato di partenza:** il passo 5 è implementato e playtestato (branch `f1-stagioni`, da `e679dfc` a `058d267`). Verdetto dell'utente: **«in generale mi piace molto»**, con tre richieste.

**Spec:** `docs/superpowers/specs/2026-08-19-f1-stagioni-design.md` · **Piano del passo 5:** `docs/superpowers/plans/2026-08-20-f1-stagioni-passo-5.md`

---

## Cosa ha chiesto l'utente (2026-08-20, dopo il playtest)

1. **Bug — la scena di gioco lampeggia fra un movimento e l'altro.** Parole
   sue: «premo su Premiazione, mi fa l'animazione e poi **per un secondo vedo
   la mia macchina nell'ultima pista**; poi mi pare che c'è altro e poi vedo di
   nuovo la macchina nell'ultima pista».

2. **L'annata dev'essere una vera schermata, con le mappe dei circuiti.**
   «Sarebbe carino che man mano che si vedono i punti fatti nelle diverse gare,
   si vedano effettivamente i circuiti cambiare. Possiamo fare la pagina un po'
   in stile quella di selezione degli pneumatici, con al centro la mappa che
   cambia e ai lati le informazioni.»
   Vincolo esplicito: **«una volta che si arriva a questa animazione non
   possiamo aspettare che si carichi la mappa, quindi deve essere tutto pronto
   già prima. Accetto un caricamento per arrivarci.»**
   E: «ciò che mostriamo nel riquadro delle diverse mappe può essere anche
   esattamente identico a ciò che mostriamo nella pagina di selezione delle
   gomme».

3. **La festa finale, col suono.** I fuochi d'artificio gli piacciono, **con
   suono**. Per il problema del bagliore di giorno: **se l'ultimo circuito è
   notturno → fuochi d'artificio; se è diurno → frecce tricolori con bandiera
   italiana**, anche queste **col suono degli aerei**.

## Global Constraints (oltre a quelli del piano del passo 5)

- **Niente attese dentro la cerimonia**: tutto ciò che serve ai quattro
  movimenti si carica PRIMA che la cerimonia cominci. Un caricamento visibile
  prima è approvato dall'utente; un'attesa in mezzo no.
- **Niente asset nuovi da procurare**: il trofeo è l'unica eccezione già
  concordata. Aerei e suoni si generano da codice (geometria voxel e sintesi
  WebAudio), come già si fa altrove nel progetto.
- Italiano, niente emoji, cache-busting ad ogni modifica, commit per task,
  `git add` per nome, push solo dell'utente.
- Suite: `node --test frontend` dalla radice; `node --test .` da `backend/`.
  I 4 rossi noti non sono regressioni.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `frontend/f1.js` | Il sipario sui passaggi, il precaricamento del materiale della cerimonia, la festa finale in scena. |
| `frontend/shared/f1Planimetria.js` *(nuovo)* | Disegna la **mappa** di un circuito su un canvas 2D, partendo dai suoi `controlPoints`. Nessuna dipendenza dal gioco: entra una geometria, esce un disegno. |
| `frontend/shared/f1Planimetria.test.js` *(nuovo)* | Inquadratura e proporzioni della mappa. |
| `frontend/shared/f1SuoniCerimonia.js` *(nuovo)* | I suoni della festa, sintetizzati: niente file da scaricare. |
| `frontend/shared/f1SuoniCerimonia.test.js` *(nuovo)* | Il **programma** dei suoni (quando parte cosa), che è la parte verificabile. |
| `frontend/shared/f1Premiazione.js` | I tempi della festa finale, accanto a quelli della consegna. |
| `frontend/f1.html` + `frontend/styles/f1.css` | La schermata dell'annata rifatta in stile mescole. |

---

## Task 1 — Via i lampi: il sipario copre i passaggi

**Diagnosi.** Fra un movimento e l'altro la scena 3D resta visibile con la
camera di gioco, che inquadra la propria auto ferma sulla pista dell'ultima
gara. Tre finestre scoperte, e sono esattamente le due che l'utente ha visto
più quella iniziale:

1. `f1PremiazioneAvvia` nasconde `#stagione-overlay` **prima** che lo sting
   abbia coperto lo schermo (lo sting copre in 120 ms, ma nel frattempo c'è
   già stato un frame senza overlay);
2. fra la fine dello sting e `avviaPanoramica` passa almeno un frame con la
   camera di gioco;
3. fra `fermaPanoramica()` (dentro `chiudi()` di `mostraAnnata`) e
   `avviaConsegna` idem.

**Fix.** C'è già un sipario nel progetto (`#transizione-sipario`, funzione
`sipario(su, durataMs)` in `f1.js`, usata dalla sequenza qualifica → gara).

- [ ] Alzare il sipario **prima** di nascondere l'overlay, all'inizio di
      `f1PremiazioneAvvia`.
- [ ] Non spegnere mai una camera prima di aver acceso la successiva: in
      `mostraAnnata` il `chiudi()` **non** deve chiamare `fermaPanoramica()`;
      lo farà `avviaConsegna` subito dopo aver impostato la propria camera.
- [ ] Chiamare `aggiornaPremiazione(0)` una volta dentro `avviaConsegna`, così
      il primo frame ha già la camera giusta invece di quella di gioco.
- [ ] Far calare il sipario (`sipario(false, 520)`) solo dopo il primo
      aggiornamento della consegna, e riaprirlo/richiuderlo allo stesso modo
      nel salto (`fermaPremiazione`).
- [ ] Verifica: premere *La premiazione* e guardare i due passaggi. Nessun
      fotogramma con l'auto in pista.
- [ ] Commit: `Stagioni: il sipario copre i passaggi della premiazione`.

---

## Task 2 — La mappa di un circuito, disegnata

**Files:** `frontend/shared/f1Planimetria.js` + test.

La mappa è una **planimetria 2D** disegnata su canvas dai `controlPoints` del
file pista, con `TrackGeometry.sampleLoop` (lo stesso campionamento del gioco:
un secondo modo di ricavare la forma sarebbe un secondo posto dove può
divergere). Non è un render 3D: di circuiti da mostrare ce ne sono fino a
otto, e in scena ne esiste uno solo.

**API:**

```js
F1Planimetria.inquadra(punti, larghezza, altezza, margine)
  // → { scala, offsetX, offsetY }: come stanno quei punti in quel riquadro,
  //   centrati e senza deformare le proporzioni.
F1Planimetria.disegna(ctx, punti, { larghezza, altezza, margine, colore,
                                    spessore, traguardo })
  // → disegna asfalto (polilinea chiusa, `lineJoin: round`), il tratto del
  //   traguardo, e nient'altro.
```

- [ ] **Test** (`f1Planimetria.test.js`), con un `ctx` finto che registra le
      chiamate:
      - un tracciato quadrato entra tutto nel riquadro, margini compresi;
      - le proporzioni non si deformano: la scala è **una sola** per x e y;
      - un tracciato molto largo e basso resta centrato in verticale;
      - `disegna` chiude il percorso (l'ultimo punto torna al primo).
- [ ] Implementare.
- [ ] Commit: `Stagioni: la planimetria di un circuito`.

---

## Task 3 — L'annata in stile mescole, con le mappe

**Files:** `frontend/f1.html`, `frontend/styles/f1.css`, `frontend/f1.js`.

Rifà il movimento 2. Impianto uguale a `#tyre-select-overlay` (tre colonne,
testata con il nome, stessa palette):

- **testata**: `GARA 3 DI 6` + nome del circuito;
- **sinistra — il circuito**: giri, distanza di gara, lunghezza (dagli stessi
  calcoli della pagina mescole: `TrackGeometry.lapLength` e `lapsForDistance`)
  e le barrette del **carattere** (`F1ProfiloCircuito`), che sono già pure e
  girano su qualunque tracciato;
- **centro — la mappa**: un `<canvas>` che viene ridisegnato a ogni tappa, con
  un velo di dissolvenza fra una e l'altra (come `#tyre-shot-fade`);
- **destra — il campionato**: chi ha vinto la gara e la classifica progressiva
  dei primi cinque, coi punti che salgono tappa dopo tappa. Le due barre del
  duello restano, sotto.

**Il precaricamento** (vincolo dell'utente). Prima di avviare la cerimonia:

- [ ] scaricare in parallelo `/tracks/<id>.json` per **tutte** le piste del
      calendario (sono file piccoli: `controlPoints` è un array da poche
      decine di punti);
- [ ] campionare ogni tracciato **una volta sola** e disegnarlo su un
      `<canvas>` fuori schermo, tenendo l'immagine pronta;
- [ ] mostrare intanto la schermata di caricamento del gioco (`caricamento.*`
      in `f1.js`, quella con la barra) — l'utente l'ha approvata
      esplicitamente;
- [ ] solo quando **tutto** è pronto, alzare il sipario e partire con lo
      stacco. Se un file non si carica, quella tappa mostra il riquadro vuoto
      col nome della pista: una mappa mancante non ferma una cerimonia.
- [ ] Commit: `Stagioni: l'annata scorre sulle mappe dei circuiti`.

---

## Task 4 — I suoni della festa

**Files:** `frontend/shared/f1SuoniCerimonia.js` + test.

Sintetizzati con WebAudio sul `THREE.AudioListener` già presente in `f1.js`
(`listener.context`): nel progetto c'è un solo file audio (`engine.wav`) e non
è il caso di aggiungerne altri da procurare.

- **Fuoco d'artificio**: fischio in salita (oscillatore che sale di tono) →
  **botto** (rumore bianco filtrato passa-basso, inviluppo esponenziale) →
  crepitio (tre rumori brevi sfalsati).
- **Jet**: rumore filtrato passa-banda con la frequenza che sale e scende al
  passaggio (effetto doppler), più un rombo grave in coda.

**Cosa si verifica in un test** (l'audio non si ascolta a tavolino): il
**programma**, cioè la lista `{ istanteMs, tipo }` degli eventi.

- [ ] Test: il programma dei fuochi non ha due botti nello stesso istante; ogni
      botto ha il suo fischio **prima**; il programma dei jet ha un passaggio
      per aereo e nessun evento oltre la durata della festa.
- [ ] Implementare la sintesi (funzioni piccole, una per suono, che ricevono un
      `AudioContext`).
- [ ] Commit: `Stagioni: i suoni della festa, sintetizzati`.

---

## Task 5 — Fuochi d'artificio (circuito notturno)

**Files:** `frontend/f1.js`, `frontend/shared/f1Premiazione.js`.

Si accendono nell'**apoteosi**, quando il campione è sul podio, e durano fino
alla fine. Solo se **l'ultima pista è notturna** (`trackData.notturno` della
pista caricata, che è appunto quella dell'ultima gara).

- [ ] Prolungare l'apoteosi (`DURATE.apoteosi`) quel tanto che basta a vedere
      la festa: portarla da 5.2 s a **8 s**, aggiornando il test dei tempi.
- [ ] Un razzo = una salita + uno scoppio. Il razzo è una particella singola
      (un cubetto luminoso) che sale e si spegne; lo scoppio è un ventaglio di
      particelle con gravità bassa, colore preso dai tre del podio.
- [ ] Tre o quattro razzi sfalsati, sopra e dietro il podio, mai davanti alla
      camera.
- [ ] Ogni scoppio chiama il suo suono (Task 4).
- [ ] Commit: `Stagioni: i fuochi d'artificio del campione, di notte`.

---

## Task 6 — Frecce tricolori (circuito diurno)

**Files:** `frontend/f1.js`.

Cinque aerei costruiti **da codice** in stile voxel (scatole: fusoliera, ali,
deriva), in formazione a cuneo, che attraversano il cielo sopra il podio
lasciando tre scie **verde, bianca, rossa** (le particelle esistono già: una
configurazione `SCIA_AEREO` con gravità nulla e vita lunga).

- [ ] Quota e traiettoria: entrano dietro la camera, passano sopra il podio e
      si allontanano verso l'orizzonte — la traiettoria è la **direzione del
      rettilineo**, così funziona su qualunque circuito senza taratura.
- [ ] Le scie: tre emettitori (verde, bianco, rosso) ancorati agli aerei
      esterni della formazione.
- [ ] Il rombo (Task 4) parte prima che entrino in campo e si allontana con
      loro.
- [ ] Commit: `Stagioni: le frecce tricolori del campione, di giorno`.

---

## Alla fine

- [ ] Suite completa, screenshot headless della schermata dell'annata.
- [ ] Playtest dell'utente su una stagione da 3 gare: una che finisce di notte
      e una che finisce di giorno.
- [ ] Aggiornare `project_f1_stagioni.md`.
