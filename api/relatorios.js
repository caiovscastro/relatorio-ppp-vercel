// API/relatorios.js
// Lista os registros da aba RELATORIO com filtros opcionais.
//
// Variáveis de ambiente (Vercel):
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// SPREADSHEET_ID
//
// Colunas esperadas em RELATORIO (A:Q):
// A  DATA/HORA
// B  LOJAS
// C  USÚARIOS
// D  EAN
// E  COD CONSINCO
// F  PRODUTO
// G  DEPARTAMENTO
// H  SECAO
// I  GRUPO
// J  SUBGRUPO
// K  CATEGORIA
// L  RELATORIO/OBSERVAÇÃO
// M  QUANTIDADE
// N  VALOR UNITARIO
// O  DOCUMENTO
// P  ID  (identificador único do registro – usado para exclusão/edição)
// Q  IMAGEM_URL (link da imagem - Firebase Storage)

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
  console.error("Variáveis de ambiente do Google não configuradas corretamente.");
}

/**
 * Cria cliente autenticado do Google Sheets (somente leitura).
 */
async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Converte "27/11/2025 14:32:10" -> Date(ano/mes/dia)
 */
function parseDataDaPlanilha(dataHoraStr) {
  if (!dataHoraStr) return null;

  try {
    const [parteData] = String(dataHoraStr).split(" ");
    const [dia, mes, ano] = (parteData || "").split("/");
    if (!dia || !mes || !ano) return null;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  try {
    const {
      loja = "",
      usuario = "",
      documento = "",
      departamento = "",
      dataInicio = "",
      dataFim = "",
    } = req.query;

    const sheets = await getSheetsClient();

    // ✅ CORRIGIDO: agora inclui a coluna Q (imagem)
    const range = "RELATORIO!A2:Q";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resposta.data.values || [];

    const registros = rows.map((row) => {
      const [
        dataHora,          // A
        lojaCol,           // B
        usuarioCol,        // C
        ean,               // D
        codConsinco,       // E
        produto,           // F
        departamentoCol,   // G
        secao,             // H
        grupo,             // I
        subgrupo,          // J
        categoria,         // K
        relatorioObs,      // L
        quantidade,        // M
        valorUnitario,     // N
        documentoCol,      // O
        idCol,             // P
        imagemUrlCol,      // Q  ✅ NOVO
      ] = row;

      return {
        dataHora: dataHora || "",
        loja: lojaCol || "",
        usuario: usuarioCol || "",
        ean: ean || "",
        codConsinco: codConsinco || "",
        produto: produto || "",
        departamento: departamentoCol || "",
        secao: secao || "",
        grupo: grupo || "",
        subgrupo: subgrupo || "",
        categoria: categoria || "",
        relatorio: relatorioObs || "",
        quantidade: quantidade || "",
        valorUnitario: valorUnitario || "",
        documento: documentoCol || "",

        // ✅ mantenho compatibilidade com seu front (ele aceita id também)
        id: idCol || "",
        idRegistro: idCol || "",

        // ✅ campo que o painel-gestor.html deve usar pra miniatura/botão
        imageUrl: imagemUrlCol || "",
      };
    });

    const iniDate = dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
    const fimDate = dataFim ? new Date(`${dataFim}T23:59:59`) : null;

    const lojaFiltro = loja.trim().toLowerCase();
    const usuarioFiltro = usuario.trim().toLowerCase();
    const docFiltro = documento.trim();
    const depFiltro = departamento.trim().toUpperCase();

    const filtrados = registros.filter((reg) => {
      if (lojaFiltro && !reg.loja.toLowerCase().includes(lojaFiltro)) return false;
      if (usuarioFiltro && !reg.usuario.toLowerCase().includes(usuarioFiltro)) return false;
      if (docFiltro && reg.documento !== docFiltro) return false;
      if (depFiltro && reg.departamento.toUpperCase() !== depFiltro) return false;

      if (iniDate || fimDate) {
        const dataReg = parseDataDaPlanilha(reg.dataHora);
        if (!dataReg) return false;
        if (iniDate && dataReg < iniDate) return false;
        if (fimDate && dataReg > fimDate) return false;
      }

      return true;
    });

    return res.status(200).json({
      sucesso: true,
      total: filtrados.length,
      registros: filtrados,
    });
  } catch (erro) {
    console.error("Erro em /api/relatorios:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao listar relatórios.",
      detalhe: erro.message || String(erro),
    });
  }
}
