import { describe, expect, it } from "vitest";

import { createZip, projectZip } from "./zip";

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

describe("createZip", () => {
  it("writes the expected signatures", () => {
    const zip = createZip([{ name: "main.py", content: "print(1)" }]);

    expect(readUint32(zip, 0)).toBe(SIGNATURE_LOCAL);
    expect(readUint32(zip, zip.length - 22)).toBe(SIGNATURE_END);
  });

  it("records the entry count in the end-of-central-directory record", () => {
    const zip = createZip([
      { name: "a.py", content: "A" },
      { name: "b.py", content: "B" },
    ]);

    const end = zip.length - 22;
    expect(readUint16(zip, end + 8)).toBe(2);
    expect(readUint16(zip, end + 10)).toBe(2);
    expect(readUint32(zip, end + 0)).toBe(SIGNATURE_END);
  });

  it("embeds each file name", () => {
    const zip = createZip([{ name: "main.py", content: "print(1)" }]);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("main.py");
    expect(text).toContain("print(1)");
  });

  it("starts the central directory where the local data ends", () => {
    const zip = createZip([{ name: "main.py", content: "print(1)" }]);
    const end = zip.length - 22;
    const centralOffset = readUint32(zip, end + 16);
    expect(readUint32(zip, centralOffset)).toBe(SIGNATURE_CENTRAL);
  });
});

describe("projectZip", () => {
  it("nests every file under the project folder", () => {
    const zip = projectZip("snapjaw-project", [
      { name: "main.py", content: "" },
      { name: "helper.py", content: "" },
    ]);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("snapjaw-project/main.py");
    expect(text).toContain("snapjaw-project/helper.py");
  });

  it("does not double up the separator", () => {
    const zip = projectZip("snapjaw-project/", [{ name: "main.py", content: "" }]);
    expect(new TextDecoder().decode(zip)).not.toContain("snapjaw-project//");
  });
});
