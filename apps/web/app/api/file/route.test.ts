import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSharedFile = vi.fn();
const getSharedFileById = vi.fn();

vi.mock("@/lib/db/queries/shared-files", () => ({
  createSharedFile: (...args: unknown[]) => createSharedFile(...args),
  getSharedFileById: (...args: unknown[]) => getSharedFileById(...args),
}));

const { POST } = await import("./route");
const { GET } = await import("./[id]/route");

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const VALID_BODY = {
  files: { "main.py": "print('hi')", "helper.py": "X = 1" },
  entryFile: "main.py",
  fontSize: 18,
};

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    files: VALID_BODY.files,
    entryFile: "main.py",
    fontSize: 18,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [new Request(`http://localhost:3000/api/file/${id}`), { params: Promise.resolve({ id }) }];
}

const originalEnv = { ...process.env };

beforeEach(() => {
  createSharedFile.mockReset();
  getSharedFileById.mockReset();
  process.env.APP_URL = "https://snapjaw.test";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/file — saving a project", () => {
  it("stores the project and returns a shareable link", async () => {
    createSharedFile.mockResolvedValue(storedRow());

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(ID);
    expect(body.url).toBe(`https://snapjaw.test/file/${ID}`);
    expect(body.path).toBe(`/file/${ID}`);
    expect(body.entryFile).toBe("main.py");
    expect(body.fontSize).toBe(18);
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.version).toBe("string");
  });

  it("passes exactly the validated project to the query layer", async () => {
    createSharedFile.mockResolvedValue(storedRow());

    await POST(postRequest(VALID_BODY));

    expect(createSharedFile).toHaveBeenCalledWith({
      files: VALID_BODY.files,
      entryFile: "main.py",
      fontSize: 18,
    });
  });

  it("defaults the font size when the client omits it", async () => {
    createSharedFile.mockResolvedValue(storedRow({ fontSize: 14 }));

    await POST(postRequest({ files: { "main.py": "" }, entryFile: "main.py" }));

    expect(createSharedFile).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 14 }));
  });

  it.each([
    [{ files: {}, entryFile: "main.py", fontSize: 14 }, "no files"],
    [{ files: { "a.py": "" }, entryFile: "b.py", fontSize: 14 }, "entry not in files"],
    [{ files: { "../escape.py": "" }, entryFile: "../escape.py", fontSize: 14 }, "traversal"],
    [{ files: { "main.py": "" }, entryFile: "main.py", fontSize: 999 }, "bad font size"],
    ["not json", "malformed json"],
  ])("rejects %j (%s) without touching the database", async (body, _description) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(createSharedFile).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toMatch(/VALIDATION_ERROR|BAD_REQUEST/);
  });

  it("reports a database failure as 500 without leaking detail", async () => {
    createSharedFile.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("connection terminated");
  });
});

describe("GET /api/file/[id] — loading a project", () => {
  it("returns the stored project", async () => {
    getSharedFileById.mockResolvedValue(storedRow());

    const response = await GET(...getRequest(ID));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.files).toEqual(VALID_BODY.files);
    expect(body.entryFile).toBe("main.py");
    expect(body.fontSize).toBe(18);
    expect(body.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 404 for a share that does not exist", async () => {
    getSharedFileById.mockResolvedValue(null);

    const response = await GET(...getRequest(ID));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for a soft-deleted share, because the query filters it out", async () => {
    getSharedFileById.mockResolvedValue(null);

    const response = await GET(...getRequest(ID));

    expect(response.status).toBe(404);
    expect(getSharedFileById).toHaveBeenCalledWith(ID);
  });

  it.each([["not-a-uuid"], ["123"], ["../../etc/passwd"]])(
    "rejects %j as an id without querying",
    async (candidate) => {
      const response = await GET(...getRequest(candidate));

      expect(response.status).toBe(400);
      expect(getSharedFileById).not.toHaveBeenCalled();
      const body = await response.json();
      expect(body.error.code).toBe("BAD_REQUEST");
    },
  );

  it("reports a database failure as 500", async () => {
    getSharedFileById.mockRejectedValue(new Error("boom"));

    const response = await GET(...getRequest(ID));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
