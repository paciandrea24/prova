// frontend/shared/carLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const CarLoader = require('./carLoader.js');

test('CarLoader espone loadCarModel come funzione', () => {
    assert.equal(typeof CarLoader.loadCarModel, 'function');
});
