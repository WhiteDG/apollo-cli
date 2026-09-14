import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table, output } from '../src/output.js';
import { withOutput } from './helpers.js';

test('table：空数组返回空串', () => {
  assert.equal(table([]), '');
});

test('table：CJK 双宽对齐 golden', () => {
  // '中' 计 2 宽：a 列被撑到宽 2，分隔线共 5 个 ─
  assert.equal(table([{ a: '中', b: 1 }]), 'a   b\n─────\n中  1');
});

test('table：null/undefined 单元格兜底为空串', () => {
  // 空单元格仍补足到列宽（各 1 空格）
  assert.equal(table([{ a: null, b: undefined }]), 'a  b\n────\n    ');
});

test('table：数字/布尔经 String 化并参与列宽', () => {
  assert.equal(table([{ n: 42, f: true }]), 'n   f   \n────────\n42  true');
});

test('table：全角标点计 2 宽', () => {
  // '：' 落在 \\uff00-\\uffef 区间
  assert.equal(table([{ k: '：' }]), 'k \n──\n：');
});

test('table：值比表头窄时右侧补空格', () => {
  assert.equal(table([{ key: 'x' }]), 'key\n───\nx  ');
});

test('table：多行 CJK 混合列宽对齐', () => {
  assert.equal(
    table([
      { 名字: '张三', age: 30 },
      { 名字: '李四', age: 5 }
    ]),
    '名字  age\n─────────\n张三  30 \n李四  5  '
  );
});

test('table：emoji 按 1 宽计算（当前行为，锁定现状）', () => {
  assert.equal(table([{ a: '😀' }]), 'a\n─\n😀');
});

test('output：json 分支输出 2 空格缩进 JSON（中文不转义）', async () => {
  const { stdout, stderrChunks } = await withOutput(() => output([{ 名称: '张三' }], { json: true }));
  assert.equal(stdout, '[\n  {\n    "名称": "张三"\n  }\n]\n');
  assert.equal(stderrChunks.length, 0);
});

test('output：json 分支非数组直接序列化', async () => {
  const { stdout } = await withOutput(() => output({ a: 1 }, { json: true }));
  assert.equal(stdout, '{\n  "a": 1\n}\n');
});

test('output：json 分支空数组', async () => {
  const { stdout } = await withOutput(() => output([], { json: true }));
  assert.equal(stdout, '[]\n');
});

test('output：空数组输出 (空)', async () => {
  const { stdout } = await withOutput(() => output([]));
  assert.equal(stdout, '(空)\n');
});

test('output：数组走表格并追加换行', async () => {
  const { stdout, stdoutChunks } = await withOutput(() => output([{ a: 1 }]));
  assert.equal(stdout, 'a\n─\n1\n');
  assert.equal(stdoutChunks.length, 1);
});

test('output：非数组包成单行表', async () => {
  const { stdout } = await withOutput(() => output({ a: 1 }));
  assert.equal(stdout, 'a\n─\n1\n');
});
