# Le fotografie del tutorial

Quattro immagini, una per schermata. Le legge `frontend/shared/f1Tutorial.js`
da questa cartella, con QUESTI NOMI ESATTI.

⚠️ Se un file manca, la sua immagine si nasconde da sola e la schermata resta
leggibile: il tutorial non si rompe mentre aspetta le foto.

| file | cosa deve mostrare |
|---|---|
| `weekend.png` | ✅ **GIA' FATTA.** Il rettilineo del traguardo con le piazzole dipinte, il ponte dei semafori e i box. Scattata dall'anteprima esplorabile (`track-preview.html`), che costruisce la scena vera con gli asset veri. |
| `partenza.png` | Il ponte dei semafori **con le luci accese**, inquadrato come lo vedi dall'abitacolo un attimo prima del via. |
| `sosta.png` | L'arrivo in corsia box con il **muro del conto alla rovescia acceso** (quando diventa azzurro). È il momento che il testo descrive. |
| `gomme.png` | La schermata di scelta mescola, con le tre carte e i giri di durata. |

## Come scattarle

- **Formato 16:9**, almeno 960×540. Più grandi va bene, vengono ridotte.
- `.png` per le fotografie di gioco (pesano molto meno del `.png` a parità di
  resa su un'immagine 3D).
- ⚠️ **Con la legenda admin spenta** (F10 in gara): quelle scritte non le vede
  nessun altro giocatore, e in un tutorial insegnerebbero tasti che per lui
  non esistono.
- Tieni l'HUD normale acceso: fa parte di ciò che il giocatore vedrà.

## Come aggiungerne, togliere o cambiare

Nel file `f1Tutorial.js`, dentro `PASSI`, ogni passo ha un campo `foto`.
Toglilo e la schermata resta senza immagine; cambialo e punta a un altro file.
