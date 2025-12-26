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
// R  DATA_OCORRIDO   ✅ NOVO (usado no filtro de datas do dashboard)
// S  HORA_OCORRIDO   ✅ NOVO (usado para filtro por turno no dashboard)
//
// Ajustes aplicados:
// 1) Range agora é A2:S (inclui R e S).
// 2) Retorna no JSON: dataOcorrido (R) e horaOcorrido (S).
// 3) Normaliza horaOcorrido para "HH:mm" (remove segundos se vier "HH:mm:ss").
// 4) Filtro por dataInicio/dataFim (querystring) agora usa DATA_OCORRIDO (coluna R),
//    como solicitado.

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
 * Normaliza hora para "HH:mm".
 * Aceita: "HH:mm", "HH:mm:ss", "H:mm", "H:mm:ss"
 */
function normalizarHoraHHMM(horaStr) {
  const s = String(horaStr || "").trim();
  if (!s) return "";

  // pega os dois primeiros blocos numéricos separados por ":"
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s; // se vier algo inesperado, devolve como está (não quebra)

  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Converte datas da planilha para Date (sem horário).
 * Aceita:
 * - "dd/MM/yyyy"
 * - "yyyy-MM-dd"
 * - "dd/MM/yyyy HH:mm" (vai usar só a parte da data)
 */
function parseDataSomente(dataStr) {
  if (!dataStr) return null;

  const raw = String(dataStr).trim();
  if (!raw) return null;

  const parteData = raw.split(" ")[0] || "";

  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(parteData)) {
    const [yyyy, mm, dd] = parteData.split("-");
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }

  // dd/MM/yyyy
  const m = parteData.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const dd = m[1], mm = m[2], yyyy = m[3];
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }

  return null;
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

    // ✅ Agora inclui até a coluna S (DATA_OCORRIDO e HORA_OCORRIDO)
    const range = "RELATORIO!A2:S";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE", // importante: traz datas/horas formatadas como texto
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
        dataOcorridoCol,   // R  ✅
        horaOcorridoCol,   // S  ✅
      ] = row;

      const horaOcorridoNorm = normalizarHoraHHMM(horaOcorridoCol);

      return {
        // Mantém compatibilidade com seu dashboard atual
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

        // IDs (compatibilidade)
        id: idCol || "",
        idRegistro: idCol || "",

        // Imagem (compatibilidade)
        imageUrl: imagemUrlCol || "",

        // ✅ NOVOS CAMPOS (para filtro por data e turno no front)
        dataOcorrido: dataOcorridoCol || "",
        horaOcorrido: horaOcorridoNorm || "",
      };
    });

    // Intervalo (se vier querystring)
    const iniDate = dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
    const fimDate = dataFim ? new Date(`${dataFim}T23:59:59`) : null;

    const lojaFiltro = loja.trim().toLowerCase();
    const usuarioFiltro = usuario.trim().toLowerCase();
    const docFiltro = documento.trim();
    const depFiltro = departamento.trim().toUpperCase();

    const filtrados = registros.filter((reg) => {
      if (lojaFiltro && !String(reg.loja || "").toLowerCase().includes(lojaFiltro)) return false;
      if (usuarioFiltro && !String(reg.usuario || "").toLowerCase().includes(usuarioFiltro)) return false;
      if (docFiltro && String(reg.documento || "") !== docFiltro) return false;
      if (depFiltro && String(reg.departamento || "").toUpperCase() !== depFiltro) return false;

      // ✅ SOLICITADO: filtro de datas usa a coluna R (DATA_OCORRIDO)
      if (iniDate || fimDate) {
        const dataReg = parseDataSomente(reg.dataOcorrido);
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
