import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uid, cloneData, esc, num, dateUrgencyLevel, formatAssetDate, catalogNormalize,
  catalogSimilarity, catalogSimilar, catalogKeyLabel, parsePortTemplate, buildPortRange,
  expandPortDefs, totalPortDefsCount, excelColumnLetter, parseImportDate, parseImportNumber,
} from '../utils.js';

function daysFromNow(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('uid produces a prefixed, unique-enough token', () => {
  const a = uid('rack'), b = uid('rack');
  assert.ok(a.startsWith('rack_'));
  assert.notEqual(a, b);
});

test('cloneData deep-clones without sharing references, passes through null/undefined', () => {
  const original = { a: 1, nested: { b: [1, 2, 3] } };
  const clone = cloneData(original);
  assert.deepEqual(clone, original);
  clone.nested.b.push(4);
  assert.deepEqual(original.nested.b, [1, 2, 3], 'mutating the clone must not affect the original');
  assert.equal(cloneData(null), null);
  assert.equal(cloneData(undefined), undefined);
});

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('num parses numbers and falls back on invalid input', () => {
  assert.equal(num('3.5'), 3.5);
  assert.equal(num('abc', 7), 7);
  assert.equal(num(undefined, 7), 7);
  assert.equal(num(NaN, 2), 2);
});

test('dateUrgencyLevel classifies expired/soon/ok/none relative to today', () => {
  assert.equal(dateUrgencyLevel('', 60), 'none');
  assert.equal(dateUrgencyLevel(daysFromNow(-5), 60), 'expired');
  assert.equal(dateUrgencyLevel(daysFromNow(10), 60), 'soon');
  assert.equal(dateUrgencyLevel(daysFromNow(200), 60), 'ok');
});

test('formatAssetDate renders pt-BR dd/mm/yyyy and empty string for invalid input', () => {
  assert.equal(formatAssetDate('2024-03-05'), '05/03/2024');
  assert.equal(formatAssetDate(''), '');
  assert.equal(formatAssetDate('not-a-date'), '');
});

test('catalogNormalize strips accents, case and punctuation for comparison', () => {
  assert.equal(catalogNormalize('Fibra Óptica (SM)'), 'fibraopticasm');
  assert.equal(catalogNormalize('  UTP  '), 'utp');
  assert.equal(catalogNormalize(null), '');
});

test('catalogSimilarity is 1 for identical normalized strings and 0 when either side is empty', () => {
  assert.equal(catalogSimilarity('UTP', 'utp'), 1);
  assert.equal(catalogSimilarity('', 'utp'), 0);
  assert.ok(catalogSimilarity('Fibra Multi Mode', 'Fibra Multimodo') > 0.7, 'near-duplicates should score high');
});

test('catalogSimilar suggests near-duplicates but never the exact same normalized value', () => {
  const existing = ['UTP', 'Fibra Multi Mode', 'Fibra Single Mode'];
  assert.deepEqual(catalogSimilar('utp', existing), [], 'an exact (case-insensitive) match is not a "similar" suggestion');
  const suggestions = catalogSimilar('Fibra Multimodo', existing);
  assert.ok(suggestions.includes('Fibra Multi Mode'));
});

test('catalogKeyLabel maps known catalog keys to their pt-BR label', () => {
  assert.equal(catalogKeyLabel('types'), 'Tipos de ativo');
  assert.equal(catalogKeyLabel('manufacturers'), 'Fabricantes');
  assert.equal(catalogKeyLabel('unknown-key'), 'Modelos');
});

test('parsePortTemplate splits a trailing number from its prefix/suffix', () => {
  assert.deepEqual(parsePortTemplate('Gi0/1'), { prefix: 'Gi0/', suffix: '', num: 1, width: 1 });
  assert.deepEqual(parsePortTemplate('Porta 007'), { prefix: 'Porta ', suffix: '', num: 7, width: 3 });
  assert.equal(parsePortTemplate('no-digits'), null);
});

test('buildPortRange expands a numeric range and rejects mismatched or reversed labels', () => {
  assert.deepEqual(buildPortRange('Porta 1', 'Porta 3'), ['Porta 1', 'Porta 2', 'Porta 3']);
  assert.equal(buildPortRange('Porta 1', 'Slot 3'), null, 'different prefix/suffix must not build a range');
  assert.equal(buildPortRange('Porta 5', 'Porta 1'), null, 'reversed range is rejected');
  assert.equal(buildPortRange('Porta 1', 'Porta 600'), null, 'ranges over 500 ports are rejected');
});

test('expandPortDefs turns range/single defs into concrete labeled ports', () => {
  const ports = expandPortDefs([
    { kind: 'range', startLabel: 'Eth1', endLabel: 'Eth2' },
    { kind: 'single', label: 'Console', poe: false },
  ]);
  assert.equal(ports.length, 3);
  assert.deepEqual(ports.map(p => p.label), ['Eth1', 'Eth2', 'Console']);
  assert.ok(ports.every(p => typeof p.id === 'string' && p.id.startsWith('port_')));
});

test('totalPortDefsCount counts range expansions without materializing the ports', () => {
  const defs = [{ kind: 'range', startLabel: 'P1', endLabel: 'P24' }, { kind: 'single', label: 'Mgmt' }];
  assert.equal(totalPortDefsCount(defs), 25);
});

test('excelColumnLetter converts 1-based column numbers to spreadsheet letters', () => {
  assert.equal(excelColumnLetter(1), 'A');
  assert.equal(excelColumnLetter(26), 'Z');
  assert.equal(excelColumnLetter(27), 'AA');
  assert.equal(excelColumnLetter(52), 'AZ');
});

test('parseImportDate accepts ISO and dd/mm/yyyy, rejects anything else', () => {
  assert.equal(parseImportDate('2024-03-05'), '2024-03-05');
  assert.equal(parseImportDate('5/3/2024'), '2024-03-05');
  assert.equal(parseImportDate('05/03/2024'), '2024-03-05');
  assert.equal(parseImportDate('not a date'), '');
  assert.equal(parseImportDate(''), '');
});

test('parseImportNumber accepts comma as a decimal separator and falls back on garbage', () => {
  assert.equal(parseImportNumber('3,5'), 3.5);
  assert.equal(parseImportNumber('10'), 10);
  assert.equal(parseImportNumber('abc', 42), 42);
});
