// backend/tools/glbInspect.test.js
//
// Valida il parser contro .glb già in repo di cui le dimensioni sono state
// misurate indipendentemente con Blender headless (2026-08-09): se il parser
// concorda con Blender, ci si può fidare delle misure che produce sui nuovi
// asset del circuito.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { inspectGlb } = require('./glbInspect.js');

const REPO = path.join(__dirname, '..', '..');

test('inspectGlb misura f1PitBox.glb come Blender (6.20 x 2.80 alt x 6.00)', () => {
    const info = inspectGlb(path.join(REPO, 'frontend/assets/custom/f1PitBox.glb'));
    assert.ok(Math.abs(info.size[0] - 6.20) < 0.05, `larghezza ${info.size[0]}`);
    assert.ok(Math.abs(info.size[1] - 2.80) < 0.05, `altezza ${info.size[1]}`);
    assert.ok(Math.abs(info.size[2] - 6.00) < 0.05, `profondità ${info.size[2]}`);
});

test('inspectGlb conta 11 mesh su f1Car.glb (corpo + ruote separate)', () => {
    const info = inspectGlb(path.join(REPO, 'frontend/assets/custom/f1Car.glb'));
    assert.equal(info.meshCount, 11);
});
