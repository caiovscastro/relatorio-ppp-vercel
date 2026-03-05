import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.PRODUTIVIDADE_ID_OP;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const ABA = "PRODUTIVIDADE";
const RANGE_APPEND = `${ABA}!A:I`;

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

function nowSaoPauloStringBR(){
  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit",
    hour12:false
  });
  return dtf.format(new Date());
}

async function getSheetsClientWrite(){
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    throw new Error("Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e PRODUTIVIDADE_ID_OP.");
  }
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  return google.sheets({ version: "v4", auth });
}

async function existsDuplicate(sheets, { loja, matricula, dataBR }){
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ABA}!B2:E`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = resp.data.values || [];
  const lk = normKey(loja);
  const mk = normStr(matricula);
  const dk = normStr(dataBR);

  for (let i=0;i<values.length;i++){
    const r = values[i] || [];
    const data = normStr(r[0] ?? "");
    const lojaRow = normStr(r[1] ?? "");
    const matriculaRow = normStr(r[3] ?? "");
    if (normKey(lojaRow) === lk && matriculaRow === mk && data === dk){
      return true;
    }
  }
  return false;
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
    const usuarioSessao = sessao?.usuario ?? sessao?.user ?? sessao?.nome ?? "";

    const setor = normStr(req.body?.setor);
    const matricula = normStr(req.body?.matricula);
    const nome = normStr(req.body?.nome);
    const data = normStr(req.body?.data);
    const qtdReq = Number(req.body?.qtd);

    if (!setor || !matricula || !nome || !data){
      return bad(res, 400, "Campos obrigatórios ausentes.");
    }
    if (!/^\d+$/.test(matricula)){
      return bad(res, 400, "Matrícula deve ser numérica.");
    }

    const dataHoraRede = nowSaoPauloStringBR();
    const loja = normStr(lojaSessao);
    const usuario = normStr(usuarioSessao);
    const qtd = Number.isFinite(qtdReq) && qtdReq > 0 ? qtdReq : 1;

    const sheets = await getSheetsClientWrite();

    const dup = await existsDuplicate(sheets, { loja, matricula, dataBR: data });
    if (dup){
      return bad(res, 409, "Já existe lançamento dessa matrícula nessa data para a mesma loja.");
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: RANGE_APPEND,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[dataHoraRede, data, loja, setor, matricula, nome, qtd, "", usuario]],
      },
    });

    return ok(res, {
      sucesso:true,
      message:"Registro adicionado.",
      perfil: normStr(perfil),
      loja: normStr(lojaSessao),
      viewAll: canViewAll(perfil),
    });

  }catch(e){
    console.error("Erro produtividade-adicionar:", e);
    return bad(res, 500, "Erro ao adicionar na PRODUTIVIDADE.", e?.message || String(e));
  }
}
