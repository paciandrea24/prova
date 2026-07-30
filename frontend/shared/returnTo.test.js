// frontend/shared/returnTo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ReturnTo = require('./returnTo.js');

test('isValid accetta index.html senza query', () => {
    assert.equal(ReturnTo.isValid('index.html'), true);
});

test('isValid accetta lobby.html con query', () => {
    assert.equal(ReturnTo.isValid('lobby.html?lobby=ABC12&color=%23FF0000'), true);
});

test('isValid rifiuta un URL assoluto esterno (http)', () => {
    assert.equal(ReturnTo.isValid('http://evil.example/'), false);
});

test('isValid rifiuta un URL assoluto esterno (https)', () => {
    assert.equal(ReturnTo.isValid('https://evil.example/'), false);
});

test('isValid rifiuta un protocol-relative URL (//)', () => {
    assert.equal(ReturnTo.isValid('//evil.example/'), false);
});

test('isValid rifiuta una pagina non in whitelist', () => {
    assert.equal(ReturnTo.isValid('f1.html'), false);
});

test('isValid rifiuta valore vuoto/assente', () => {
    assert.equal(ReturnTo.isValid(''), false);
    assert.equal(ReturnTo.isValid(null), false);
    assert.equal(ReturnTo.isValid(undefined), false);
});

test('parseReturnTo estrae e valida returnTo da una query string', () => {
    const search = '?returnTo=' + encodeURIComponent('lobby.html?lobby=ABC12&color=%23FF0000');
    assert.equal(ReturnTo.parseReturnTo(search), 'lobby.html?lobby=ABC12&color=%23FF0000');
});

test('parseReturnTo torna null se il parametro manca', () => {
    assert.equal(ReturnTo.parseReturnTo(''), null);
});

test('parseReturnTo torna null se il valore non e\' valido (open-redirect)', () => {
    const search = '?returnTo=' + encodeURIComponent('https://evil.example/');
    assert.equal(ReturnTo.parseReturnTo(search), null);
});

test('buildHereAsReturnTo compone pagina+query dal pathname corrente', () => {
    assert.equal(
        ReturnTo.buildHereAsReturnTo('/lobby.html', '?lobby=ABC12&color=%23FF0000'),
        'lobby.html?lobby=ABC12&color=%23FF0000'
    );
});

test('buildHereAsReturnTo funziona anche senza query string', () => {
    assert.equal(ReturnTo.buildHereAsReturnTo('/index.html', ''), 'index.html');
});
