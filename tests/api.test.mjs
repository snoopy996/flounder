import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startUiServer } from "../dist/server/app.js";

// The whole workflow is a REST API an agent can self-learn (GET /api) and drive without
// the UI. This pins the catalog + a project CRUD round-trip over real HTTP.

async function withServer(fn) {
  const out = await mkdtemp(path.join(os.tmpdir(), "flounder-api-"));
  const server = startUiServer({ port: 0, out, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("api: GET /api is a self-describing catalog of every resource + operation", async () => {
  await withServer(async (base) => {
    const cat = await (await fetch(base + "/api")).json();
    assert.deepEqual(cat.resources, ["project", "provider", "run", "scope", "finding", "confirm-decision"]);
    const sigs = cat.endpoints.map((e) => e.method + " " + e.path);
    for (const expected of [
      "GET /api/projects", "POST /api/projects", "GET /api/projects/:uuid",
      "PATCH /api/projects/:uuid", "DELETE /api/projects/:uuid",
      "POST /api/projects/:uuid/runs", "GET /api/projects/:uuid/findings",
      "GET /api/projects/:uuid/scopes", "GET /api/projects/:uuid/confirm-decisions",
      "GET /api/providers", "POST /api/providers", "GET /api/providers/:id",
      "PATCH /api/providers/:id", "DELETE /api/providers/:id",
      "GET /api/runs/:id", "POST /api/runs/:id/stop",
    ]) assert.ok(sigs.includes(expected), `catalog missing ${expected}`);
    // every endpoint documents a summary so an agent can learn it
    assert.ok(cat.endpoints.every((e) => typeof e.summary === "string" && e.summary.length > 0));
  });
});

test("api: project CRUD round-trip over HTTP", async () => {
  await withServer(async (base) => {
    const json = (r) => r.json();
    const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    assert.deepEqual((await json(await fetch(base + "/api/projects"))).projects, []);

    const created = await json(await post("/api/projects", { name: "项目一", sourcePaths: ["./s"], config: { model: "gpt-5.5" } }));
    assert.equal(created.ok, true);
    assert.match(created.uuid, /^[0-9a-f-]{36}$/);
    const projectPath = "/api/projects/" + created.uuid;
    assert.equal((await post("/api/projects", { name: "项目一" })).status, 409); // duplicate rejected
    assert.equal((await fetch(base + "/api/projects/" + encodeURIComponent("项目一"))).status, 404); // URLs are UUID-only

    const detail = await json(await fetch(base + projectPath));
    assert.equal(detail.project.name, "项目一");
    assert.equal(detail.project.uuid, created.uuid);
    assert.equal(detail.findingsTotal, 0);
    assert.deepEqual(detail.progress, { total: 0, audited: 0, pending: 0, deferred: 0 });
    assert.deepEqual(detail.scopes, []);
    assert.deepEqual(detail.allFindings, []);

    await fetch(base + projectPath, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { model: "opus" } }) });
    assert.equal(JSON.parse((await json(await fetch(base + projectPath))).project.config_json).model, "opus");

    assert.deepEqual((await json(await fetch(base + projectPath + "/findings"))).findings, []);
    assert.equal((await fetch(base + projectPath, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(base + projectPath)).status, 404);
  });
});

test("api: provider profiles — seed + CRUD + per-phase roles; pi discovery", async () => {
  await withServer(async (base) => {
    const json = (r) => r.json();
    const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    // a fresh store is seeded with starter profiles
    const seeded = (await json(await fetch(base + "/api/providers"))).providers;
    assert.ok(seeded.length >= 1 && seeded.some((p) => p.provider === "openai-codex"), "expected seeded providers");

    // discovery: pi-ai's provider list (+ CLI fallbacks) and a provider's models
    const avail = (await json(await fetch(base + "/api/pi/providers"))).providers;
    assert.ok(avail.includes("openai-codex") && avail.includes("claude-code") && avail.includes("mock"));
    const discoveredModels = (await json(await fetch(base + "/api/pi/models/openai-codex"))).models;
    assert.ok(discoveredModels.length >= 1, "expected pi model discovery");
    assert.ok(discoveredModels.every((m) => Array.isArray(m.thinkingLevels) && m.thinkingLevels.length >= 1));
    const gpt55 = discoveredModels.find((m) => m.id === "gpt-5.5");
    if (gpt55) assert.ok(gpt55.thinkingLevels.includes("xhigh"), "gpt-5.5 should expose xhigh through pi metadata");

    // create with a per-phase override (map cheaper than dig), then read it back
    const created = await json(await post("/api/providers", { name: "prof-x", provider: "openai-codex", model: "gpt-5.5", thinking: "high", roles: { map: { thinking: "low" } } }));
    assert.ok(created.ok && typeof created.id === "number");
    assert.equal((await post("/api/providers", { name: "prof-x", provider: "x" })).status, 409); // duplicate name

    const got = (await json(await fetch(base + "/api/providers/" + created.id))).provider;
    assert.equal(got.provider, "openai-codex");
    assert.equal(got.roles.map.thinking, "low");

    // update + delete
    await fetch(base + "/api/providers/" + created.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ thinking: "off" }) });
    assert.equal((await json(await fetch(base + "/api/providers/" + created.id))).provider.thinking, "off");
    await fetch(base + "/api/providers/" + created.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ thinking: "xhigh" }) });
    assert.equal((await json(await fetch(base + "/api/providers/" + created.id))).provider.thinking, "xhigh");
    assert.equal((await fetch(base + "/api/providers/" + created.id, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(base + "/api/providers/" + created.id)).status, 404);
  });
});

test("api: non-loopback control plane requires operator bearer auth", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "flounder-api-auth-"));
  assert.throws(() => startUiServer({ port: 0, out, host: "0.0.0.0" }), /operator auth/);

  const server = startUiServer({ port: 0, out, host: "0.0.0.0", operatorToken: "secret" });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api")).status, 401);
    const ok = await fetch(base + "/api", { headers: { authorization: "Bearer secret" } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).name, "flounder");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
