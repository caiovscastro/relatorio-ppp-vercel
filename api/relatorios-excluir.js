// api/relatorios-excluir.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js"; // ✅ NOVO

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas corretamente.");
}

async function getSheetsClientWrite() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

function montarLinhaDoRegistro(reg) {
  return [
    reg.dataHora || "",
    reg.loja || "",
    reg.usuario || "",
    reg.ean || "",
    reg.codConsinco || "",
    reg.produto || "",
    reg.departamento || "",
    reg.secao || "",
    reg.grupo || "",
    reg.subgrupo || "",
    reg.categoria || "",
    reg.relatorio || "",
    reg.quantidade || "",
    reg.valorUnitario || "",
    reg.documento || "",
  ];
}

function linhasIguais(l1, l2) {
  if (!Array.isArray(l1) || !Array.isArray(l2)) return false;
  if (l1.length !== l2.length) return false;
  for (let i = 0; i < l1.length; i++) {
    if ((l1[i] || "") !== (l2[i] || "")) return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // ✅ NOVO: exige sessão válida (8h via cookie)
  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração de Google Sheets incompleta. Verifique variáveis de ambiente.",
    });
  }

  try {
    const { registro } = req.body || {};

    if (!registro || typeof registro !== "object") {
      return res.status(400).json({
        sucesso: false,
        message: "Parâmetro 'registro' é obrigatório e deve ser um objeto.",
      });
    }

    const idRegistro =
      registro.idRegistro ||
      registro.ID_REGISTRO ||
      registro.id ||
      "";

    const sheets = await getSheetsClientWrite();

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const abaRelatorio = (spreadsheet.data.sheets || []).find(
      (s) => s.properties?.title === "RELATORIO"
    );

    if (!abaRelatorio || !abaRelatorio.properties?.sheetId) {
      return res.status(500).json({
        sucesso: false,
        message: "Aba 'RELATORIO' não encontrada.",
      });
    }

    const sheetId = abaRelatorio.properties.sheetId;

    const range = "RELATORIO!A2:P";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resposta.data.values || [];

    let indexEncontrado = -1;

    if (idRegistro) {
      for (let i = 0; i < rows.length; i++) {
        const linhaAtual = rows[i] || [];
        const idNaLinha = linhaAtual[15] || "";
        if (idNaLinha === idRegistro) {
          indexEncontrado = i;
          break;
        }
      }

      if (indexEncontrado === -1) {
        return res.status(404).json({
          sucesso: false,
          message: "Registro (ID_REGISTRO) não encontrado na planilha para exclusão.",
        });
      }
    } else {
      const linhaAlvo = montarLinhaDoRegistro(registro);

      for (let i = 0; i < rows.length; i++) {
        const linhaAtualCompleta = rows[i] || [];
        const linhaAtualAO = linhaAtualCompleta.slice(0, 15);
        if (linhasIguais(linhaAtualAO, linhaAlvo)) {
          indexEncontrado = i;
          break;
        }
      }

      if (indexEncontrado === -1) {
        return res.status(404).json({
          sucesso: false,
          message: "Registro não encontrado na planilha para exclusão (sem ID).",
        });
      }
    }

    const sheetRowIndex = 1 + indexEncontrado;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1,
              },
            },
          },
        ],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Registro excluído com sucesso.",
    });
  } catch (erro) {
    console.error("Erro em /api/relatorios-excluir:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao excluir registro.",
      detalhe: erro.message || String(erro),
    });
  }
}
