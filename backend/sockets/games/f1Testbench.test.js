// backend/sockets/games/f1Testbench.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestbenchScenario } = require('./f1Testbench.js');
const { listTracks } = require('./trackLoader.js');

test('validateTestbenchScenario: scenario valido passa', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 30, compound: 'medium' });
    assert.deepEqual(result, { valid: true });
});

test('validateTestbenchScenario: trackId inesistente viene rifiutato', () => {
    const result = validateTestbenchScenario({ trackId: 'pista-che-non-esiste', botCount: 4, tyreWear: 0, compound: 'medium' });
    assert.equal(result.valid, false);
    assert.match(result.error, /pista/i);
});

test('validateTestbenchScenario: botCount fuori range [2,6] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 1, tyreWear: 0, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 7, tyreWear: 0, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: tyreWear fuori range [0,100] viene rifiutato', () => {
    const trackId = listTracks()[0].id;
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: -1, compound: 'medium' }).valid, false);
    assert.equal(validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 101, compound: 'medium' }).valid, false);
});

test('validateTestbenchScenario: mescola sconosciuta viene rifiutata', () => {
    const trackId = listTracks()[0].id;
    const result = validateTestbenchScenario({ trackId, botCount: 4, tyreWear: 0, compound: 'ultrasoft' });
    assert.equal(result.valid, false);
    assert.match(result.error, /mescola/i);
});
