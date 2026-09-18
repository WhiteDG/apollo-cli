import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../bin/apollo-cli.js', import.meta.url));
const outfile = fileURLToPath(new URL('../skills/apollo/scripts/apollo-cli.cjs', import.meta.url));

// 输出 CJS 且用 .cjs 扩展名：拷贝到任意目录均可直接 node 运行，不依赖所在位置的 package.json
const options = {
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node21'
};

// Windows（core.autocrlf=true）检出会把产物转成 CRLF，比较前统一为 LF
const normalize = text => text.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
  const { outputFiles } = await build({ ...options, write: false });
  const fresh = normalize(outputFiles[0].text);
  const onDisk = existsSync(outfile) ? normalize(readFileSync(outfile, 'utf8')) : null;
  if (onDisk === fresh) {
    process.stdout.write('产物已是最新: skills/apollo/scripts/apollo-cli.cjs\n');
  } else {
    process.stderr.write(`${onDisk === null ? '缺少' : '已过期'}: skills/apollo/scripts/apollo-cli.cjs，请运行 pnpm build 并提交该产物\n`);
    process.exitCode = 1;
  }
} else {
  await build({ ...options, outfile });
  process.stdout.write('已生成: skills/apollo/scripts/apollo-cli.cjs\n');
}
