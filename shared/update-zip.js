'use strict';

const {FILES} = require('./update-format');
// Parse the central directory before inflating anything. No archive paths reach the filesystem.
function unpackZip(input, inflate) {
  const zip = Buffer.from(input), limit = 32 * 1024 * 1024;
  if (zip.length > limit || zip.length < 22) throw new Error('ZIP 大小异常');
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== 3 || zip.readUInt16LE(end + 10) !== 3) throw new Error('ZIP 目录异常');
  let cursor = zip.readUInt32LE(end + 16), total = 0;
  const centralEnd = cursor + zip.readUInt32LE(end + 12), centralStart = cursor, entries = [], names = new Set();
  if (centralEnd !== end) throw new Error('ZIP 目录范围异常');
  for (let i = 0; i < 3; i++) {
    if (cursor + 46 > centralEnd || zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 条目异常');
    const flags = zip.readUInt16LE(cursor + 8), method = zip.readUInt16LE(cursor + 10), crc = zip.readUInt32LE(cursor + 16);
    const compressed = zip.readUInt32LE(cursor + 20), size = zip.readUInt32LE(cursor + 24), length = zip.readUInt16LE(cursor + 28);
    const next = cursor + 46 + length + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
    const name = zip.subarray(cursor + 46, cursor + 46 + length).toString('utf8'), mode = zip.readUInt32LE(cursor + 38) >>> 16;
    if (next > centralEnd || !FILES.includes(name) || names.has(name) || (flags & ~0x808) || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000 || zip.readUInt16LE(cursor + 34)) throw new Error('ZIP 包含不支持的文件或格式');
    total += size;
    if (size <= 0 || total > limit) throw new Error('ZIP 解压大小异常');
    names.add(name); entries.push({name, flags, method, crc, compressed, size, offset: zip.readUInt32LE(cursor + 42)}); cursor = next;
  }
  if (cursor !== centralEnd) throw new Error('ZIP 目录长度异常');
  const result = {}, ranges = [];
  for (const e of entries) {
    const p = e.offset;
    if (p + 30 > centralStart || zip.readUInt32LE(p) !== 0x04034b50 || zip.readUInt16LE(p + 6) !== e.flags || zip.readUInt16LE(p + 8) !== e.method) throw new Error('ZIP 本地条目异常');
    const n = zip.readUInt16LE(p + 26), from = p + 30 + n + zip.readUInt16LE(p + 28), to = from + e.compressed;
    if (to > centralStart || zip.subarray(p + 30, p + 30 + n).toString('utf8') !== e.name || ranges.some(([a,b]) => p < b && to > a)) throw new Error('ZIP 文件范围异常');
    ranges.push([p,to]);
    const bytes = e.method === 0 ? Buffer.from(zip.subarray(from, to)) : inflate(zip.subarray(from, to), {maxOutputLength: e.size});
    if (bytes.length !== e.size || crc32(bytes) !== e.crc) throw new Error('ZIP 文件校验失败');
    result[e.name] = bytes;
  }
  return result;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
module.exports = {unpackZip, crc32};
