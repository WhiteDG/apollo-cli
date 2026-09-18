#!/usr/bin/env node
import { run } from '../src/cli.js';

// 不用顶层 await：CJS 打包产物不支持，且 run() 内部已捕获全部错误
run();
