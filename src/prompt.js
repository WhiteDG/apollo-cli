import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';

/**
 * 创建交互式提问器。interactive 创建时求值：stdin/stderr 均为 TTY 且未被
 * CI/APOLLO_NO_PROMPT 禁用才允许交互，避免 agent 在伪终端里挂起等待输入。
 */
export function createPrompter({ input = process.stdin, output = process.stderr, terminal } = {}) {
  const streamsAreTty = !!(input.isTTY && output.isTTY);
  const useTerminal = terminal ?? streamsAreTty;
  return {
    interactive: streamsAreTty && !process.env.CI && !process.env.APOLLO_NO_PROMPT,
    ask: question => ask(question, { input, output, terminal: useTerminal }),
    askHidden: question => askHidden(question, { input, output })
  };
}

function ask(question, { input, output, terminal }) {
  return new Promise(resolve => {
    // readline close 后不可复用，每题新建；输入流提前结束时 close 先于作答触发，须兜底 resolve(null)
    const rl = createInterface({ input, output, terminal });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      if (!rl.closed) rl.close();
      resolve(value);
    };
    rl.once('SIGINT', () => {
      output.write('\n');
      finish(null);
    });
    rl.once('close', () => finish(null));
    rl.question(question, line => finish(line));
  });
}

/**
 * 隐藏输入：在原始模式下自绘，不经过 readline 渲染——提示语始终可见、
 * 输入以 * 反馈（退格可删），避免 readline 私有输出行为随终端/Node 版本
 * 差异导致提示行被擦除或不显示。
 */
function askHidden(question, { input, output }) {
  if (typeof input.setRawMode !== 'function') {
    // 管道/测试流没有原始模式；输入本就不会回显到屏幕，退化为普通行读取
    return ask(question, { input, output, terminal: false });
  }
  return new Promise(resolve => {
    let settled = false;
    let esc = '';
    const chars = [];
    const decoder = new StringDecoder('utf8');
    const finish = value => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode(false);
      input.pause();
      resolve(value);
    };
    const onEnd = () => finish(null);
    const onData = chunk => {
      for (const ch of decoder.write(chunk)) {
        if (esc !== '') {
          // 丢弃方向键等 ESC 序列；异常长序列（>8 字符）放弃丢弃，防止状态卡住
          esc += ch;
          if (/[A-Za-z~]/.test(ch) || esc.length >= 8) esc = '';
          continue;
        }
        if (ch === '\x1b') { esc = ch; continue; }
        if (ch === '\r' || ch === '\n') {
          output.write('\n');
          finish(chars.join(''));
          return;
        }
        if (ch === '\u0003') { // Ctrl+C：按取消处理
          output.write('\n');
          finish(null);
          return;
        }
        if (ch === '\x7f' || ch === '\b') {
          if (chars.length > 0) {
            chars.pop();
            output.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue; // 其余控制字符忽略
        chars.push(ch);
        output.write('*');
      }
    };
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    input.once('end', onEnd);
  });
}
