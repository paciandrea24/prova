// frontend/shared/toonPanel.js
//
// Pannello di taratura del look cel-shaded (F9) e interruttore rapido dei
// contorni (F8). Nascosto di default, agisce in tempo reale sulle uniform
// condivise: nessun refresh, nessuna ricompilazione degli shader.
//
// Testo e glifi monocromatici, niente emoji (convenzione di progetto).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToonPanel = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    function riga(padre, etichetta, min, max, valore, passo, onChange) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;font:11px monospace;color:#dfe3e6;';
        const nome = document.createElement('span');
        nome.textContent = etichetta;
        nome.style.cssText = 'flex:0 0 130px;';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = passo; slider.value = valore;
        slider.style.cssText = 'flex:1;';
        const eco = document.createElement('span');
        eco.textContent = Number(valore).toFixed(3);
        eco.style.cssText = 'flex:0 0 52px;text-align:right;';
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            eco.textContent = v.toFixed(3);
            onChange(v);
        });
        wrap.append(nome, slider, eco);
        padre.appendChild(wrap);
    }

    function interruttore(padre, etichetta, acceso, onToggle) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;font:11px monospace;color:#dfe3e6;';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = acceso;
        box.addEventListener('change', () => onToggle(box.checked));
        const nome = document.createElement('span');
        nome.textContent = etichetta;
        wrap.append(box, nome);
        padre.appendChild(wrap);
        return box;
    }

    function install({ style, sky, outline, scene, lights, renderer, attivo }) {
        const u = style.uniforms;

        const box = document.createElement('div');
        box.style.cssText = [
            'position:fixed;top:12px;left:12px;z-index:9999;display:none;',
            'background:rgba(16,18,22,0.92);border:1px solid #3a4048;border-radius:6px;',
            'padding:10px 12px;width:330px;font:11px monospace;color:#dfe3e6;',
        ].join('');

        const titolo = document.createElement('div');
        titolo.textContent = `STILE  build ${style.BUILD || '?'}  — F9 chiude, F8 contorni`;
        titolo.style.cssText = 'font-weight:bold;margin-bottom:6px;letter-spacing:0.5px;';
        box.appendChild(titolo);

        // Con ?toon=off il gioco gira nella configurazione di prima: va detto,
        // altrimenti gli interruttori sembrano rotti.
        if (attivo === false) {
            const avviso = document.createElement('div');
            avviso.textContent = 'look DISATTIVATO (?toon=off) — confronto A/B';
            avviso.style.cssText = 'margin-bottom:6px;color:#e9b64f;';
            box.appendChild(avviso);
        }

        const fps = document.createElement('div');
        fps.style.cssText = 'margin-bottom:8px;color:#8fd3f0;white-space:pre-line;line-height:1.4;';
        fps.textContent = 'fps —';
        box.appendChild(fps);

        interruttore(box, 'luce a fasce e palette', true, (on) => style.setEnabled(on));
        interruttore(box, 'cielo a gradiente', true, (on) => sky.setEnabled(on));
        const boxContorni = interruttore(box, 'contorni', !!outline, (on) => { if (outline) outline.setEnabled(on); });
        if (!outline) boxContorni.disabled = true;

        // Scala la tinta della fascia in ombra: 1 = valore di palette, sotto 1
        // scurisce, sopra 1 schiarisce. La TINTA non cambia, solo la sua forza.
        const tinta = ToonPalette.hexToRgb(ToonPalette.SHADOW_TINT);
        riga(box, 'forza ombra', 0.3, 1.6, 1, 0.01, (v) => {
            u.uShadowTint.value.setRGB(
                Math.min(1, tinta.r * v),
                Math.min(1, tinta.g * v),
                Math.min(1, tinta.b * v)
            );
        });
        // Le due manopole che decidono davvero il contrasto delle fasce: solo
        // l'apporto del SOLE viene quantizzato, quello dell'ambiente è
        // costante. Somma vicina a 1 = fasce ben staccate; somma molto sopra 1
        // = tutto saturo e piatto.
        if (lights && lights.sun) {
            riga(box, 'sole', 0.1, 1.6, lights.sun.intensity, 0.01, (v) => { lights.sun.intensity = v; });
        }
        if (lights && lights.hemi) {
            riga(box, 'ambiente', 0.0, 1.2, lights.hemi.intensity, 0.01, (v) => { lights.hemi.intensity = v; });
        }
        riga(box, 'chiazze prato', 0, 1, u.uPatchAmount.value, 0.01, (v) => { u.uPatchAmount.value = v; });
        riga(box, 'scala chiazze', 0.002, 0.05, u.uPatchScale.value, 0.001, (v) => { u.uPatchScale.value = v; });
        riga(box, 'ciuffi erba', 0, 1, u.uTuftAmount.value, 0.01, (v) => { u.uTuftAmount.value = v; });
        riga(box, 'scala ciuffi', 0.05, 1.5, u.uTuftScale.value, 0.01, (v) => { u.uTuftScale.value = v; });
        riga(box, 'nebbia', 0, 0.005, scene.fog ? scene.fog.density : 0.0016, 0.0001, (v) => {
            if (scene.fog) scene.fog.density = v;
        });
        // Cielo: le tre manopole che decidono come la banda calda incontra
        // l'orizzonte. "calore orizzonte" muove ANCHE la nebbia, perché sono
        // per costruzione lo stesso colore.
        if (sky && sky.setWarmPos) {
            riga(box, 'quota banda calda', 0.02, 0.40, sky.uniforms.uStops.value[1], 0.005,
                (v) => sky.setWarmPos(v));
            riga(box, 'inizio azzurro', 0.15, 0.90, sky.uniforms.uStops.value[2], 0.01,
                (v) => sky.setBlueStart(v));
            riga(box, 'calore orizzonte', 0, 1, 0, 0.01, (v) => sky.setHorizonWarmth(v));
        }
        if (outline) {
            riga(box, 'spessore contorno', 0.5, 3, outline.uniforms.uThickness.value, 0.1,
                (v) => { outline.uniforms.uThickness.value = v; });
            riga(box, 'sensib. normali', 0.05, 1, outline.uniforms.uNormalBias.value, 0.01,
                (v) => { outline.uniforms.uNormalBias.value = v; });
            riga(box, 'sensib. profondità', 0.001, 0.2, outline.uniforms.uDepthBias.value, 0.001,
                (v) => { outline.uniforms.uDepthBias.value = v; });
            // Due dissolvenze separate: quella dei bordi INTERNI è la manopola
            // che toglie il nero impastato all'orizzonte.
            riga(box, 'sfuma bordi interni', 20, 400, outline.uniforms.uFadeNormStart.value, 5,
                (v) => {
                    outline.uniforms.uFadeNormStart.value = v;
                    outline.uniforms.uFadeNormEnd.value = v * 2.7;
                });
            riga(box, 'sfuma silhouette', 60, 900, outline.uniforms.uFadeStart.value, 10,
                (v) => {
                    outline.uniforms.uFadeStart.value = v;
                    outline.uniforms.uFadeEnd.value = v * 2.6;
                });
        }

        // ── Ricolorazione degli asset del circuito ───────────────────
        // Un selettore per ciascuna delle tinte neutre del builder: sono
        // quelle che la correzione di saturazione non può toccare (un grigio
        // resta grigio per quanto lo si saturi). I valori scelti qui vanno poi
        // scritti in backend/tools/voxelKit.py — il pulsante in fondo li
        // stampa già nel formato giusto.
        const sepCol = document.createElement('div');
        sepCol.textContent = 'COLORI DEGLI ASSET';
        sepCol.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid #3a4048;font-weight:bold;';
        box.appendChild(sepCol);

        const scelti = {};
        for (const [chiave, voce] of Object.entries(ToonPalette.ASSET_REMAP)) {
            scelti[chiave] = voce.dst;
            const wrap = document.createElement('label');
            wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:3px 0;font:11px monospace;color:#dfe3e6;';
            const nome = document.createElement('span');
            nome.textContent = chiave;
            nome.style.cssText = 'flex:0 0 118px;';
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = '#' + voce.dst.toString(16).padStart(6, '0');
            picker.style.cssText = 'flex:0 0 44px;height:20px;padding:0;border:none;background:none;cursor:pointer;';
            const eco = document.createElement('span');
            eco.textContent = picker.value.toUpperCase();
            eco.style.cssText = 'flex:1;';
            const partenza = document.createElement('span');
            partenza.textContent = 'era ' + voce.src.toString(16).padStart(6, '0').toUpperCase();
            partenza.style.cssText = 'flex:0 0 96px;text-align:right;color:#8a9098;';
            picker.addEventListener('input', () => {
                const hex = parseInt(picker.value.slice(1), 16);
                scelti[chiave] = hex;
                eco.textContent = picker.value.toUpperCase();
                style.setRemap(chiave, hex);
            });
            wrap.append(nome, picker, eco, partenza);
            box.appendChild(wrap);
        }

        const stampa = document.createElement('button');
        stampa.textContent = 'stampa i colori per voxelKit.py';
        stampa.style.cssText = 'margin-top:6px;width:100%;font:11px monospace;padding:4px;cursor:pointer;';
        stampa.addEventListener('click', () => {
            const righe = Object.entries(scelti).map(([k, v]) =>
                `    '${k}':`.padEnd(22) + `'${v.toString(16).padStart(6, '0').toUpperCase()}',`);
            console.log('# da incollare in backend/tools/voxelKit.py, dentro _HEX\n' + righe.join('\n'));
        });
        box.appendChild(stampa);

        // ── Diagnostica del carico di scena ──────────────────────────
        // Interruttori per capire DA DOVE viene il costo, spegnendo una
        // categoria alla volta senza ricaricare. Non fanno parte del look:
        // servono a rispondere a "chi sta consumando il frame?".
        const sep = document.createElement('div');
        sep.textContent = 'CARICO DI SCENA (diagnostica)';
        sep.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid #3a4048;font-weight:bold;';
        box.appendChild(sep);

        function mostraSe(filtro, visibile) {
            let toccati = 0;
            scene.traverse((c) => {
                if (c.isInstancedMesh && c.userData.sceneryAsset && filtro(c.userData.sceneryAsset)) {
                    c.visible = visibile;
                    toccati++;
                }
            });
            console.log(`[ToonPanel] ${toccati} gruppi ${visibile ? 'riaccesi' : 'spenti'}`);
        }

        interruttore(box, 'spettatori', true, (on) => mostraSe((a) => a.indexOf('spectator') === 0, on));
        interruttore(box, 'alberi e boschi', true, (on) => mostraSe((a) => a.indexOf('tree') === 0, on));
        interruttore(box, 'tutta la scenografia', true, (on) => mostraSe(() => true, on));
        // Congela la shadow map invece di disattivarla: spegnere
        // shadowMap.enabled cambierebbe i define dei materiali e ne
        // forzerebbe la ricompilazione, falsando la misura. Così si smette
        // solo di RIGENERARLA a ogni frame, che è la parte cara quando in
        // scena ci sono migliaia di istanze.
        interruttore(box, 'ombre ricalcolate ogni frame', true, (on) => {
            if (renderer) renderer.shadowMap.autoUpdate = on;
        });

        const audit = document.createElement('button');
        audit.textContent = 'elenca materiali non convertiti';
        audit.style.cssText = 'margin-top:8px;width:100%;font:11px monospace;padding:4px;cursor:pointer;';
        audit.addEventListener('click', () => {
            const rimasti = style.audit(scene);
            console.log(rimasti.length ? `[ToonStyle] non convertiti: ${rimasti.join(', ')}` :
                '[ToonStyle] tutti i materiali sono convertiti');
        });
        box.appendChild(audit);

        document.body.appendChild(box);

        // Contatore. La MEDIA da sola non serve a nulla per gli scatti: un
        // gioco a 70 fps medi con un frame da 60 ms ogni mezzo secondo si
        // sente scattare eccome. Quindi si mostra anche il frame PEGGIORE
        // della finestra, che è il numero che descrive lo stutter, più i
        // contatori di scena — un salto nel numero di programmi mentre giochi
        // significa che la GPU sta compilando shader a caldo, ed è una causa
        // classica di micro-blocchi.
        let frame = 0, t0 = performance.now(), tPrec = t0, peggiore = 0, disegnoMax = 0;
        function tick() {
            const ora = performance.now();
            const dt = ora - tPrec;
            tPrec = ora;
            frame++;
            if (dt > peggiore) peggiore = dt;
            if (outline && outline.stats && outline.stats.ms > disegnoMax) disegnoMax = outline.stats.ms;
            if (ora - t0 >= 500) {
                const medio = Math.round(frame * 1000 / (ora - t0));
                // "disegno" è il tempo speso a renderizzare; se resta basso
                // mentre "frame peggiore" schizza, il ritardo non è grafico.
                let testo = `fps ${medio}   frame peggiore ${peggiore.toFixed(1)} ms   di cui disegno ${disegnoMax.toFixed(1)} ms`;
                if (renderer && renderer.info) {
                    // Con i contorni attivi i contatori di renderer.info a fine
                    // frame descrivono il solo rettangolo dell'overlay: i numeri
                    // veri della scena li cattura ToonOutline durante il frame.
                    const s = (outline && outline.stats && outline.stats.calls)
                        ? outline.stats
                        : { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
                    testo += `\ndraw ${s.calls}   triangoli ${(s.triangles / 1000).toFixed(0)}k   programmi ${renderer.info.programs ? renderer.info.programs.length : '—'}`;
                }
                fps.textContent = testo;
                frame = 0; t0 = ora; peggiore = 0; disegnoMax = 0;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);

        function onKey(e) {
            if (e.code === 'F9') {
                e.preventDefault();
                box.style.display = box.style.display === 'none' ? 'block' : 'none';
            } else if (e.code === 'F8') {
                e.preventDefault();
                if (outline) {
                    outline.setEnabled(!outline.enabled);
                    boxContorni.checked = outline.enabled;
                }
            }
        }
        window.addEventListener('keydown', onKey);

        return {
            dispose() {
                window.removeEventListener('keydown', onKey);
                box.remove();
            },
        };
    }

    return { install };
});
