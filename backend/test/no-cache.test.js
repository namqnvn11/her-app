// her-52 (28/08/2026): Android (okhttp) gửi If-None-Match → Express trả 304 thân rỗng → app trắng
// (iOS tự lấy cache nên không lộ). API là dữ liệu động: KHÔNG ETag, luôn 200 + thân + no-store.
// Không cần DB (chỉ gọi /health và 1 route trả lỗi 401) — server cổng 4291, DB her_test_z.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const S = "http://localhost:4291/api";
let proc;

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${S}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server không khởi động được");
}

before(async () => {
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, PORT: "4291", MONGODB_URI: "mongodb://localhost:27017/her_test_z", JWT_SECRET: "testsecret" },
  });
  await waitHealthy();
});
after(() => proc?.kill());

test("her-52: response không có ETag, có Cache-Control no-store", async () => {
  const r = await fetch(`${S}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("etag"), null, "không được phát ETag");
  assert.match(r.headers.get("cache-control") || "", /no-store/);
});

test("her-52: gửi If-None-Match (như okhttp Android) vẫn nhận 200 + thân JSON, không 304", async () => {
  const first = await fetch(`${S}/health`);
  const body1 = await first.json();
  // Giả lập ETag mà Express cũ từng phát cho đúng thân này (weak etag) + ETag bất kỳ
  for (const tag of ['W/"25-abc"', "*"]) {
    const r = await fetch(`${S}/health`, { headers: { "If-None-Match": tag } });
    assert.equal(r.status, 200, `If-None-Match ${tag} → phải 200, nhận ${r.status}`);
    assert.deepEqual(await r.json(), body1);
  }
});
