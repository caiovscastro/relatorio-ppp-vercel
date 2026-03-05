import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.PRODUTIVIDADE_ID_OP;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const ABA = "PRODUTIVIDADE";
const RANGE_LISTAR = `${ABA}!A2:I`;

function ok(res, obj){ return res.status(200).json(obj); }
function bad(res, status, message, detalhe){
  return res.status(status).json({ sucesso:false, message, ...(detalhe ? { detalhe } : {}) });
}

function normStr(v){ return String(v ?? "").trim(); }
function normKey(v){ return normStr(v).toUpperCase().replace(/\s+/g, " "); }

function isAdmin(perfil){ return normKey(perfil).includes("ADMIN"); }
function isGerenteRegional(perfil){ return normKey(perfil).includes("GERENTE_REGIONAL"); }
function canViewAll(perfil){ return isAdmin(perfil) || isGerenteRegional(perfil); }

function preflight(req, res){
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-efetividade-session");
  res.setHeader("Access-Control-Max-Age", "86400");
  return res.status(204).end();
}

async function getSheetsClient(){
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    throw new Error("Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e PRODUTIVIDADE_ID_OP.");
  }
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );
  return google.sheets({ version: "v4", auth });
}

function readTerm(req){
  const fromQuery = normStr(req.query?.term);
  const fromBody  = normStr(req.body?.term);
  return (fromBody || fromQuery).toLowerCase();
}

export default async function handler(req, res){
  if (req.method === "OPTIONS") return preflight(req, res);

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method !== "GET" && req.method !== "POST"){
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return bad(res, 405, "Use GET ou POST.");
  }

  try{
    const sessao = await requireSession(req, res);
    if (!sessao) return;

    const perfil = sessao?.perfil ?? sessao?.role ?? "";
    const lojaSessao = sessao?.loja ?? sessao?.unidade ?? sessao?.store ?? "";

    const term = readTerm(req);
    if (term.length < 2){
      return ok(res, { sucesso:true, items: [] });
    }

    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE_LISTAR,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp.data.values || [];
    const itemsMap = new Map();

    for (let i = 0; i < values.length; i++){
      const r = values[i] || [];
      const loja = normStr(r?.[2]);
      const matricula = normStr(r?.[4]);
      const nome = normStr(r?.[5]);

      if (!canViewAll(perfil)){
        if (normKey(loja) !== normKey(lojaSessao)) continue;
      }

      const hay = (nome + " " + matricula).toLowerCase();
      if (!hay.includes(term)) continue;

      const key = matricula + "|" + nome;
      if (!itemsMap.has(key)){
        itemsMap.set(key, { matricula, nome });
      }
      if (itemsMap.size >= 50) break;
    }

    return ok(res, { sucesso:true, items: [...itemsMap.values()] });

  }catch(e){
    console.error("Erro produtividade-autocomplete:", e);
    return bad(res, 500, "Erro no autocomplete PRODUTIVIDADE.", e?.message || String(e));
  }
}
