// /api/carrinhos-editar.js
//
// Atualiza contagens (E:R) na aba CARRINHOS usando o ID da coluna U.
// Regras:
// - Apenas POST
// - Exige sessão válida (requireSession)
// - Permite editar SOMENTE a loja da sessão (sem exceção)
// - Atualiza colunas:
//   E..R: duplocar120, grande160, bebeConforto160, maxcar200, macrocar300, pranchaJacare,
//         compraKids, carrinhoGaiolaPet, bebeJipinho, cestinha, cadeiraRodas,
//         carrinhosQuebrados, carrinhosReserva, cestinhasReserva
//
// Segurança:
// - Não confia no front: valida loja do registro no servidor

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

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

    // Lemos A:U para localizar a linha pelo ID (U)
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

    // Localiza índice (0-based no array) e número real da linha na planilha (1-based)
    let foundIndex = -1;
    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];
      const id = String(row[20] ?? "").trim(); // U
      if (id === idLinha) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex < 0) {
      return res.status(404).json({ sucesso: false, message: "ID não encontrado na coluna U." });
    }

    const rowFound = values[foundIndex] || [];
    const lojaDaLinha = String(rowFound[1] ?? "").trim(); // B
    const lojaSessao = String(session.loja ?? "").trim();

    // ✅ Regra: apenas loja logada pode editar
    if (!lojaSessao || lojaDaLinha !== lojaSessao) {
      return res.status(403).json({
        sucesso: false,
        message: "Você não tem permissão para editar dados dessa loja",
      });
    }

    // Linha real na planilha: (foundIndex + 1) pois values[0] é linha 1
    // Mesmo com cabeçalho, o índice já corresponde à linha real dentro do range.
    const sheetRowNumber = foundIndex + 1;

    // Monta valores E..R (14 colunas)
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

    // Atualiza E:R da linha encontrada
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `CARRINHOS!E${sheetRowNumber}:R${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [payloadER],
      },
    });

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

/*
  Fontes confiáveis:
  - Google Sheets API (values.get / values.update): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values
  - valueInputOption (USER_ENTERED): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/update
  - Node Google APIs (JWT): https://github.com/googleapis/google-api-nodejs-client
*/
