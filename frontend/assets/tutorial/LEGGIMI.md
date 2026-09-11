# Le fotografie del tutorial

Quattro immagini, una per schermata. Le legge `frontend/shared/f1Tutorial.js`
da questa cartella, con QUESTI NOMI ESATTI.

⚠️ Se un file manca, al suo posto resta lo schemetto disegnato e la schermata
funziona lo stesso: il tutorial non aspetta le foto per esistere.

| file | cosa deve mostrare |
|---|---|
| `weekend.png` | La griglia di partenza vista da dietro, con le auto schierate. |
| `partenza.png` | Il ponte dei semafori **con le luci accese**, un attimo prima del via. |
| `sosta.png` | L'arrivo in corsia box col **muro del conto alla rovescia acceso** (quando diventa azzurro). |
| `gomme.png` | La schermata di scelta mescola, con le tre carte. |

## Come scattarle: dentro la gara, da amministratore

⚠️ **Non usare l'anteprima esplorabile** (`track-preview.html`): e' costruita
apposta SENZA luci, ombre e contorni, quindi li' il gioco non somiglia a se
stesso. Provato, e il risultato era piatto.

Serve una gara vera. Il modo comodo e' una gara di soli bot:

1. Crea una stanza da solo, scegli **F1 → Quick Race**, bot accesi, e parti.
2. In gara premi **F6**: camera libera. La tua auto si ferma — i comandi da li'
   in poi muovono la CAMERA, non lei — e i bot continuano a correre.
3. **Clic** per agganciare il mouse e guardarti intorno. **WASD** per volare,
   **Spazio** sali, **Shift** scendi, **rotellina** per andare piu' veloce o
   piu' piano.
4. Mettiti dove serve e premi **F7**: salva un PNG nella cartella dei download,
   col nome della pista e l'ora.
5. **F6** di nuovo per tornare alla camera normale.

Consigli per le quattro inquadrature:

- **weekend**: mettiti dietro la griglia, bassa, con le auto in fila davanti.
- **partenza**: in griglia guardando il ponte, mentre i semafori sono accesi —
  hai qualche secondo, la sequenza dura fra i 4 e i 7 secondi.
- **sosta**: segui un bot che entra ai box e mettiti in corsia dove il muro si
  accende.
- **gomme**: questa non e' nel mondo 3D, e' una schermata. Basta un
  `Win+Alt+Stamp` mentre scegli la mescola, oppure la faccio io.

⚠️ Prima di scattare premi **F10** per spegnere la legenda admin: quelle
scritte non le vede nessun altro giocatore.

## Come metterle a posto

Rinominale come da tabella e mettile in questa cartella. Il taglio e il
ridimensionamento non servono: il tutorial le taglia da solo in 16:9 e le
tiene sotto i 190 px d'altezza, cosi' non fa mai scorrere la pagina.
