/* ============================================================
   MINI DRIVE · Desbravando UTV — v2
   Cloudflare Worker + R2

   Rotas:
     GET  /                      → interface do drive (HTML)
     POST /upload?tipo&projeto&arquivo[&sub][&direto=1]
                                 → grava um arquivo no R2
     GET  /list                  → lista os arquivos (JSON)
     GET  /file/<chave>          → baixa um arquivo
     DELETE /file/<chave>        → remove um arquivo

   v2: além dos ZIPs automáticos do Estúdio, a interface permite
   enviar manualmente arquivos e pastas (ex.: artes concluídas).
     - &direto=1 grava sem o prefixo de data/hora (nome estável;
       reenviar com o mesmo nome substitui o arquivo)
     - &sub=pasta/subpasta preserva a estrutura de uma pasta enviada

   Autenticação: chave única compartilhada (secret DRIVE_KEY),
   enviada no header "x-drive-key" ou no parâmetro "?k=".

   Organização no bucket:
     ANO/TIPO/PROJETO[/SUBPASTAS]/[DATA-HORA_]ARQUIVO
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-drive-key",
};

const MIME = {
  zip: "application/zip", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript",
  ttf: "font/ttf", otf: "font/otf",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function authorized(request, url, env) {
  const key = request.headers.get("x-drive-key") || url.searchParams.get("k") || "";
  return env.DRIVE_KEY && key === env.DRIVE_KEY;
}

function safeSeg(s, fallback) {
  const v = (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return v || fallback;
}

/* subcaminho de pasta: cada segmento sanitizado, sem segmentos só de pontos, até 6 níveis */
function safePath(p) {
  return (p || "").split("/").map((s) => safeSeg(s, ""))
    .filter((s) => s && !/^\.+$/.test(s)).slice(0, 6).join("/");
}

function safeName(s, fallback) {
  const v = safeSeg(s, fallback);
  return /^\.+$/.test(v) ? fallback : v;
}

function contentTypeFor(request, arquivo) {
  const hdr = request.headers.get("content-type") || "";
  if (hdr && hdr !== "application/octet-stream") return hdr;
  const ext = (arquivo.split(".").pop() || "").toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    /* ---------- interface ---------- */
    if (path === "/" && request.method === "GET") {
      return new Response(UI_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    /* ---------- upload ---------- */
    if (path === "/upload" && request.method === "POST") {
      if (!authorized(request, url, env)) return json({ erro: "chave inválida" }, 401);

      const tipo = safeSeg(url.searchParams.get("tipo"), "geral");
      const projeto = safeSeg(url.searchParams.get("projeto"), "sem-nome");
      const arquivo = safeName(url.searchParams.get("arquivo"), "arquivo.bin");
      const sub = safePath(url.searchParams.get("sub"));
      const direto = url.searchParams.get("direto") === "1";

      const now = new Date();
      const ano = String(now.getFullYear());
      const stamp = now.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      const base = `${ano}/${tipo}/${projeto}/` + (sub ? sub + "/" : "");
      const chave = direto ? base + arquivo : `${base}${stamp}_${arquivo}`;

      const body = await request.arrayBuffer();
      if (!body.byteLength) return json({ erro: "corpo vazio" }, 400);

      await env.BUCKET.put(chave, body, {
        httpMetadata: { contentType: contentTypeFor(request, arquivo) },
        customMetadata: { tipo, projeto, enviado_em: now.toISOString() },
      });
      return json({ ok: true, chave, bytes: body.byteLength });
    }

    /* ---------- listagem ---------- */
    if (path === "/list" && request.method === "GET") {
      if (!authorized(request, url, env)) return json({ erro: "chave inválida" }, 401);

      const itens = [];
      let cursor;
      do {
        const page = await env.BUCKET.list({ cursor, limit: 1000 });
        for (const o of page.objects) {
          itens.push({
            chave: o.key,
            bytes: o.size,
            enviado_em: o.uploaded,
            tipo: o.customMetadata?.tipo || o.key.split("/")[1] || "",
            projeto: o.customMetadata?.projeto || o.key.split("/")[2] || "",
          });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      itens.sort((a, b) => (a.enviado_em < b.enviado_em ? 1 : -1));
      return json({ itens });
    }

    /* ---------- download / remoção ---------- */
    if (path.startsWith("/file/")) {
      if (!authorized(request, url, env)) return json({ erro: "chave inválida" }, 401);
      const chave = decodeURIComponent(path.slice("/file/".length));

      if (request.method === "GET") {
        const obj = await env.BUCKET.get(chave);
        if (!obj) return json({ erro: "não encontrado" }, 404);
        const nome = chave.split("/").pop();
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
            "content-disposition": `attachment; filename="${nome}"`,
            ...CORS,
          },
        });
      }
      if (request.method === "DELETE") {
        await env.BUCKET.delete(chave);
        return json({ ok: true });
      }
    }

    return json({ erro: "rota desconhecida" }, 404);
  },
};

/* ============================================================
   Interface do Mini Drive — identidade Desbravando (P&B,
   Anton nos títulos, Archivo no corpo).
   ============================================================ */
const UI_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mini Drive · Desbravando UTV</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0B0B0B;--card:#141414;--line:#2B2B2B;--txt:#FFF;--mut:#C7C7C7;--dim:#8A8A8A}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--txt);font-family:'Archivo',sans-serif;line-height:1.5;padding-bottom:80px}
.wrap{max-width:960px;margin:0 auto;padding:0 22px}
header{padding:38px 0 26px;border-bottom:1px solid var(--line)}
h1{font-family:'Anton';font-size:clamp(32px,6vw,52px);text-transform:uppercase;line-height:.9;letter-spacing:-.5px}
.sub{color:var(--dim);margin-top:10px;font-size:14px}
.bar{display:flex;gap:12px;align-items:center;margin:24px 0 8px;flex-wrap:wrap}
input[type=search],input[type=password],input[type=text]{background:#0F0F0F;border:1px solid var(--line);color:#FFF;border-radius:10px;padding:11px 14px;font:inherit;font-size:15px}
input[type=search]{flex:1;min-width:220px}
input:focus{outline:none;border-color:#FFF}
::placeholder{color:#5E5E5E}
button{font:inherit;cursor:pointer}
.pill{display:inline-flex;align-items:center;gap:6px;border:1.5px solid rgba(255,255,255,.38);border-radius:999px;padding:8px 18px;background:none;color:#FFF;font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:1px;transition:border-color .12s}
.pill:hover{border-color:#FFF}
.pill.on{background:#FFF;color:#000;border-color:#FFF}
.stats{color:var(--dim);font-size:13px;margin:6px 0 18px}
.ano{font-family:'Anton';font-size:22px;text-transform:uppercase;margin:30px 0 4px;letter-spacing:.5px}
.grupo{margin:14px 0 8px;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--dim)}
.item{display:flex;gap:14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:8px 0;flex-wrap:wrap}
.item .nm{font-weight:600;font-size:14.5px;flex:1;min-width:200px;word-break:break-all}
.item .meta{color:var(--dim);font-size:12.5px;white-space:nowrap}
.item .acts{display:flex;gap:8px}
.abtn{border:1px solid var(--line);background:#0F0F0F;color:#FFF;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;text-decoration:none}
.abtn:hover{border-color:#FFF}
.abtn.del:hover{border-color:#F66;color:#F66}
.empty{color:var(--dim);padding:40px 0;text-align:center}
.login{max-width:380px;margin:80px auto;text-align:center}
.login .pill{margin-top:16px}
.login input{width:100%;margin-top:18px}
.err{color:#F88;font-size:13px;margin-top:10px;min-height:18px}
:focus-visible{outline:2px solid #FFF;outline-offset:2px;border-radius:4px}
/* painel de envio manual (v2) */
.up{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
.up h2{font-family:'Anton';font-size:20px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.up .hint{color:var(--dim);font-size:12.5px;margin-bottom:14px}
.uprow{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}
.uprow>div{flex:1;min-width:200px}
.uprow label{display:block;font-size:11.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.uprow input{width:100%}
.upbtns{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.uplist{margin-top:14px}
.upitem{display:flex;gap:10px;align-items:center;font-size:13px;color:var(--mut);border-top:1px solid var(--line);padding:8px 2px}
.upitem .fn{flex:1;min-width:0;word-break:break-all}
.upitem .st{white-space:nowrap;font-weight:600}
.st.ok{color:#8F8}
.st.err{color:#F88}
.st.run{color:#FFF}
</style>
</head>
<body>
<div class="wrap" id="app"></div>
<script>
const app=document.getElementById("app");
let KEY=localStorage.getItem("minidrive-key")||"";
let ITENS=[],FILTRO="",TIPO_F="",UP_ABERTO=false,ENVIANDO=false;

const LIMITE=95*1024*1024; /* ~limite de 100 MB por requisicao no plano gratis */
const fmtB=b=>b>1048576?(b/1048576).toFixed(1)+" MB":Math.round(b/1024)+" KB";
const fmtD=s=>new Date(s).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const esc=s=>(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const slug=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");

function loginView(msg){
  app.innerHTML='<div class="login"><h1>Mini Drive</h1><div class="sub">Acervo de briefings e artes · Desbravando UTV</div>'
    +'<input type="password" id="k" placeholder="Chave de acesso" autofocus>'
    +'<div class="err">'+esc(msg||"")+'</div>'
    +'<button class="pill on" id="entrar">Entrar</button></div>';
  const go=async()=>{
    KEY=document.getElementById("k").value.trim();
    if(!KEY)return;
    localStorage.setItem("minidrive-key",KEY);
    carregar();
  };
  document.getElementById("entrar").addEventListener("click",go);
  document.getElementById("k").addEventListener("keydown",e=>{if(e.key==="Enter")go();});
}

async function carregar(){
  app.innerHTML='<div class="empty">Carregando o acervo…</div>';
  try{
    const r=await fetch("/list",{headers:{"x-drive-key":KEY}});
    if(r.status===401){localStorage.removeItem("minidrive-key");loginView("Chave inválida.");return;}
    ITENS=(await r.json()).itens||[];
    render();
  }catch(_){app.innerHTML='<div class="empty">Não foi possível carregar. Recarregue a página.</div>';}
}

function upPanelHTML(tipos){
  let dl='';
  const sug=[...new Set(["artes-concluidas"].concat(tipos))];
  for(const t of sug)dl+='<option value="'+esc(t)+'">';
  return '<div class="up" id="up"><h2>Enviar arquivos</h2>'
    +'<div class="hint">Para artes concluídas e outros materiais. Arquivos com o mesmo nome, na mesma categoria e projeto, são substituídos. Limite: 100 MB por arquivo. Envio de pasta inteira funciona no computador (no celular, use "Escolher arquivos").</div>'
    +'<div class="uprow">'
    +'<div><label for="uptipo">Categoria</label><input type="text" id="uptipo" list="tiposdl" placeholder="ex.: artes-concluidas" value="artes-concluidas"><datalist id="tiposdl">'+dl+'</datalist></div>'
    +'<div><label for="upproj">Projeto / pasta</label><input type="text" id="upproj" placeholder="ex.: serra-catarinense"></div>'
    +'</div>'
    +'<div class="upbtns">'
    +'<button class="pill" id="upfiles">Escolher arquivos</button>'
    +'<button class="pill" id="updir">Escolher uma pasta</button>'
    +'<input type="file" id="upfilesin" multiple style="display:none">'
    +'<input type="file" id="updirin" webkitdirectory multiple style="display:none">'
    +'</div><div class="uplist" id="uplist"></div></div>';
}

function render(){
  const tipos=[...new Set(ITENS.map(i=>i.tipo))].sort();
  const vis=ITENS.filter(i=>(!TIPO_F||i.tipo===TIPO_F)&&(!FILTRO||i.chave.toLowerCase().includes(FILTRO)));
  const total=vis.reduce((a,i)=>a+i.bytes,0);

  let h='<header><h1>Mini Drive</h1><div class="sub">Pacotes de briefing gerados pelo Estúdio e artes concluídas, organizados por ano, categoria e projeto.</div></header>';
  h+='<div class="bar"><input type="search" id="busca" placeholder="Buscar por projeto ou arquivo…" value="'+esc(FILTRO)+'">';
  h+='<button class="pill'+(UP_ABERTO?" on":"")+'" id="uptog">+ Enviar arquivos</button>';
  h+='</div>';
  if(UP_ABERTO)h+=upPanelHTML(tipos);
  h+='<div class="bar" style="margin-top:6px">';
  h+='<button class="pill'+(TIPO_F===""?" on":"")+'" data-t="">Todos</button>';
  for(const t of tipos)h+='<button class="pill'+(TIPO_F===t?" on":"")+'" data-t="'+esc(t)+'">'+esc(t.replace(/_/g," "))+'</button>';
  h+='</div><div class="stats"><b>'+vis.length+'</b> arquivo(s) · '+fmtB(total)+'</div>';

  if(!vis.length)h+='<div class="empty">Nenhum arquivo aqui ainda. Gere um briefing no Estúdio ou use “+ Enviar arquivos”.</div>';
  else{
    let ano="",grupo="";
    for(const i of vis){
      const parts=i.chave.split("/");
      const a=parts[0],proj=parts[2]||"";
      if(a!==ano){ano=a;grupo="";h+='<div class="ano">'+esc(a)+'</div>';}
      const g=i.tipo+" · "+proj;
      if(g!==grupo){grupo=g;h+='<div class="grupo">'+esc(i.tipo.replace(/_/g," "))+' — '+esc(proj)+'</div>';}
      const nome=parts.slice(3).join("/")||parts.pop();
      h+='<div class="item"><span class="nm">'+esc(nome)+'</span>'
        +'<span class="meta">'+fmtD(i.enviado_em)+' · '+fmtB(i.bytes)+'</span>'
        +'<span class="acts"><a class="abtn" href="/file/'+encodeURIComponent(i.chave)+'?k='+encodeURIComponent(KEY)+'">Baixar</a>'
        +'<button class="abtn del" data-del="'+esc(i.chave)+'">Remover</button></span></div>';
    }
  }
  app.innerHTML=h;

  document.getElementById("busca").addEventListener("input",e=>{FILTRO=e.target.value.toLowerCase();render();});
  document.getElementById("uptog").addEventListener("click",()=>{if(ENVIANDO)return;UP_ABERTO=!UP_ABERTO;render();});
  app.querySelectorAll(".pill[data-t]").forEach(b=>b.addEventListener("click",()=>{TIPO_F=b.dataset.t;render();}));
  app.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
    const c=b.dataset.del;
    if(!confirm("Remover definitivamente o arquivo\\n"+c.split("/").pop()+" ?"))return;
    const r=await fetch("/file/"+encodeURIComponent(c),{method:"DELETE",headers:{"x-drive-key":KEY}});
    if(r.ok){ITENS=ITENS.filter(i=>i.chave!==c);render();}
    else alert("Não foi possível remover.");
  }));

  if(UP_ABERTO){
    document.getElementById("upfiles").addEventListener("click",()=>document.getElementById("upfilesin").click());
    document.getElementById("updir").addEventListener("click",()=>document.getElementById("updirin").click());
    document.getElementById("upfilesin").addEventListener("change",e=>enviar([...e.target.files]));
    document.getElementById("updirin").addEventListener("change",e=>enviar([...e.target.files]));
  }
}

async function enviar(files){
  if(!files.length||ENVIANDO)return;
  let tipo=slug(document.getElementById("uptipo").value)||"artes-concluidas";
  let projInput=slug(document.getElementById("upproj").value);
  const lista=document.getElementById("uplist");
  ENVIANDO=true;
  lista.innerHTML="";
  const rows=[];
  for(const f of files){
    const el=document.createElement("div");el.className="upitem";
    el.innerHTML='<span class="fn">'+esc(f.webkitRelativePath||f.name)+'</span><span class="st run">aguardando…</span>';
    lista.appendChild(el);rows.push(el.querySelector(".st"));
  }
  let ok=0;
  for(let i=0;i<files.length;i++){
    const f=files[i],st=rows[i];
    if(f.size>LIMITE){st.textContent="acima de 100 MB — não enviado";st.className="st err";continue;}
    /* pasta enviada: 1º nível vira o projeto (se o campo estiver vazio); o resto vira subpastas */
    let projeto=projInput,sub="";
    if(f.webkitRelativePath){
      const p=f.webkitRelativePath.split("/");
      const dirs=p.slice(0,-1);
      if(!projeto&&dirs.length){projeto=slug(dirs.shift());}
      sub=dirs.map(slug).filter(Boolean).join("/");
    }
    if(!projeto)projeto="geral";
    st.textContent="enviando…";
    try{
      const u="/upload?direto=1&tipo="+encodeURIComponent(tipo)
        +"&projeto="+encodeURIComponent(projeto)
        +"&arquivo="+encodeURIComponent(f.name)
        +(sub?"&sub="+encodeURIComponent(sub):"");
      const r=await fetch(u,{method:"POST",headers:{"x-drive-key":KEY,"content-type":f.type||"application/octet-stream"},body:f});
      if(r.ok){st.textContent="enviado ✓";st.className="st ok";ok++;}
      else{st.textContent="erro ("+r.status+")";st.className="st err";}
    }catch(_){st.textContent="sem conexão";st.className="st err";}
  }
  ENVIANDO=false;
  const done=document.createElement("div");done.className="upitem";
  done.innerHTML='<span class="fn"><b>'+ok+' de '+files.length+' arquivo(s) enviados.</b> A lista abaixo será atualizada.</span>';
  lista.appendChild(done);
  setTimeout(carregar,1200);
}

if(KEY)carregar();else loginView();
</script>
</body>
</html>`;
