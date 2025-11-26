// API/produtos.js
//
// Rota GET /api/produtos
//
// Lê todos os produtos (colunas A:H) da aba BASE da planilha Google,
// usando conta de serviço.
//
// VARIÁVEIS DE AMBIENTE ACEITAS (na Vercel → Settings → Environment Variables):
//
//  Preferencial (padrão):
//    - GOOGLE_SERVICE_ACCOUNT_EMAIL  -> e-mail da conta de serviço
//    - GOOGLE_PRIVATE_KEY            -> chave privada
//    - SPREADSHEET_ID                -> ID da planilha
//
//  Também aceitamos os nomes que você já criou:
//    - E-MAIL DA CONTA DE SERVIÇO DO GOOGLE  -> e-mail da conta de serviço
//    - CHAVE_PRIVADA_DO_GOOGLE               -> chave privada
//    - ID_DA_PLANILHA                        -> ID da planilha
//
// Planilha (aba BASE):
//  A = EAN
//  B = Cód Consinco
//  C = Produto
//  D = Departamento
//  E = Seção
//  F = Grupo
//  G = Subgrupo
//  H = Categoria
//
// Esta API SEMPRE devolve a base completa A:H (sem filtro por loja).

import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// -----------------------------------------------------------------------------
// Leitura das variáveis de ambiente (com fallback pros nomes que você usou)
// -----------------------------------------------------------------------------
function getEnvVars() {
  // E-mail da conta de serviço
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];

  // Chave privada
  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.CHAVE_PRIVADA_DO_GOOGLE;

  // ID da planilha
  const spreadsheetId =
    process.env.SPREADSHEET_ID ||
    process.env.ID_DA_PLANILHA;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      "Variáveis de ambiente ausentes. " +
        "Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, " +
        "GOOGLE_PRIVATE_KEY / CHAVE_PRIVADA_DO_GOOGLE e " +
        "SPREADSHEET_ID / ID_DA_PLANILHA."
    );
  }

  return { serviceAccountEmail, privateKeyRaw, spreadsheetId };
}

// Cria cliente autenticado para acessar a Sheets API
function getAuthClient() {
  const { serviceAccountEmail, privateKeyRaw } = getEnvVars();

  // Se a chave vier com '\n', converte para quebras de linha reais
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const jwtClient = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    SCOPES
  );

  return jwtClient;
}

// -----------------------------------------------------------------------------
// Handler da rota /api/produtos
// -----------------------------------------------------------------------------
export default async function handler(req, res) {
  // Só permitimos GET
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  try {
    const { spreadsheetId } = getEnvVars();
    const auth = getAuthClient();
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    // Lê da aba BASE, da linha 2 em diante, colunas A..H
    const range = "BASE!A2:H";
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const values = response.data.values || [];

    // Aqui não há filtro por loja: devolvemos a base toda.
    return res.status(200).json({
      sucesso: true,
      produtos: values
    });
  } catch (erro) {
    console.error("Erro na API /api/produtos:", erro);

    return res.status(500).json({
      sucesso: false,
      message: "Erro interno na API de produtos.",
      detalhe: erro?.message || String(erro)
    });
  }
}
