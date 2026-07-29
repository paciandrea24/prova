// Genera un tema livrea (nome + 3 colori + pattern) da una descrizione
// testuale. Porting di generateTheme/localTheme/LOCAL_THEMES da
// C:\Users\pacia\Desktop\livery\voxel_livery_studio.html (tool esterno,
// non nel repo) — stessa logica, con due differenze deliberate:
// 1. La chiamata a Gemini avviene qui (backend), mai dal client: nell'editor
//    esterno la chiave era in chiaro nel JS (va bene lì, quel file non è
//    online) — qui lo sarebbe, quindi la chiave resta server-side
//    (process.env.GEMINI_API_KEY), mai spedita al browser.
// 2. patternStyle è vincolato ai 4 pattern che questa fase (4b/D) supporta
//    (racing_stripes, split_sides, checkers, solid), non tutti e 18
//    dell'editor esterno — vedi
//    docs/superpowers/specs/2026-07-30-f1-livery-editor-page-design.md.

const SUPPORTED_PATTERNS = ['racing_stripes', 'split_sides', 'checkers', 'solid'];

// Stessa PRNG deterministica dell'editor esterno (riga ~498 del file
// sorgente) — usata solo dal fallback locale, non dalla chiamata Gemini.
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Stessa conversione HSL->RGB già in frontend/shared/liveryPattern.js —
// duplicata qui (non condivisibile: quel file gira nel browser e usa
// THREE.Color per la stessa conversione, questo è un modulo Node puro
// senza dipendenze DOM/THREE).
function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h / 360;
    function hue2rgb(t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }
    return [hue2rgb(hk + 1 / 3), hue2rgb(hk), hue2rgb(hk - 1 / 3)];
}

function toHex(rgb01) {
    const toByte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + toByte(rgb01[0]) + toByte(rgb01[1]) + toByte(rgb01[2]);
}

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

// Se il pattern originale dell'editor esterno non è tra i 4 supportati qui,
// lo rimappiamo deterministicamente (stessa chiave -> stesso pattern
// sempre) invece di scartare l'intero tema — la palette colori resta
// quella originale, cambia solo il pattern.
function remapPattern(pattern, seedKey) {
    if (SUPPORTED_PATTERNS.includes(pattern)) return pattern;
    const idx = hashString(seedKey) % SUPPORTED_PATTERNS.length;
    return SUPPORTED_PATTERNS[idx];
}

// Stessi 15 temi nominati e stesse palette dell'editor esterno (righe
// ~1560-1575 del file sorgente) — pattern rimappato dove necessario.
const LOCAL_THEMES_RAW = {
    ferrari: ['#d40000', '#ffffff', '#101010', 'racing_stripes'],
    rossa: ['#d40000', '#ffe600', '#101010', 'split_sides'],
    cyberpunk: ['#12043a', '#00e5ff', '#ff007a', 'diagonal'],
    neon: ['#0a0a12', '#39ff14', '#ff2fd1', 'diagonal'],
    retro: ['#f4e3c1', '#c1452f', '#2f4858', 'halves'],
    arcade: ['#1b1035', '#ff4f9a', '#41ead4', 'abstract'],
    marina: ['#0b2545', '#8ecae6', '#ffb703', 'gradient'],
    foresta: ['#1b3a2b', '#a7c957', '#f2e8cf', 'split_sides'],
    deserto: ['#c2793f', '#f2e3c4', '#3b2a20', 'gradient'],
    ghiaccio: ['#dff3ff', '#4aa3df', '#0f2438', 'top_deck'],
    fuoco: ['#1a0a05', '#ff7b00', '#ffd000', 'gradient'],
    oro: ['#101010', '#d4af37', '#ffffff', 'racing_stripes'],
    militare: ['#4b5320', '#8a9a5b', '#2b2b23', 'abstract'],
    monocromo: ['#f5f5f5', '#1a1a1a', '#8a8a8a', 'split_sides'],
    viola: ['#3a0ca3', '#f72585', '#4cc9f0', 'diagonal']
};

const LOCAL_THEMES = {};
for (const [key, [primary, secondary, accent, pattern]] of Object.entries(LOCAL_THEMES_RAW)) {
    LOCAL_THEMES[key] = [primary, secondary, accent, remapPattern(pattern, key)];
}

// Fallback locale deterministico: stesso identico algoritmo dell'editor
// esterno (tema nominato se il prompt lo contiene, altrimenti palette
// pseudo-casuale derivata da un hash del prompt) — patternStyle SEMPRE uno
// dei 4 supportati (i temi nominati sono già rimappati sopra, la scelta
// pseudo-casuale pesca solo da SUPPORTED_PATTERNS).
function localTheme(prompt) {
    const p = prompt.toLowerCase();
    for (const k in LOCAL_THEMES) {
        if (p.includes(k)) {
            const [primaryPaint, secondaryPaint, accentPaint, patternStyle] = LOCAL_THEMES[k];
            return { themeName: k, primaryPaint, secondaryPaint, accentPaint, patternStyle };
        }
    }
    const h = hashString(p);
    const rnd = mulberry32(h);
    const hue = rnd();
    const c1 = hslToRgb(hue * 360, 0.75, 0.42);
    const c2 = hslToRgb(((hue + 0.42 + rnd() * 0.15) % 1) * 360, 0.7, 0.62);
    const c3 = hslToRgb(((hue + 0.5) % 1) * 360, 0.5, 0.12);
    const patternStyle = SUPPORTED_PATTERNS[Math.floor(rnd() * SUPPORTED_PATTERNS.length)];
    return {
        themeName: prompt.trim() || 'Custom',
        primaryPaint: toHex(c1),
        secondaryPaint: toHex(c2),
        accentPaint: toHex(c3),
        patternStyle
    };
}

// Chiamata Gemini (proxata dal backend). Se manca GEMINI_API_KEY, se la
// rete fallisce, se la risposta non è JSON valido, o se patternStyle non è
// tra i 4 supportati, si cade SEMPRE sul fallback locale sopra — mai un
// errore bloccante per l'utente (stesso comportamento dell'editor esterno).
async function generateTheme(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return localTheme(prompt);

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: {
                    parts: [{
                        text: 'Sei un designer di livree per auto da corsa in voxel art. ' +
                            'Restituisci una palette di 3 colori ad alto contrasto tra loro e un pattern. ' +
                            'primaryPaint e il colore dominante della carrozzeria, secondaryPaint il colore ' +
                            'della grafica principale, accentPaint un terzo colore usato per filetti sottili.'
                    }]
                },
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            themeName: { type: 'STRING' },
                            primaryPaint: { type: 'STRING' },
                            secondaryPaint: { type: 'STRING' },
                            accentPaint: { type: 'STRING' },
                            patternStyle: { type: 'STRING', enum: SUPPORTED_PATTERNS }
                        },
                        required: ['themeName', 'primaryPaint', 'secondaryPaint', 'accentPaint', 'patternStyle']
                    }
                }
            })
        });
        const json = await res.json();
        const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!txt) throw new Error('risposta vuota');
        const d = JSON.parse(txt);
        const fixColor = (c) => {
            let s = String(c || '').trim();
            if (!s.startsWith('#')) s = '#' + s;
            return /^#[0-9a-f]{6}$/i.test(s) ? s : '#888888';
        };
        if (!SUPPORTED_PATTERNS.includes(d.patternStyle)) {
            throw new Error('pattern non supportato: ' + d.patternStyle);
        }
        return {
            themeName: d.themeName || 'Custom',
            primaryPaint: fixColor(d.primaryPaint),
            secondaryPaint: fixColor(d.secondaryPaint),
            accentPaint: fixColor(d.accentPaint),
            patternStyle: d.patternStyle
        };
    } catch (error) {
        console.warn('⚠️ Gemini non disponibile, uso il tema locale:', error.message);
        return localTheme(prompt);
    }
}

module.exports = { generateTheme, localTheme, SUPPORTED_PATTERNS };
