// API/relatorios.js
// Lista os registros da aba RELATORIO com filtros opcionais.
//
// Variáveis de ambiente (Vercel):
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// SPREADSHEET_ID
//
// Colunas esperadas em RELATORIO (A:S):
// A  DATA/HORA REGISTRO
// B  LOJA
// C  USUARIO
// D  EAN
// E  COD CONSINCO
// F  PRODUTO
// G  DEPARTAMENTO
// H  SECAO
// I  GRUPO
// J  SUBGRUPO
// K  CATEGORIA
// L  RELATORIO/OBSERVACAO
// M  QUANTIDADE
// N  VALOR UNITARIO
// O  DOCUMENTO
// P  ID
// Q  IMAGEM_URL
// R  DATA_OCORRIDO
// S  HORA_OCORRIDO
//
// Ajustes aplicados (neste arquivo):
// 1) Range A2:S (inclui R e S) - mantido.
// 2) Retorna dataOcorrido (R) e horaOcorrido (S) - mantido.
// 3) normalizarHoraHHMM - mantido.
// 4) Filtro por dataInicio/dataFim usa DATA_OCORRIDO (R) - mantido.
// 5) ✅ CORREÇÃO: filtro por data por comparação de strings ISO (YYYY-MM-DD),
//    evitando bugs de timezone/parsing do Date em ambiente serverless.
// 6) ✅ CORREÇÃO: se faltar env vars, retorna 500 (fail-fast) com mensagem clara.

import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

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
 * Normaliza hora para "HH:mm".
 * Aceita: "HH:mm", "HH:mm:ss", "H:mm", "H:mm:ss"
 */
function normalizarHoraHHMM(horaStr) {
  const s = String(horaStr || "").trim();
  if (!s) return "";

  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s;

  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Converte "DD/MM/AAAA" -> "AAAA-MM-DD" (ISO de data).
 * Se não bater o padrão, retorna "".
 */
function dataBRParaISO(dataBR) {
  const s = String(dataBR || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const dd = m[1], mm = m[2], yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  // ✅ Fail-fast de variáveis de ambiente
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    console.error("Variáveis de ambiente do Google não configuradas corretamente.");
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  try {
    const {
      loja = "",
      usuario = "",
      documento = "",
      departamento = "",
      dataInicio = "", // esperado: "YYYY-MM-DD"
      dataFim = "",    // esperado: "YYYY-MM-DD"
    } = req.query;

    const sheets = await getSheetsClient();

    const range = "RELATORIO!A2:S";
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
        imagemUrlCol,      // Q
        dataOcorridoCol,   // R
        horaOcorridoCol,   // S
      ] = row;

      const horaOcorridoNorm = normalizarHoraHHMM(horaOcorridoCol);

      return {
        // Mantém compatibilidade com seu front atual
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

        id: idCol || "",
        idRegistro: idCol || "",

        imageUrl: imagemUrlCol || "",

        // Novos campos
        dataOcorrido: dataOcorridoCol || "",       // "DD/MM/AAAA"
        horaOcorrido: horaOcorridoNorm || "",      // "HH:mm"
      };
    });

    // Filtros normalizados
    const lojaFiltro = String(loja).trim().toLowerCase();
    const usuarioFiltro = String(usuario).trim().toLowerCase();
    const docFiltro = String(documento).trim();
    const depFiltro = String(departamento).trim().toUpperCase();

    // ✅ Datas vindas do querystring já são ISO (YYYY-MM-DD).
    // Vamos comparar com ISO gerado a partir de R (DD/MM/AAAA).
    const iniISO = String(dataInicio || "").trim(); // "" ou "YYYY-MM-DD"
    const fimISO = String(dataFim || "").trim();    // "" ou "YYYY-MM-DD"

    const filtrados = registros.filter((reg) => {
      if (lojaFiltro && !String(reg.loja || "").toLowerCase().includes(lojaFiltro)) return false;
      if (usuarioFiltro && !String(reg.usuario || "").toLowerCase().includes(usuarioFiltro)) return false;
      if (docFiltro && String(reg.documento || "") !== docFiltro) return false;
      if (depFiltro && String(reg.departamento || "").toUpperCase() !== depFiltro) return false;

      // ✅ Filtro de datas por string ISO (estável e sem timezone)
      if (iniISO || fimISO) {
        const regISO = dataBRParaISO(reg.dataOcorrido); // "YYYY-MM-DD"
        if (!regISO) return false;

        if (iniISO && regISO < iniISO) return false;
        if (fimISO && regISO > fimISO) return false;
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
