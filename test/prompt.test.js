import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPrompter } from '../src/prompt.js';
import { setEnv } from './helpers.js';

function fakeStreams({ isTTY = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  if (isTTY) {
    input.isTTY = true;
    output.isTTY = true;
  }
  return { input, output };
}

test('prompt：非 TTY 流交互门禁关闭', () => {
  const { input, output } = fakeStreams();
  assert.equal(createPrompter({ input, output }).interactive, false);
});

test('prompt：TTY 流门禁开启，CI / APOLLO_NO_PROMPT 压制', () => {
  const { input, output } = fakeStreams({ isTTY: true });
  const restoreBase = setEnv({ CI: undefined, APOLLO_NO_PROMPT: undefined });
  try {
    assert.equal(createPrompter({ input, output }).interactive, true);

    const restoreCi = setEnv({ CI: '1' });
    assert.equal(createPrompter({ input, output }).interactive, false);
    restoreCi();

    const restoreNoPrompt = setEnv({ APOLLO_NO_PROMPT: '1' });
    assert.equal(createPrompter({ input, output }).interactive, false);
    restoreNoPrompt();
  } finally {
    restoreBase();
  }
});

test('prompt：ask 返回整行输入', async () => {
  const { input, output } = fakeStreams();
  const prompter = createPrompter({ input, output });
  const answer = prompter.ask('名字: ');
  input.write('fat\n');
  assert.equal(await answer, 'fat');
});

function fakeTtyInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  return input;
}

test('prompt：askHidden 提示常显、输入以星号反馈且不含明文', async () => {
  const input = fakeTtyInput();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk.toString()));
  const prompter = createPrompter({ input, output, terminal: true });
  const answer = prompter.askHidden('密码: ');
  input.write('s3cret\r');
  assert.equal(await answer, 's3cret');
  const text = chunks.join('');
  assert.match(text, /密码: /, '提示语必须可见');
  assert.equal(text.includes('s3cret'), false, `输出不应包含明文输入，实际: ${JSON.stringify(text)}`);
  assert.equal((text.match(/\*/g) || []).length, 6, '每个字符应回显一个星号');
});

test('prompt：askHidden 退格删除与 ESC 序列不污染输入', async () => {
  const input = fakeTtyInput();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk.toString()));
  const prompter = createPrompter({ input, output, terminal: true });
  const answer = prompter.askHidden('密码: ');
  input.write('ab\x7fc');
  input.write('\x1b[D'); // 左方向键：应被丢弃
  input.write('\r');
  assert.equal(await answer, 'ac');
  const text = chunks.join('');
  assert.ok(text.includes('**\b \b*'), `退格应回显删除，实际: ${JSON.stringify(text)}`);
});

test('prompt：askHidden Ctrl+C 取消返回 null', async () => {
  const input = fakeTtyInput();
  const output = new PassThrough();
  const prompter = createPrompter({ input, output, terminal: true });
  const answer = prompter.askHidden('密码: ');
  input.write('abc\x03');
  assert.equal(await answer, null);
});

test('prompt：askHidden 输入流结束返回 null（不挂起）', async () => {
  const input = fakeTtyInput();
  const output = new PassThrough();
  const prompter = createPrompter({ input, output, terminal: true });
  const answer = prompter.askHidden('密码: ');
  input.end();
  assert.equal(await answer, null);
});

test('prompt：askHidden 无 setRawMode 的流退化为普通行读取', async () => {
  const { input, output } = fakeStreams();
  const prompter = createPrompter({ input, output, terminal: true });
  const answer = prompter.askHidden('密码: ');
  input.write('secret\n');
  assert.equal(await answer, 'secret');
});

test('prompt：输入流结束未作答时返回 null（不挂起）', async () => {
  const { input, output } = fakeStreams();
  const prompter = createPrompter({ input, output });
  const answer = prompter.ask('名字: ');
  input.end();
  assert.equal(await answer, null);
});
