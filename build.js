#!/usr/bin/env node
// Builds zip packages for Firefox and Chrome extension stores.
// Usage: node build.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Minimal ZIP file creator (no dependencies)
function createZip(dir) {
  const files = [];
  function walk(d, prefix) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(d, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        files.push({ name: rel, data: fs.readFileSync(full) });
      }
    }
  }
  walk(dir, "");

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name);
    const compressed = zlib.deflateRawSync(file.data);
    const crc = crc32(file.data);

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // compression: deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    parts.push(local, nameBytes, compressed);

    // Central directory entry
    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0);
    cdir.writeUInt16LE(20, 4);
    cdir.writeUInt16LE(20, 6);
    cdir.writeUInt16LE(8, 10);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(compressed.length, 20);
    cdir.writeUInt32LE(file.data.length, 24);
    cdir.writeUInt16LE(nameBytes.length, 28);
    cdir.writeUInt32LE(offset, 42);
    central.push(cdir, nameBytes);

    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const b of central) centralSize += b.length;

  // End of central directory
  const eocdr = Buffer.alloc(22);
  eocdr.writeUInt32LE(0x06054b50, 0);
  eocdr.writeUInt16LE(files.length, 8);
  eocdr.writeUInt16LE(files.length, 10);
  eocdr.writeUInt32LE(centralSize, 12);
  eocdr.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...parts, ...central, eocdr]);
}

function crc32(buf) {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Read version from Firefox manifest
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "firefox", "manifest.json"), "utf8"));
const version = manifest.version;

fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });

for (const target of ["firefox", "chrome"]) {
  const dir = path.join(__dirname, target);
  const zip = createZip(dir);
  const out = path.join(__dirname, "dist", `geospoof-${target}-${version}.zip`);
  fs.writeFileSync(out, zip);
  console.log(`Created ${out} (${(zip.length / 1024).toFixed(1)} KB)`);
}
