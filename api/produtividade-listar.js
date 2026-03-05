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

function setCors(req, res){
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

function preflight(req, res){
  setCors(req, res);
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

export default async function handler(req, res){
  if (req.method === "OPTIONS") return preflight(req, res);
  setCors(req, res);

  if (req.method !== "GET" && req.method !== "POST"){
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return bad(res, 405, "Use GET ou POST.");
  }

  try{
    const sessao = await requireSession(req, res);
    if (!sessao) return;

    const perfil = sessao?.perfil ?? sessao?.role ?? "";
    const lojaSessao = sessao?.loja ?? sessao?.unidade ?? sessao?.store ?? "";

    const lojaReq = normStr(req.body?.loja || req.query?.loja || "");

    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE_LISTAR,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp.data.values || [];

    let rows = values.map((r, idx) => ({
      rowNumber: idx + 2,
      dataHoraRede: r?.[0] ?? "",
      data: r?.[1] ?? "",
      loja: r?.[2] ?? "",
      setor: r?.[3] ?? "",
      matricula: r?.[4] ?? "",
      nome: r?.[5] ?? "",
      qtd: r?.[6] ?? "",
      usuario: r?.[8] ?? ""
    }));

    if (!canViewAll(perfil)) {
      const lk = normKey(lojaSessao);
      rows = rows.filter(x => normKey(x.loja) === lk);
    } else {
      if (lojaReq){
        const lk = normKey(lojaReq);
        rows = rows.filter(x => normKey(x.loja) === lk);
      }
    }

    return ok(res, {
      sucesso: true,
      rows,
      perfil: normStr(perfil),
      loja: normStr(lojaSessao),
    });
  }catch(e){
    console.error("Erro produtividade-listar:", e);
    return bad(res, 500, "Erro ao carregar PRODUTIVIDADE.", e?.message || String(e));
  }
}
