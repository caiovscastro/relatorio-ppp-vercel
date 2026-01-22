// /api/bono-salvar.js
import { google } from "googleapis";

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function getEnv(name) {
  const v = process.env[name];
  return (v && String(v).trim()) ? v : null;
}

function agoraSP_ddmmyyyy_hhmmss() {
  // Data/hora da rede (servidor) no fuso de São Paulo
  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  // Ex: "22/01/2026 11:46:10" (alguns ambientes inserem vírgula; removemos)
  return dtf.format(new Date()).replace(",", "");
}

function validarDataHoraEscolhida(str) {
  // Esperado: "DD/MM/AAAA HH:MM"
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  const re = /^(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}):(\d{2})$/;
  const m = s.match(re);
  if (!m) return false;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const hh = Number(m[4]), min = Number(m[5]);
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  if (hh < 0 || hh > 23) return false;
  if (min < 0 || min > 59) return false;
  if (yyyy < 2020 || yyyy > 2100) return false;
  return true;
}

function normalizarTexto(x, max) {
  const s = String(x || "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function validarItem(it) {
  if (!it || typeof it !== "object") return null;

  const produto = normalizarTexto(it.produto, 200);
  const embalagem = normalizarTexto(it.embalagem, 3);
  const quantidade = Number(it.quantidade);

  if (!produto) return null;
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  if (embalagem !== "KG" && embalagem !== "UND") return null;

  return { produto, embalagem, quantidade };
}

async function obterSessaoViaApiSession(req) {
  // Usa o mesmo cookie HttpOnly do navegador.
  // Faz uma chamada interna ao seu próprio /api/session
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers["host"] ||
    (process.env.VERCEL_URL ? process.env.VERCEL_URL : "");

  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const base = host.startsWith("http") ? host : `${proto}://${host}`;

  const cookie = req.headers.cookie || "";
  if (!cookie) return null;

  const r = await fetch(`${base}/api/session`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Cookie": cookie
    }
  });

  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  if (!data || !data.sucesso || !data.usuario || !data.loja || !data.perfil) return null;

  return data; // {sucesso, usuario, loja, perfil, exp...}
}

function criarClienteGoogleSheets() {
  const spreadsheetId = getEnv("ID_DA_PLANILHA");
  const clientEmail = getEnv("E-MAIL DA CONTA DE SERVIÇO DO GOOGLE");
  const privateKeyRaw = getEnv("CHAVE_PRIVADA_DO_GOOGLE");

  if (!spreadsheetId || !clientEmail || !privateKeyRaw) {
    return { erro: "Variáveis de ambiente não configuradas." };
  }

  // Corrige quebras de linha da private key quando armazenada em env var
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { sucesso: false, mensagem: "Método não permitido." });
  }

  // 1) Sessão
  let sessao = null;
  try {
    sessao = await obterSessaoViaApiSession(req);
  } catch (e) {
    console.error("[BONO] Erro ao consultar /api/session:", e);
  }

  if (!sessao) {
    return json(res, 401, { sucesso: false, mensagem: "Sessão inválida. Faça login novamente." });
  }

  // 2) Payload
  let body = null;
  try {
    body = req.body;
    if (!body || typeof body !== "object") throw new Error("body inválido");
  } catch (e) {
    return json(res, 400, { sucesso: false, mensagem: "JSON inválido." });
  }

  const dataHoraEscolhida = normalizarTexto(body.dataHoraEscolhida, 20); // "DD/MM/AAAA HH:MM"
  const encarregado = normalizarTexto(body.encarregado, 80);
  const itens = Array.isArray(body.itens) ? body.itens : [];

  if (!validarDataHoraEscolhida(dataHoraEscolhida)) {
    return json(res, 400, { sucesso: false, mensagem: "Data/Hora escolhida inválida." });
  }
  if (!encarregado) {
    return json(res, 400, { sucesso: false, mensagem: "Nome do encarregado é obrigatório." });
  }
  if (!itens.length) {
    return json(res, 400, { sucesso: false, mensagem: "Adicione pelo menos 1 item." });
  }

  const itensValidos = [];
  for (const it of itens) {
    const v = validarItem(it);
    if (!v) {
      return json(res, 400, { sucesso: false, mensagem: "Existe item inválido na lista." });
    }
    itensValidos.push(v);
  }

  // 3) Sheets client
  const { sheets, spreadsheetId, erro } = criarClienteGoogleSheets();
  if (erro) return json(res, 500, { sucesso: false, mensagem: erro });

  // 4) Monta linhas (A..H)
  const dataHoraRede = agoraSP_ddmmyyyy_hhmmss();
  const loja = String(sessao.loja || "").trim();
  const usuario = String(sessao.usuario || "").trim();

  const values = itensValidos.map((it) => ([
    dataHoraRede,          // A
    dataHoraEscolhida,     // B
    loja,                  // C
    usuario,               // D
    encarregado,           // E
    it.produto,            // F
    it.quantidade,         // G
    it.embalagem           // H
  ]));

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "BONO!A:H",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values }
    });

    return json(res, 200, {
      sucesso: true,
      mensagem: "Bono salvo com sucesso.",
      totalItens: values.length
    });
  } catch (e) {
    console.error("[BONO] Falha ao append:", e);
    return json(res, 500, { sucesso: false, mensagem: "Falha ao salvar (BONO)." });
  }
}

/*
Fontes oficiais:
- Google Sheets API (append): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- googleapis (Node): https://github.com/googleapis/google-api-nodejs-client
- Vercel env vars: https://vercel.com/docs/projects/environment-variables
*/
