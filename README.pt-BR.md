# Mini Drive · Desbravando UTV

[English](README.md) · Português

Acervo de arquivos da Desbravando UTV, operadora de expedições off-road de UTV. Briefings,
artes e documentos ficam num bucket R2 da Cloudflare, navegável por pastas, atrás de uma chave
compartilhada. Um único Worker serve a interface e a API.

## Status

Em produção desde julho de 2026 em `minidrive.desbravando-utv.workers.dev`. Pouca manutenção.

## O problema

O Estúdio de Briefing gera um pacote ZIP a cada expedição. Esses pacotes, e as artes prontas,
ficavam na pasta de downloads de quem gerou. O Mini Drive guarda tudo num lugar só, organizado
por expedição, para baixar de qualquer aparelho.

## Como funciona

- A chave do objeto é a estrutura de pastas: `ANO/TIPO/PROJETO/[subpastas/][data-hora_]arquivo`.
  O `/list` lê o bucket, não há banco.
- `&direto=1` grava sem o prefixo de data, então reenviar um arquivo corrigido substitui o antigo.
- `&sub=a/b` mantém a estrutura de uma pasta enviada (até 6 níveis, cada parte higienizada).
- O Estúdio manda o ZIP para cá como efeito colateral. Se o drive estiver fora, o download
  local continua acontecendo.

Rotas: `GET /` (interface), `POST /upload?tipo&projeto&arquivo[&sub][&direto=1]`,
`GET /list`, `GET /file/<chave>`, `DELETE /file/<chave>`.

## Stack

- Cloudflare Worker (`worker.js`), JavaScript puro, sem build
- Cloudflare R2 para os arquivos (binding `BUCKET`, bucket `minidrive`)
- A interface é uma string HTML dentro do `worker.js`

## Rodar localmente

Precisa de Node 20 ou mais novo.

```bash
npm install
echo DRIVE_KEY=qualquer-chave-local > .dev.vars
npx wrangler dev
```

## Testes

```bash
npm test
```

Sobe o `wrangler dev` com um R2 local temporário e confere: a página abre, a chave é exigida,
e enviar, listar, baixar e remover funcionam de ponta a ponta.

## Pastas

| Caminho | O que é |
|---|---|
| `worker.js` | API e interface |
| `wrangler.toml` | Worker e binding do R2 |
| `tests/` | Testes automáticos |
| `docs/arquitetura/` | Diagramas |

## Arquitetura

Diagramas em [docs/arquitetura/](docs/arquitetura/).

## Decisões e limites conhecidos

- Uma chave compartilhada (`DRIVE_KEY`, secret do Wrangler). Sem conta por pessoa.
- A versão atual também aceita a chave no parâmetro `?k=`, que vaza para histórico do
  navegador e logs. O branch `revisao-2026-11` passa a aceitar só o cabeçalho e restringe o
  CORS às origens conhecidas.
- O plano gratuito do Workers limita cada envio a 100 MB.
- O "baixar pasta como .zip" foi descrito em julho de 2026, mas nunca foi commitado nem
  publicado. Ver [docs/HISTORICO.md](docs/HISTORICO.md).

## Licença

Todos os direitos reservados. Publicado como portfólio; não licenciado para reuso. Veja o arquivo [LICENSE](LICENSE).
