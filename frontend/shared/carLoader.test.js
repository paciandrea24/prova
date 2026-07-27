// frontend/shared/carLoader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const CarLoader = require('./carLoader.js');

test('CarLoader espone loadCarModel come funzione', () => {
    assert.equal(typeof CarLoader.loadCarModel, 'function');
});

test('classifyWheelSide riconosce _FL/_FR come anteriori e _RL/_RR come posteriori', () => {
    assert.equal(CarLoader.classifyWheelSide('wheelhub_fl tire_wheel'), 'front');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_fr'), 'front');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_rl'), 'rear');
    assert.equal(CarLoader.classifyWheelSide('wheelhub_rr tire_wheel'), 'rear');
    assert.equal(CarLoader.classifyWheelSide('chassis frame'), null);
});

test('classifyWheelSide non confonde _fl/_fr con parole come flap/floor/flange', () => {
    assert.equal(CarLoader.classifyWheelSide('chassis flap'), null);
    assert.equal(CarLoader.classifyWheelSide('rear_floor'), null);
});
