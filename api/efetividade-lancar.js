// api/efetividade-lancar.js
import { google } from "googleapis";

// -----------------------------------------------------------------------------
// Helper de ambiente: aceita os nomes já usados (português) e os padrões em
// inglês para manter compatibilidade e evitar quebra de deploy.
// -----------------------------------------------------------------------------
function getEnv() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY || process.env["CHAVE_PRIVADA_DO_GOOGLE"];

  // 1) Preferência: ID dedicado da planilha Efetividade
  // 2) Compatibilidade: ID padrão já usado em outros módulos
  const spreadsheetId =
    process.env.SPREADSHEET_ID_EFETIVIDADE ||
    process.env.ID_DA_PLANILHA_EFETIVIDADE ||
    process.env.SPREADSHEET_ID ||
    process.env.ID_DA_PLANILHA;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, " +
        "GOOGLE_PRIVATE_KEY / CHAVE_PRIVADA_DO_GOOGLE e o ID da planilha (SPREADSHEET_ID_EFETIVIDADE, ID_DA_PLANILHA_EFETIVIDADE ou SPREADSHEET_ID)."
    );
  }

  return {
    serviceAccountEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    spreadsheetId,
  };
}

async function getSheetsClient() {
  const { serviceAccountEmail, privateKey } = getEnv();

  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

const ABA_LANCADOS = "LANCADOS";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  try {
    const { spreadsheetId } = getEnv();
    const sheets = await getSheetsClient();

    const {
      registroBase,     // array vindo da BASE_DADOS (linha completa)
      loja,
      usuario,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    } = req.body || {};

    if (!Array.isArray(registroBase) || !registroBase.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Registro da base (registroBase) inválido.",
      });
    }

    if (!loja || !usuario) {
      return res.status(400).json({
        sucesso: false,
        message: "Loja e usuário são obrigatórios.",
      });
    }

    if (!observacao || !quantidade || !valorUnitario || !numeroDocumento) {
      return res.status(400).json({
        sucesso: false,
        message:
          "Observação, quantidade, valor unitário e número de documento são obrigatórios.",
      });
    }

    // Data/hora em Brasília
    const agora = new Date();
    const dataHora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(agora);

    /*
      Montagem da linha:
      A: DATA/HORA
      B: LOJA
      C: USUÁRIO
      D...: colunas originais da BASE_DADOS
      (últimas): OBS, QTD, VALOR, DOC
    */
    const linha = [
      dataHora,
      loja,
      usuario,
      ...registroBase,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${ABA_LANCADOS}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Lançamento registrado com sucesso na aba LANCADOS.",
    });
  } catch (erro) {
    console.error("Erro em /api/efetividade-lancar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao registrar lançamento na aba LANCADOS.",
      detalhe: erro.message,
    });
  }
}
