import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFormat,
  isFileFormat,
  isAmbiguousNamespaceItems,
  pickNamespaceFormat,
  parseFieldPath,
  parseFieldValue,
  getField,
  setField,
  renderFieldValue
} from '../src/filecontent.js';

// ---- 格式判定 ----

test('filecontent：normalizeFormat 与 isFileFormat', () => {
  assert.equal(normalizeFormat(' YML '), 'yml');
  assert.equal(normalizeFormat('Yaml'), 'yaml');
  assert.equal(normalizeFormat(undefined), '');
  assert.equal(normalizeFormat(3), '');
  for (const f of ['yml', 'yaml', 'json', 'YML', ' json ']) assert.equal(isFileFormat(f), true, f);
  for (const f of ['properties', 'xml', 'text', '', undefined, 0, null]) assert.equal(isFileFormat(f), false, String(f));
});

test('filecontent：isAmbiguousNamespaceItems', () => {
  assert.equal(isAmbiguousNamespaceItems([]), true);
  assert.equal(isAmbiguousNamespaceItems([{ key: 'content' }]), true);
  assert.equal(isAmbiguousNamespaceItems([{ key: 'content' }, { key: 'a' }]), false);
  assert.equal(isAmbiguousNamespaceItems([{ key: 'a' }]), false);
  assert.equal(isAmbiguousNamespaceItems(null), false);
  assert.equal(isAmbiguousNamespaceItems(undefined), false);
});

test('filecontent：pickNamespaceFormat 命中与回退', () => {
  const list = [
    { baseInfo: { namespaceName: 'application' }, format: 'yml' },
    { namespaceName: 'app.yaml', format: 'YAML' },
    { baseInfo: { namespaceName: 'plain' }, format: 'properties' }
  ];
  assert.equal(pickNamespaceFormat(list, 'application'), 'yml');
  assert.equal(pickNamespaceFormat(list, 'app.yaml'), 'yaml');
  assert.equal(pickNamespaceFormat(list, 'plain'), 'properties');
  assert.equal(pickNamespaceFormat(list, 'missing'), null);
  assert.equal(pickNamespaceFormat([{ baseInfo: { namespaceName: 'x' } }], 'x'), null);
  assert.equal(pickNamespaceFormat(null, 'x'), null);
});

// ---- 字段路径 ----

test('filecontent：parseFieldPath 合法输入', () => {
  assert.deepEqual(parseFieldPath('a'), ['a']);
  assert.deepEqual(parseFieldPath('a.b[0].c'), ['a', 'b', 0, 'c']);
  assert.deepEqual(parseFieldPath('a[0][1]'), ['a', 0, 1]);
  assert.deepEqual(parseFieldPath('[0].a'), [0, 'a']);
  assert.deepEqual(parseFieldPath('a.0'), ['a', '0']);
  assert.deepEqual(parseFieldPath('a b'), ['a b']);
  assert.deepEqual(parseFieldPath('[01]'), [1]);
  assert.deepEqual(parseFieldPath(' a.b '), ['a', 'b']);
});

test('filecontent：parseFieldPath 非法输入', () => {
  const bad = ['', '.a', 'a.', 'a..b', 'a[', 'a[]', 'a[x]', 'a[0]b', 'a.[0]', 'a]', '[a]'];
  for (const path of bad) {
    assert.throws(() => parseFieldPath(path), /字段路径无效/, `path=${JSON.stringify(path)}`);
  }
});

// ---- 值解析 ----

test('filecontent：parseFieldValue 标量与结构', () => {
  assert.equal(parseFieldValue('123', {}), 123);
  assert.equal(parseFieldValue('1.5', {}), 1.5);
  assert.equal(parseFieldValue('true', {}), true);
  assert.equal(parseFieldValue('false', {}), false);
  assert.equal(parseFieldValue('null', {}), null);
  assert.equal(parseFieldValue('~', {}), null);
  assert.deepEqual(parseFieldValue('{}', {}), {});
  assert.deepEqual(parseFieldValue('[]', {}), []);
  assert.deepEqual(parseFieldValue('{a: 1}', {}), { a: 1 });
  assert.deepEqual(parseFieldValue('[1, 2]', {}), [1, 2]);
  assert.equal(parseFieldValue("'123'", {}), '123');
  assert.equal(parseFieldValue('abc', {}), 'abc');
  assert.equal(parseFieldValue('hello world', {}), 'hello world');
  assert.equal(parseFieldValue('yes', {}), 'yes');
  assert.equal(parseFieldValue('', {}), '');
  assert.equal(parseFieldValue('a\nb', {}), 'a\nb');
  assert.equal(parseFieldValue('# x', {}), '# x');
});

test('filecontent：parseFieldValue --string 与结构解析失败', () => {
  assert.equal(parseFieldValue('{a: 1}', { string: true }), '{a: 1}');
  assert.equal(parseFieldValue('123', { string: true }), '123');
  assert.equal(parseFieldValue('', { string: true }), '');
  assert.throws(() => parseFieldValue('{a', {}), /值解析失败.*--string/s);
  assert.throws(() => parseFieldValue('[1,', {}), /值解析失败/);
});

// ---- getField ----

test('filecontent：getField yaml 命中、缺失与数组', () => {
  const content = 'a: 1\nb:\n  c: x\nlist:\n  - id: 1\n    name: n\n  - id: 2\nstr: "123"\nnul: null\n';
  assert.deepEqual(getField(content, 'yml', 'a'), { found: true, value: 1 });
  assert.deepEqual(getField(content, 'yml', 'b.c'), { found: true, value: 'x' });
  assert.deepEqual(getField(content, 'yml', 'list[1].id'), { found: true, value: 2 });
  assert.deepEqual(getField(content, 'yaml', 'str'), { found: true, value: '123' });
  assert.deepEqual(getField(content, 'yml', 'nul'), { found: true, value: null });
  assert.deepEqual(getField(content, 'yml', 'b.missing'), { found: false });
  assert.deepEqual(getField(content, 'yml', 'list[5]'), { found: false });
  assert.deepEqual(getField(content, 'yml', 'ghost.deep'), { found: false });
});

test('filecontent：getField 空内容与结构错误', () => {
  assert.deepEqual(getField('', 'yml', 'a'), { found: false });
  assert.deepEqual(getField('', 'json', 'a'), { found: false });
  assert.throws(() => getField('a: 1\n', 'yml', 'a.b'), /不是对象或数组/);
  assert.throws(() => getField('a: [1, 2]\n', 'yml', 'a.x'), /是数组，请使用下标/);
  assert.throws(() => getField('a: {b: 1}\n', 'yml', 'a[0]'), /是对象，不能使用下标/);
  assert.throws(() => getField('[1, 2]\n', 'yml', 'a'), /是数组，请使用下标（如 "\[0\]"）/);
});

test('filecontent：getField 内容解析失败', () => {
  assert.throws(() => getField('a: [1,\n', 'yml', 'a'), /内容解析失败（格式 yml）/);
  assert.throws(() => getField('a: 1\n---\nb: 2\n', 'yml', 'a'), /内容解析失败.*不支持多文档/);
  assert.throws(() => getField('{"a": 1', 'json', 'a'), /内容解析失败（格式 json）/);
});

test('filecontent：getField json 命中与缺失', () => {
  const content = '{"a": {"b": [1, 2]}, "s": "x"}';
  assert.deepEqual(getField(content, 'json', 'a.b[1]'), { found: true, value: 2 });
  assert.deepEqual(getField(content, 'json', 's'), { found: true, value: 'x' });
  assert.deepEqual(getField(content, 'json', 'a.b[9]'), { found: false });
  assert.deepEqual(getField(content, 'json', 'ghost'), { found: false });
  assert.throws(() => getField('{"a": 1}', 'json', 'a.b'), /不是对象或数组/);
});

// ---- renderFieldValue ----

test('filecontent：renderFieldValue 输出形态', () => {
  assert.equal(renderFieldValue('abc', 'yml', {}), 'abc\n');
  assert.equal(renderFieldValue(123, 'yml', {}), '123\n');
  assert.equal(renderFieldValue(null, 'yml', {}), 'null\n');
  assert.equal(renderFieldValue(true, 'yml', {}), 'true\n');
  assert.equal(renderFieldValue({ a: 1, b: [1, 2] }, 'yml', {}), 'a: 1\nb:\n  - 1\n  - 2\n');
  assert.equal(renderFieldValue({ a: 1 }, 'json', {}), '{\n  "a": 1\n}\n');
  assert.equal(renderFieldValue('abc', 'yml', { json: true }), '"abc"\n');
  assert.equal(renderFieldValue(null, 'yml', { json: true }), 'null\n');
  assert.equal(renderFieldValue({ a: 1 }, 'yml', { json: true }), '{\n  "a": 1\n}\n');
});

// ---- setField：YAML ----

test('filecontent：setField yaml 标量替换保留注释', () => {
  assert.equal(setField('a: 1 # c\nb: 2\n', 'yml', 'a', 9), 'a: 9 # c\nb: 2\n');
  assert.equal(setField('# head\na: 1\n', 'yaml', 'b', 2), '# head\na: 1\nb: 2\n');
  assert.equal(setField('a:\n  b: 1\nc: 3\n', 'yml', 'a.b', 2), 'a:\n  b: 2\nc: 3\n');
  assert.equal(setField('list:\n  - x: 1\n', 'yml', 'list[0].x', 9), 'list:\n  - x: 9\n');
  assert.equal(setField('a: 1\n', 'yml', 'a', '123'), 'a: "123"\n');
});

test('filecontent：setField yaml 数组追加与越界', () => {
  assert.equal(setField('list:\n  - x: 1\n', 'yml', 'list[1].y', 2), 'list:\n  - x: 1\n  - y: 2\n');
  assert.throws(() => setField('list:\n  - 1\n', 'yml', 'list[3]', 1), /数组下标越界: "list\[3\]"（当前长度 1）/);
});

test('filecontent：setField yaml 空内容按路径创建块状结构', () => {
  assert.equal(setField('', 'yml', 'a.b[0].c', 1), 'a:\n  b:\n    - c: 1\n');
  assert.equal(setField('', 'yaml', 'a', { b: 1 }), 'a:\n  b: 1\n');
  assert.throws(() => setField('', 'yml', 'a.b[2].c', 1), /无法创建数组 "a.b\[2\]": 起始下标必须为 0（收到 2）/);
});

test('filecontent：setField yaml 结构错误', () => {
  assert.throws(() => setField('a: 1\n', 'yml', 'a.b', 1), /路径段 "a" 不是对象或数组/);
  assert.throws(() => setField('[1]\n', 'yml', 'a', 1), /是数组，请使用下标/);
  assert.throws(() => setField('a: 1\n', 'yml', '[0]', 1), /是对象，不能使用下标/);
  assert.throws(() => setField('5\n', 'yml', 'a', 1), /根节点不是对象或数组/);
  assert.throws(() => setField('a: [1, 2]\n', 'yml', 'a[0].b', 1), /路径段 "a\[0\]" 不是对象或数组/);
  assert.throws(() => setField('a: 1\n---\nb: 2\n', 'yml', 'a', 2), /不支持多文档/);
});

test('filecontent：setField yaml 保留 BOM 且 yml/yaml 行为一致', () => {
  assert.equal(setField('\uFEFFa: 1\n', 'yml', 'a', 2), '\uFEFFa: 2\n');
  const args = ['a: 1\nb: 2\n', 'a', 9];
  assert.equal(setField(...args.slice(0, 1), 'yml', ...args.slice(1)), setField(...args.slice(0, 1), 'yaml', ...args.slice(1)));
});

// ---- setField：JSON ----

test('filecontent：setField json 往返与缩进沿用', () => {
  assert.equal(setField('{"a":1}', 'json', 'a', 2), '{"a":2}');
  // 仅尾部换行（final newline）不应触发整文件重排
  assert.equal(setField('{"a":1}\n', 'json', 'a', 2), '{"a":2}\n');
  assert.equal(setField('{\n  "a": 1\n}\n', 'json', 'a', 2), '{\n  "a": 2\n}\n');
  assert.equal(setField('{\n    "a": 1\n}\n', 'json', 'a', 2), '{\n    "a": 2\n}\n');
  assert.equal(setField('{"a": {"b": [1]}}', 'json', 'a.b[1]', 2), '{"a":{"b":[1,2]}}');
});

test('filecontent：setField json 空内容创建与错误', () => {
  assert.equal(setField('', 'json', 'a.b', 3), '{\n  "a": {\n    "b": 3\n  }\n}\n');
  // 空内容无预设形态：[0].a 可创建数组根（与 YAML 一致）
  assert.equal(setField('', 'json', '[0].a', 1), '[\n  {\n    "a": 1\n  }\n]\n');
  assert.deepEqual(getField('', 'json', '[0]'), { found: false });
  assert.throws(() => setField('', 'json', 'a[1]', 1), /无法创建数组 "a\[1\]": 起始下标必须为 0（收到 1）/);
  assert.throws(() => setField('{"a": [1]}', 'json', 'a[3]', 1), /数组下标越界: "a\[3\]"（当前长度 1）/);
  assert.throws(() => setField('{"a": 1}', 'json', 'a.b', 1), /路径段 "a" 不是对象或数组/);
  assert.throws(() => setField('{bad', 'json', 'a', 1), /内容解析失败（格式 json）/);
});

test('filecontent：setField json 拒绝 __proto__ 写入，yaml 可写且 get 可读', () => {
  assert.throws(
    () => setField('{"a":{}}', 'json', '__proto__.x', 1),
    /字段路径 "__proto__\.x" 包含不支持写入的键 "__proto__"/
  );
  assert.throws(() => setField('{}', 'json', '__proto__', 1), /不支持写入的键/);
  assert.equal(setField('a: 1\n', 'yml', '__proto__', 2), 'a: 1\n__proto__: 2\n');
  assert.deepEqual(getField('{"__proto__": 5}', 'json', '__proto__'), { found: true, value: 5 });
});

test('filecontent：setField 纯注释文档保留注释', () => {
  assert.equal(setField('# head\n', 'yml', 'a', 1), '# head\na: 1\n');
  assert.equal(setField('# one\n# two\n', 'yaml', 'a.b', 1), '# one\n# two\na:\n  b: 1\n');
});

test('filecontent：setField 保留原文 CRLF 行尾（含 BOM 组合）', () => {
  assert.equal(setField('a: 1\r\nb: 2\r\n', 'yml', 'a', 9), 'a: 9\r\nb: 2\r\n');
  assert.equal(setField('{\r\n  "a": 1\r\n}\r\n', 'json', 'a', 2), '{\r\n  "a": 2\r\n}\r\n');
  assert.equal(setField('\uFEFFa: 1\r\n', 'yml', 'a', 2), '\uFEFFa: 2\r\n');
  assert.equal(setField('a: 1\nb: 2\n', 'yml', 'a', 9), 'a: 9\nb: 2\n');
});

test('filecontent：setField 混合行尾按首个换行符判定风格', () => {
  // 首个为 LF：保持 LF（杂散 CRLF 归一化，不整体翻转）
  assert.equal(setField('a: 1\nb: 2\r\nc: 3\n', 'yml', 'a', 9), 'a: 9\nb: 2\nc: 3\n');
  // 首个为 CRLF：输出统一 CRLF
  assert.equal(setField('a: 1\r\nb: 2\n', 'yml', 'a', 9), 'a: 9\r\nb: 2\r\n');
});
