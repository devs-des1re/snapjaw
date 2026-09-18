import type { ProjectFile } from "@/lib/project";

// A minimal store-only (no compression) zip writer. Files here are small text, so
// deflate would add a dependency for no meaningful gain.

export interface ZipEntry {
  name: string;
  content: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, dataBytes.length);
    writeUint32(localView, 22, dataBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    local.set(nameBytes, 30);

    chunks.push(local, dataBytes);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    writeUint32(headerView, 0, 0x02014b50);
    writeUint16(headerView, 4, 20);
    writeUint16(headerView, 6, 20);
    writeUint16(headerView, 8, 0x0800);
    writeUint16(headerView, 10, 0);
    writeUint16(headerView, 12, 0);
    writeUint16(headerView, 14, 0);
    writeUint32(headerView, 16, crc);
    writeUint32(headerView, 20, dataBytes.length);
    writeUint32(headerView, 24, dataBytes.length);
    writeUint16(headerView, 28, nameBytes.length);
    writeUint16(headerView, 30, 0);
    writeUint16(headerView, 32, 0);
    writeUint16(headerView, 34, 0);
    writeUint16(headerView, 36, 0);
    writeUint32(headerView, 38, 0);
    writeUint32(headerView, 42, offset);
    header.set(nameBytes, 46);
    central.push(header);

    offset += local.length + dataBytes.length;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralBytes.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concat([...chunks, centralBytes, end]);
}

export function projectZip(
  projectName: string,
  files: readonly ProjectFile[],
): Uint8Array<ArrayBuffer> {
  const prefix = projectName.endsWith("/") ? projectName : `${projectName}/`;
  return createZip(files.map((file) => ({ name: `${prefix}${file.name}`, content: file.content })));
}
