import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/dotenv.js';
import { setEnv } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'apollo-cli-dotenv-'));
let seq = 0;

function fixture(text) {
  const file = join(dir, `env-${++seq}.env`);
  writeFileSync(file, text, 'utf8');
  return file;
}

function scopedEnv(keys, fn) {
  const restore = setEnv(Object.fromEntries(keys.map(key => [key, undefined])));
  try {
    return fn();
  } finally {
    restore();
  }
}

after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));

test('dotenv：文件不存在时不抛且不设置任何变量', () => {
  const before = new Set(Object.keys(process.env));
  assert.doesNotThrow(() => loadDotEnv(join(dir, 'nope.env')));
  const added = Object.keys(process.env).filter(key => !before.has(key));
  assert.deepEqual(added, []);
});

test('dotenv：解析 KEY=VAL 且值内的 = 保留', () => {
  scopedEnv(['DOTENV_T1_A', 'DOTENV_T1_B'], () => {
    loadDotEnv(fixture('DOTENV_T1_A=1\nDOTENV_T1_B=a=b\n'));
    assert.equal(process.env.DOTENV_T1_A, '1');
    assert.equal(process.env.DOTENV_T1_B, 'a=b');
  });
});

test('dotenv：跳过空行、整行注释与无等号的行', () => {
  scopedEnv(['DOTENV_T2_A'], () => {
    loadDotEnv(fixture('# 注释\n\n   \nJUST_A_WORD\nDOTENV_T2_A=v\n'));
    assert.equal(process.env.DOTENV_T2_A, 'v');
    assert.equal(Object.hasOwn(process.env, 'JUST_A_WORD'), false);
  });
});

test('dotenv：剥离 export 前缀', () => {
  scopedEnv(['DOTENV_T3_A'], () => {
    loadDotEnv(fixture('export DOTENV_T3_A=1\n'));
    assert.equal(process.env.DOTENV_T3_A, '1');
  });
});

test('dotenv：成对引号剥一层，非成对保留原样', () => {
  scopedEnv(['DOTENV_T4_A', 'DOTENV_T4_B', 'DOTENV_T4_C', 'DOTENV_T4_D', 'DOTENV_T4_E'], () => {
    loadDotEnv(
      fixture(
        'DOTENV_T4_A="quoted"\nDOTENV_T4_B=\'single\'\nDOTENV_T4_C="only-open\nDOTENV_T4_D=\'\'\nDOTENV_T4_E=x"y"\n'
      )
    );
    assert.equal(process.env.DOTENV_T4_A, 'quoted');
    assert.equal(process.env.DOTENV_T4_B, 'single');
    assert.equal(process.env.DOTENV_T4_C, '"only-open');
    assert.equal(process.env.DOTENV_T4_D, '');
    assert.equal(process.env.DOTENV_T4_E, 'x"y"');
  });
});

test('dotenv：键名与值均 trim', () => {
  scopedEnv(['DOTENV_T5_A'], () => {
    loadDotEnv(fixture('  DOTENV_T5_A  =  v  \n'));
    assert.equal(process.env.DOTENV_T5_A, 'v');
  });
});

test('dotenv：CRLF 行尾正常解析', () => {
  scopedEnv(['DOTENV_T6_A', 'DOTENV_T6_B'], () => {
    loadDotEnv(fixture('DOTENV_T6_A=1\r\nDOTENV_T6_B=2\r\n'));
    assert.equal(process.env.DOTENV_T6_A, '1');
    assert.equal(process.env.DOTENV_T6_B, '2');
  });
});

test('dotenv：已存在的环境变量不被文件覆盖', () => {
  scopedEnv(['DOTENV_T7_A'], () => {
    const restore = setEnv({ DOTENV_T7_A: 'shell' });
    try {
      loadDotEnv(fixture('DOTENV_T7_A=file\n'));
      assert.equal(process.env.DOTENV_T7_A, 'shell');
    } finally {
      restore();
    }
  });
});

test('dotenv：首行 BOM 被 trim 顺带剥离，键名不含 BOM', () => {
  // \uFEFF 属于 ECMAScript WhiteSpace，trim() 会去掉
  scopedEnv(['DOTENV_T8_A'], () => {
    loadDotEnv(fixture('\uFEFFDOTENV_T8_A=1\n'));
    assert.equal(process.env.DOTENV_T8_A, '1');
  });
});
