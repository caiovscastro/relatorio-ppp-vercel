import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.PRODUTIVIDADE_ID_OP;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const ABA = "PRODUTIVIDADE";
const RANGE = `${ABA}!B2:I`;

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
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
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

  if (req.method !== "POST"){
    res.setHeader("Allow", "POST, OPTIONS");
    return bad(res, 405, "Use POST.");
  }

  try{
    const sessao = await requireSession(req, res);
    if (!sessao) return;

    const perfil = sessao?.perfil ?? sessao?.role ?? "";
    const lojaSessao = sessao?.loja ?? sessao?.unidade ?? sessao?.store ?? "";

    const lojaReq = normStr(req.body?.loja);
    const matriculaReq = normStr(req.body?.matricula);
    const dataReq = normStr(req.body?.data);

    if(!lojaReq || !matriculaReq || !dataReq){
      return bad(res, 400, "Campos obrigatórios ausentes (loja, matricula, data).");
    }

    if(!canViewAll(perfil)){
      if(normKey(lojaReq) !== normKey(lojaSessao)){
        return bad(res, 403, "Perfil sem acesso.");
      }
    }

    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp.data.values || [];
    const lk = normKey(lojaReq);
    const mk = normStr(matriculaReq);
    const dk = normStr(dataReq);

    for(let i=0;i<values.length;i++){
      const r = values[i] || [];
      const rowNumber = i + 2;

      const data = normStr(r?.[0] ?? "");
      const loja = normStr(r?.[1] ?? "");
      const setor = normStr(r?.[2] ?? "");
      const matricula = normStr(r?.[3] ?? "");
      const nome = normStr(r?.[4] ?? "");
      const qtd = r?.[5] ?? "";
      const usuario = r?.[7] ?? "";

      if(normKey(loja) === lk && matricula === mk && data === dk){
        return ok(res, {
          sucesso:true,
          found:true,
          row:{
            rowNumber,
            dataHoraRede: "",
            data,
            loja,
            setor,
            matricula,
            nome,
            qtd,
            usuario
          }
        });
      }
    }

    return ok(res, { sucesso:true, found:false });

  }catch(e){
    console.error("Erro produtividade-verificar:", e);
    return bad(res, 500, "Erro ao verificar na PRODUTIVIDADE.", e?.message || String(e));
  }
}
