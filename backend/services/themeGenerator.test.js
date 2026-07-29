const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTheme, localTheme, SUPPORTED_PATTERNS } = require('./themeGenerator');

test('SUPPORTED_PATTERNS: esattamente i 4 pattern di questa fase', () => {
    assert.deepEqual([...SUPPORTED_PATTERNS].sort(),
        ['checkers', 'racing_stripes', 'solid', 'split_sides'].sort());
});

test('localTheme: stesso prompt due volte -> stesso risultato (deterministico)', () => {
    const a = localTheme('un tema qualsiasi non nella lista');
    const b = localTheme('un tema qualsiasi non nella lista');
    assert.deepEqual(a, b);
});

test('localTheme: prompt generico -> patternStyle sempre tra i 4 supportati', () => {
    const prompts = ['blu oceano', 'foresta di notte', 'xyz123', 'una macchina veloce'];
    for (const p of prompts) {
        const t = localTheme(p);
        assert.ok(SUPPORTED_PATTERNS.includes(t.patternStyle),
            `patternStyle "${t.patternStyle}" non supportato per prompt "${p}"`);
        assert.match(t.primaryPaint, /^#[0-9a-f]{6}$/i);
        assert.match(t.secondaryPaint, /^#[0-9a-f]{6}$/i);
        assert.match(t.accentPaint, /^#[0-9a-f]{6}$/i);
    }
});

test('localTheme: tema nominato con pattern originale GIA\' supportato (ferrari -> racing_stripes)', () => {
    const t = localTheme('voglio uno stile ferrari');
    assert.equal(t.themeName, 'ferrari');
    assert.equal(t.patternStyle, 'racing_stripes');
    assert.equal(t.primaryPaint, '#d40000');
});

test('localTheme: tema nominato con pattern originale NON supportato viene rimappato (cyberpunk era "diagonal")', () => {
    const t = localTheme('atmosfera cyberpunk');
    assert.equal(t.themeName, 'cyberpunk');
    assert.ok(SUPPORTED_PATTERNS.includes(t.patternStyle));
    assert.notEqual(t.patternStyle, 'diagonal');
    // Stesso colore palette originale, solo il pattern cambia
    assert.equal(t.primaryPaint, '#12043a');
});

test('generateTheme: senza GEMINI_API_KEY -> stesso risultato di localTheme (fallback immediato, nessuna chiamata di rete)', async () => {
    delete process.env.GEMINI_API_KEY;
    delete require.cache[require.resolve('./themeGenerator')];
    const mod = require('./themeGenerator');
    const viaGenerate = await mod.generateTheme('prompt di prova identico');
    const viaLocal = mod.localTheme('prompt di prova identico');
    assert.deepEqual(viaGenerate, viaLocal);
});
