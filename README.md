# Mini Drive · Desbravando UTV

![status](https://img.shields.io/badge/status-em%20produção-6FCF97)
![runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020)
![storage](https://img.shields.io/badge/storage-R2-7B3FE4)
![egress](https://img.shields.io/badge/egress-gratuito-brightgreen)
![deps](https://img.shields.io/badge/dependências-0-brightgreen)

**Projeto real, em produção — não é demo nem exercício de portfólio.** É usado no dia a dia da **Desbravando UTV**, uma operação de expedições de UTV com atuação nacional que movimenta milhões de reais.

**Desbravando UTV:** [site oficial](https://desbravandoutv.com) · Instagram [@desbravando_utv](https://www.instagram.com/desbravando_utv/)

> Acervo de arquivos da operação (pacotes de briefing, artes, entregáveis) num único **Cloudflare Worker + R2**. O Worker serve a interface, valida a chave e organiza cada upload num caminho navegável — a **US$ 0/mês** até 10 GB, porque no R2 o download não custa nada.

---

## 1. Visão Geral e a Dor

O Estúdio de Briefing gera um pacote (ZIP com fotos, textos e specs) a cada expedição. Antes, esses pacotes viviam na pasta de downloads de quem gerou — **sem acervo central**, sem quem-tem-o-quê, e recuperar um briefing antigo virava caça ao arquivo no WhatsApp.

**O que está sendo resolvido?**
Um lugar só, online, onde todo pacote gerado fica guardado, organizado e baixável — sem depender da máquina de ninguém.

**Por que R2 e não um Drive/S3 qualquer?**
O acervo é feito pra ser **baixado** muitas vezes. No S3 tradicional o tráfego de saída é o que dói na conta; no R2 o egress é sempre gratuito. Para um acervo de mídia consultado com frequência, isso é a diferença entre custo previsível e susto no fim do mês.

---

## 2. Arquitetura e Decisões Técnicas

```
┌────────────────────────┐        POST /upload         ┌───────────────────┐
│  Estúdio de Briefing   │ ──────────────────────────▶ │  Worker (grátis)  │
│  (HTML estático)       │   ZIP + tipo + projeto      │  valida a chave e │
└────────────────────────┘                             │  organiza o nome  │
        ▲                                               └─────────┬─────────┘
        │ download local continua                                 │ put()
        │ acontecendo normalmente (fail-open)                     ▼
┌────────────────────────┐   GET /  ·  /list  ·  /file/…  ┌───────────────────┐
│  Mini Drive (interface │ ◀───────────────────────────── │   R2 (10 GB free) │
│  servida pelo Worker)  │                                │ ANO/TIPO/PROJETO/…│
└────────────────────────┘                                └───────────────────┘
```

| Camada | Escolha | Por que escolhi isso? | Alternativa considerada | Nota de impacto |
|---|---|---|---|---|
| **Runtime** | Cloudflare Workers | Serve a interface e a API no mesmo edge, deploy num comando, plano gratuito | VPS + Node | Zero-ops, custo zero |
| **Storage** | R2 | **Egress gratuito** (acervo é feito pra baixar), S3-compatível, 10 GB grátis | S3 (egress caro), Backblaze | Custo de saída = R$ 0 |
| **Auth** | Chave única (`x-drive-key` ou `?k=`) | Equipe interna pequena; a chave é *secret* do Wrangler | OAuth, conta por usuário | Atrito mínimo |
| **Integração** | *Fail-open* no Estúdio | Se o drive cair, o download local do briefing acontece normalmente | Acoplamento forte | Robustez na ponta |
| **Organização** | Chave determinística `ANO/TIPO/PROJETO/[data-hora_]arquivo` | Acervo navegável e com nome estável (reenviar substitui, não duplica) | UUID plano | Achabilidade + dedup |

**Rotas:** `GET /` (interface) · `POST /upload?tipo&projeto&arquivo[&sub][&direto=1]` · `GET /list` · `GET /file/<chave>` · `DELETE /file/<chave>`.

---

## 3. Destaque de Engenharia / "The Hard Part"

**Nomeação determinística que serve de índice.** Em vez de guardar os arquivos com um id opaco e manter um banco à parte só pra saber o que é o quê, a própria **chave do objeto no R2 é a organização**: `ANO/TIPO/PROJETO/DATA-HORA_ARQUIVO`. Isso dá três coisas de graça:

- **Listagem navegável** — o `/list` só lê os prefixos do bucket, sem banco.
- **Dedup por nome estável** — uploads manuais usam `&direto=1` (sem o prefixo de data), então reenviar a versão corrigida de uma arte **substitui** em vez de acumular lixo.
- **Estrutura de pastas preservada** — `&sub=pasta/subpasta` mantém a hierarquia de uma pasta arrastada pra dentro do drive.

E a integração com o Estúdio é **fail-open** de propósito: o envio ao acervo é um efeito colateral do fluxo, nunca um bloqueio. Se o Worker estiver fora do ar, o Estúdio só avisa e o download local segue — a ferramenta de quem está trabalhando nunca para por causa do acervo.

---

## 4. Deploy

Pré-requisito: conta gratuita na Cloudflare e Node.js.

```bash
npx wrangler login                         # 1) logar
npx wrangler r2 bucket create minidrive    # 2) criar o bucket
npx wrangler secret put DRIVE_KEY          # 3) definir a chave de acesso
npx wrangler deploy                        # 4) publicar
```

O deploy imprime a URL (`https://minidrive.SEU-USUARIO.workers.dev`). Abra, informe a chave, e o drive está no ar. Para conectar o Estúdio, preencha `DRIVE_ENDPOINT` e `DRIVE_KEY` no HTML dele — com `DRIVE_ENDPOINT` vazio, nada muda (fail-open).

## 5. Custos e limites

| Recurso | Plano grátis | Depois |
| --- | --- | --- |
| Worker (requisições) | 100.000/dia | US$ 5/mês (10 M) |
| R2 (armazenamento) | 10 GB | ~US$ 0,015/GB/mês |
| R2 (tráfego de saída) | **sempre gratuito** | **sempre gratuito** |

Limite de 100 MB por upload no plano grátis do Workers; com as fotos comprimidas pelo Estúdio, um briefing típico fica entre 5 e 25 MB — os 10 GB comportam centenas de pacotes.

> A chave de acesso é *secret* do Wrangler; não vai no código nem no HTML. Trocar é repetir o passo 3.
