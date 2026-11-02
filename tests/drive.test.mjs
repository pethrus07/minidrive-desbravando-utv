/**
 * Suíte contra o Worker de verdade em `wrangler dev` local (R2 simulado no disco).
 *
 *   npm test
 *
 * Cobre: a tela abre, a chave é exigida, e o ciclo enviar, listar, baixar e remover.
 * Nada sai desta máquina: o `--persist-to` guarda o R2 local numa pasta temporária.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = 8798;
const BASE = `http://127.0.0.1:${PORTA}`;
const CHAVE = "chave-de-teste";
const estado = mkdtempSync(join(tmpdir(), "minidrive-teste-"));
const wrangler = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");
let servidor;

before(async () => {
  servidor = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORTA),
    "--persist-to", estado, "--var", `DRIVE_KEY:${CHAVE}`, "--show-interactive-dev-session=false"],
    { cwd: raiz, stdio: "ignore" });
  const fim = Date.now() + 60000;
  while (Date.now() < fim) {
    try { if ((await fetch(BASE + "/")).status === 200) return; } catch { /* subindo */ }
    await new Promise((ok) => setTimeout(ok, 400));
  }
  throw new Error("o wrangler dev não respondeu");
});

after(() => {
  if (servidor) servidor.kill();
  try { rmSync(estado, { recursive: true, force: true }); } catch { /* Windows segura arquivo */ }
});

const comChave = { "x-drive-key": CHAVE };

test("a tela abre na raiz", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Mini Drive/);
});

test("sem chave, nada é listado nem enviado", async () => {
  assert.equal((await fetch(BASE + "/list")).status, 401);
  assert.equal((await fetch(BASE + "/list", { headers: { "x-drive-key": "errada" } })).status, 401);
  const up = await fetch(BASE + "/upload?tipo=x&projeto=y&arquivo=a.txt", { method: "POST", body: "oi" });
  assert.equal(up.status, 401);
});

test("enviar, listar, baixar e remover", async () => {
  const conteudo = "arquivo de teste " + Date.now();
  const up = await fetch(BASE + "/upload?tipo=expedicoes&projeto=Expedição Teste&arquivo=nota.txt&sub=documentos&direto=1",
    { method: "POST", headers: { ...comChave, "content-type": "text/plain" }, body: conteudo });
  assert.equal(up.status, 200, await up.clone().text());
  const { chave } = await up.json();
  assert.match(chave, /^\d{4}\/expedicoes\/expedicao-teste\/documentos\/nota\.txt$/);

  const { itens } = await (await fetch(BASE + "/list", { headers: comChave })).json();
  assert.ok(itens.some((i) => i.chave === chave));

  const baixa = await fetch(BASE + "/file/" + encodeURIComponent(chave), { headers: comChave });
  assert.equal(baixa.status, 200);
  assert.equal(await baixa.text(), conteudo);

  const apaga = await fetch(BASE + "/file/" + encodeURIComponent(chave), { method: "DELETE", headers: comChave });
  assert.equal(apaga.status, 200);
  assert.equal((await fetch(BASE + "/file/" + encodeURIComponent(chave), { headers: comChave })).status, 404);
});

test("nome de pasta com ../ não escapa do caminho", async () => {
  const up = await fetch(BASE + "/upload?tipo=x&projeto=y&arquivo=..&sub=../../etc", { method: "POST", headers: comChave, body: "z" });
  const { chave } = await up.json();
  assert.ok(!chave.includes(".."), chave);
});
