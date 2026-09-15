import { parseAllDocuments, parseDocument, stringify as yamlStringify, isCollection, isMap, isSeq } from 'yaml';

export const CONTENT_KEY = 'content';

const FILE_FORMATS = new Set(['yml', 'yaml', 'json']);

export function normalizeFormat(format) {
  return typeof format === 'string' ? format.trim().toLowerCase() : '';
}

export function isFileFormat(format) {
  return FILE_FORMATS.has(normalizeFormat(format));
}

/** 空命名空间或恰有单个 content 条目时才能确定是文件型还是 properties，需要额外查格式 */
export function isAmbiguousNamespaceItems(items) {
  if (!Array.isArray(items)) return false;
  if (items.length === 0) return true;
  return items.length === 1 && items[0]?.key === CONTENT_KEY;
}

export function pickNamespaceFormat(nsList, nsName) {
  if (!Array.isArray(nsList)) return null;
  for (const ns of nsList) {
    const name = ns?.baseInfo?.namespaceName || ns?.namespaceName;
    if (name === nsName) return normalizeFormat(ns?.format) || null;
  }
  return null;
}

export function parseFieldPath(path) {
  const text = String(path ?? '').trim();
  const invalid = reason => new Error(`字段路径无效: "${path}"（用法: a.b[0].c${reason ? `；${reason}` : ''}）`);
  if (!text) throw invalid('路径为空');

  const segments = [];
  let i = 0;
  let needSegment = true;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      if (needSegment) throw invalid('出现空段');
      needSegment = true;
      i++;
      continue;
    }
    if (ch === '[') {
      if (needSegment && segments.length > 0) throw invalid('"." 后不能直接跟 "["');
      const end = text.indexOf(']', i + 1);
      if (end === -1) throw invalid('缺少 "]"');
      const inner = text.slice(i + 1, end);
      if (!/^\d+$/.test(inner)) throw invalid(`非法下标 "[${inner}]"`);
      segments.push(Number(inner));
      i = end + 1;
      needSegment = false;
      const next = text[i];
      if (next !== undefined && next !== '.' && next !== '[') throw invalid(`下标后不能跟 "${next}"`);
      continue;
    }
    if (ch === ']') throw invalid('多余的 "]"');
    let j = i;
    while (j < text.length && text[j] !== '.' && text[j] !== '[' && text[j] !== ']') j++;
    segments.push(text.slice(i, j));
    i = j;
    needSegment = false;
  }
  if (needSegment) throw invalid('以 "." 结尾');
  return segments;
}

export function parseFieldValue(raw, opts = {}) {
  if (opts.string) return raw;
  if (raw === '') return '';
  // 多行内容按原样字符串处理（避免 YAML 折叠语义）
  if (raw.includes('\n') || raw.includes('\r')) return raw;

  const doc = parseDocument(raw, { logLevel: 'silent' });
  if (doc.errors.length > 0 || doc.warnings.length > 0 || doc.contents === null) {
    if (raw[0] === '{' || raw[0] === '[') {
      const detail = doc.errors[0] ? firstLine(doc.errors[0].message) : '无法解析为 YAML 结构';
      throw new Error(`值解析失败: ${detail}（如需按字符串写入请加 --string）`);
    }
    return raw;
  }
  try {
    return doc.toJS();
  } catch {
    return raw;
  }
}

export function getField(content, format, path) {
  const fmt = normalizeFormat(format);
  const segments = Array.isArray(path) ? path : parseFieldPath(path);
  const pathLabel = Array.isArray(path) ? label(path) : String(path);
  const root = fmt === 'json' ? parseJsonValue(content, fmt) : yamlPlainValue(parseYamlDoc(content, fmt), fmt);
  return walkPlain(root, segments, pathLabel);
}

export function setField(content, format, path, value) {
  const fmt = normalizeFormat(format);
  const segments = Array.isArray(path) ? path : parseFieldPath(path);
  const pathLabel = Array.isArray(path) ? label(path) : String(path);
  const text = String(content ?? '');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  // 按首个换行符判定行尾风格，避免混合行尾文件（主体 LF + 杂散 CRLF）被整体翻转
  const crlf = /\r?\n/.exec(text)?.[0] === '\r\n';

  let out;
  if (fmt === 'json') {
    // __proto__ 赋值会触发原型 setter 而非自有属性，序列化后静默丢失
    if (segments.includes('__proto__')) {
      throw new Error(`字段路径 "${pathLabel}" 包含不支持写入的键 "__proto__"（JSON 序列化会静默丢失）`);
    }
    const root = parseJsonValue(text, fmt);
    out = renderJson(setPlain(root, segments, value, pathLabel), text);
  } else {
    const doc = parseYamlDoc(text, fmt);
    setYamlValue(doc, segments, value, pathLabel);
    out = doc.toString();
  }
  return bom + (crlf ? out.replace(/\n/g, '\r\n') : out);
}

export function renderFieldValue(value, format, opts = {}) {
  if (opts.json) return JSON.stringify(value, null, 2) + '\n';
  if (value === null || typeof value !== 'object') return `${value}\n`;
  if (normalizeFormat(format) === 'json') return JSON.stringify(value, null, 2) + '\n';
  return yamlStringify(value);
}

// ---- 内部实现 ----

function firstLine(text) {
  return String(text ?? '').split('\n')[0];
}

function label(segments) {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? seg : `.${seg}`;
  }
  return out;
}

function parseYamlDoc(content, format) {
  const fmt = normalizeFormat(format) || 'yaml';
  const text = String(content ?? '').replace(/^\uFEFF/, '');
  // parseDocument 对多文档输入只会解析第一份且不报错，写回会静默丢内容，必须显式拦截
  const docs = parseAllDocuments(text, { logLevel: 'silent' });
  if (docs.length > 1) {
    throw new Error(`内容解析失败（格式 ${fmt}）: 不支持多文档（---）`);
  }
  // 无文档（空/纯注释内容）时用 parseDocument 兜底，以保留纯注释文档的 commentBefore
  const doc = docs[0] ?? parseDocument(text, { logLevel: 'silent' });
  if (doc.errors.length > 0) {
    throw new Error(`内容解析失败（格式 ${fmt}）: ${firstLine(doc.errors[0].message)}`);
  }
  return doc;
}

function yamlPlainValue(doc, format) {
  if (doc.contents === null) return null;
  try {
    return doc.toJS();
  } catch (e) {
    throw new Error(`内容解析失败（格式 ${normalizeFormat(format) || 'yaml'}）: ${firstLine(e.message)}`);
  }
}

function parseJsonValue(content, format) {
  const text = String(content ?? '').replace(/^\uFEFF/, '').trim();
  // 空内容视为 null（与 YAML 一致）：根节点整体新建时不预设对象形态
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`内容解析失败（格式 ${normalizeFormat(format) || 'json'}）: ${firstLine(e.message)}`);
  }
}

function renderJson(value, originalText) {
  const text = String(originalText ?? '').replace(/^\uFEFF/, '');
  if (text.trim() === '') return JSON.stringify(value, null, 2) + '\n';
  // 仅尾部换行（编辑器自动补的 final newline）不算多行，仍按紧凑输出
  if (!text.trimEnd().includes('\n')) return JSON.stringify(value) + (text.endsWith('\n') ? '\n' : '');
  const indent = text.match(/^[ \t]+/m)?.[0] ?? 2;
  const out = JSON.stringify(value, null, indent);
  return text.endsWith('\n') ? out + '\n' : out;
}

function walkPlain(root, segments, pathLabel) {
  const at = trail => (trail.length ? `路径段 "${label(trail)}" ` : '根节点');
  let node = root;
  const trail = [];
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(node)) {
        if (node === null || node === undefined) return { found: false };
        if (typeof node === 'object') {
          throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是对象，不能使用下标`);
        }
        throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}不是对象或数组`);
      }
      if (seg >= node.length) return { found: false };
      node = node[seg];
    } else {
      if (Array.isArray(node)) {
        const hint = trail.length ? `"${label(trail)}[0]"` : '"[0]"';
        throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是数组，请使用下标（如 ${hint}）`);
      }
      if (node === null || node === undefined) return { found: false };
      if (typeof node !== 'object') {
        throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}不是对象或数组`);
      }
      if (!Object.hasOwn(node, seg)) return { found: false };
      node = node[seg];
    }
    trail.push(seg);
  }
  return { found: true, value: node };
}

function buildSubtree(segments, value, pathLabel, prefix) {
  let node = value;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (typeof seg === 'number') {
      if (seg !== 0) {
        const arrayPath = label(prefix.concat(segments.slice(0, i + 1)));
        throw new Error(`无法创建数组 "${arrayPath}": 起始下标必须为 0（收到 ${seg}）`);
      }
      node = [node];
    } else {
      node = { [seg]: node };
    }
  }
  return node;
}

/** JSON：直接在纯值上修改（JSON.parse 产物是独立对象，无共享状态） */
function setPlain(root, segments, value, pathLabel) {
  const at = trail => (trail.length ? `路径段 "${label(trail)}" ` : '根节点');
  if (root === null || root === undefined) return buildSubtree(segments, value, pathLabel, []);

  let node = root;
  const trail = [];
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const last = k === segments.length - 1;

    if (typeof seg === 'number') {
      if (!Array.isArray(node)) {
        if (typeof node === 'object' && node !== null) {
          throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是对象，不能使用下标`);
        }
        throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}不是对象或数组`);
      }
      const len = node.length;
      if (seg > len) throw new Error(`数组下标越界: "${label(trail.concat(seg))}"（当前长度 ${len}）`);
      if (seg === len) {
        node.push(last ? value : buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg)));
        return root;
      }
      if (last) {
        node[seg] = value;
        return root;
      }
      const child = node[seg];
      if (child !== null && typeof child === 'object') {
        trail.push(seg);
        node = child;
        continue;
      }
      if (child === null || child === undefined) {
        node[seg] = buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg));
        return root;
      }
      throw new Error(`字段路径 "${pathLabel}" 无法解析: 路径段 "${label(trail.concat(seg))}" 不是对象或数组`);
    }

    if (Array.isArray(node)) {
      const hint = trail.length ? `"${label(trail)}[0]"` : '"[0]"';
      throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是数组，请使用下标（如 ${hint}）`);
    }
    if (node === null || typeof node !== 'object') {
      throw new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}不是对象或数组`);
    }
    if (last) {
      node[seg] = value;
      return root;
    }
    if (!Object.hasOwn(node, seg)) {
      node[seg] = buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg));
      return root;
    }
    const child = node[seg];
    if (child !== null && typeof child === 'object') {
      trail.push(seg);
      node = child;
      continue;
    }
    if (child === null || child === undefined) {
      node[seg] = buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg));
      return root;
    }
    throw new Error(`字段路径 "${pathLabel}" 无法解析: 路径段 "${label(trail.concat(seg))}" 不是对象或数组`);
  }
  return root;
}

/**
 * YAML：在 Document 节点树上做编辑。叶子替换传裸 JS 值——库对"标量→标量"
 * 会原地改值从而保留行内/前导注释与引号风格；传 Node 会丢注释。
 */
function setYamlValue(doc, segments, value, pathLabel) {
  const at = trail => (trail.length ? `路径段 "${label(trail)}" ` : '根节点');
  const needIndex = trail => {
    const hint = trail.length ? `"${label(trail)}[0]"` : '"[0]"';
    return new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是数组，请使用下标（如 ${hint}）`);
  };
  const noIndex = trail => new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}是对象，不能使用下标`);
  const notContainer = trail => new Error(`字段路径 "${pathLabel}" 无法解析: ${at(trail)}不是对象或数组`);

  if (doc.contents === null) {
    const node = doc.createNode(buildSubtree(segments, value, pathLabel, []));
    // 纯注释文档：注释挂在 Document 上，转移到内容节点以免丢失
    if (doc.commentBefore) {
      node.commentBefore = doc.commentBefore;
      doc.commentBefore = null;
    }
    doc.contents = node;
    return;
  }

  let node = doc.contents;
  const trail = [];
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const last = k === segments.length - 1;

    if (typeof seg === 'number') {
      if (!isSeq(node)) {
        if (isMap(node)) throw noIndex(trail);
        throw notContainer(trail);
      }
      const len = node.items.length;
      if (seg > len) throw new Error(`数组下标越界: "${label(trail.concat(seg))}"（当前长度 ${len}）`);
      if (seg === len) {
        node.set(seg, last ? value : buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg)));
        return;
      }
      if (last) {
        node.set(seg, value);
        return;
      }
      const child = node.items[seg];
      if (isCollection(child)) {
        trail.push(seg);
        node = child;
        continue;
      }
      if (child === null || child === undefined) {
        node.set(seg, buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg)));
        return;
      }
      throw notContainer(trail.concat(seg));
    }

    if (isSeq(node)) throw needIndex(trail);
    if (!isMap(node)) throw notContainer(trail);
    if (last) {
      node.set(seg, value);
      return;
    }
    if (!node.has(seg)) {
      node.set(seg, buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg)));
      return;
    }
    const child = node.get(seg, true);
    if (isCollection(child)) {
      trail.push(seg);
      node = child;
      continue;
    }
    if (child === null || child === undefined) {
      node.set(seg, buildSubtree(segments.slice(k + 1), value, pathLabel, trail.concat(seg)));
      return;
    }
    throw notContainer(trail.concat(seg));
  }
}
