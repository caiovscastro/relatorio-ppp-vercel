import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

function normalizarMotivoParaPlanilha(raw){
  const s = String(raw ?? "").trim();
  if(!s) return "";

  const up = s.toUpperCase();
  const permitidos = new Set(["M.L","M.M","E.N","M_L","M_M","E_N"]);
  if(permitidos.has(up)) return up;

  const low = s.toLowerCase();
  if(low === "movi. entre lojas") return "M.L";
  if(low === "movi. manutenção" || low === "movi. manutencao") return "M.M";
  if(low === "entrada novo" || low === "entrada novos") return "E.N";

  return s;
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function asIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function asIntSignedSafe(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function badRequest(res, msg) {
  return res.status(400).json({ sucesso: false, message: msg });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  const session = requireSession(req, res, { allowedProfiles: PERFIS_PERMITIDOS });
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  const body = req.body || {};
  const idLinha = String(body.idLinha ?? "").trim();
  const contagens = body.contagens && typeof body.contagens === "object" ? body.contagens : null;

  if (!idLinha) return badRequest(res, "ID inválido (coluna U).");
  if (!contagens) return badRequest(res, "Conteúdo inválido: contagens ausente.");

  try {
    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CARRINHOS!A:U",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return res.status(404).json({ sucesso: false, message: "Nenhum dado encontrado na aba CARRINHOS." });
    }

    const firstCell = String(values?.[0]?.[0] || "").toUpperCase();
    const startIndex = firstCell.includes("DATA") ? 1 : 0;

    let foundIndex = -1;
    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];
      const id = String(row[20] ?? "").trim();
      if (id === idLinha) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex < 0) {
      return res.status(404).json({ sucesso: false, message: "ID não encontrado na coluna U." });
    }

    const rowFound = values[foundIndex] || [];
    const lojaDaLinha = String(rowFound[1] ?? "").trim();
    const lojaSessao = String(session.loja ?? "").trim();
    const perfil = String(session.perfil ?? "").trim().toUpperCase();

    if (perfil !== "GERENTE_PPP" && perfil !== "ADMINISTRADOR") {
      if (!lojaSessao || lojaDaLinha !== lojaSessao) {
        return res.status(403).json({
          sucesso: false,
          message: "Você não tem permissão para editar os dados dessa loja",
        });
      }
    }

    const sheetRowNumber = foundIndex + 1;

    const payloadER = [
      asIntSafe(contagens.duplocar120),
      asIntSafe(contagens.grande160),
      asIntSafe(contagens.bebeConforto160),
      asIntSafe(contagens.maxcar200),
      asIntSafe(contagens.macrocar300),
      asIntSafe(contagens.pranchaJacare),
      asIntSafe(contagens.compraKids),
      asIntSafe(contagens.carrinhoGaiolaPet),
      asIntSafe(contagens.bebeJipinho),
      asIntSafe(contagens.cestinha),
      asIntSafe(contagens.cadeiraRodas),
      asIntSafe(contagens.carrinhosQuebrados),
      asIntSafe(contagens.carrinhosReserva),
      asIntSafe(contagens.cestinhasReserva),
    ];

    const movCarrinhos = asIntSignedSafe(contagens.movCarrinhos);
    let motivo = normalizarMotivoParaPlanilha(contagens.movCategoria);
    if (movCarrinhos === 0) motivo = "";

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `CARRINHOS!E${sheetRowNumber}:R${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [payloadER] },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `CARRINHOS!S${sheetRowNumber}:T${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[movCarrinhos, motivo]] },
    });

    if (perfil === "GERENTE_PPP" || perfil === "ADMINISTRADOR") {
      const usuarioSessao = String(session.usuario ?? "").trim();
      if (usuarioSessao) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `CARRINHOS!C${sheetRowNumber}:C${sheetRowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[usuarioSessao]] },
        });
      }
    }

    return res.status(200).json({
      sucesso: true,
      message: "Edição salva com sucesso.",
    });
  } catch (erro) {
    console.error("Erro em /api/carrinhos-editar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao salvar edição.",
      detalhe: erro?.message || String(erro),
    });
  }
}
