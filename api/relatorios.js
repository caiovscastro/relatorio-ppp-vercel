// api/relatorios.js
// Lista registros da aba RELATORIO com filtros opcionais.
// ✅ Segurança:
// - Exige sessão válida via cookie (requireSession)
// - BASE_PPP fica restrito à própria loja (evita consultar outras lojas via query)
// - Não cachear resposta (no-store)
//
// ✅ Atualização solicitada:
// - Dados agora são de A:T (inclui coluna T = "Tipo de abordagem")
// - Adiciona campo "tipoAbordagem" no retorno
// - Adiciona filtro opcional por querystring: tipoAbordagem (Reativa/Preventiva)

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

function normalizarHoraHHMM(horaStr) {
  const s = String(horaStr || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s;
  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function dataBRParaISO(dataBR) {
  const s = String(dataBR || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const dd = m[1], mm = m[2], yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function upperTrim(x){ return String(x || "").trim().toUpperCase(); }
function lowerTrim(x){ return String(x || "").trim().toLowerCase(); }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  // ✅ não cachear
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // ✅ exige sessão válida
  const session = requireSession(req, res);
  if (!session) return;

  // ✅ fail-fast env
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
      dataInicio = "", // "YYYY-MM-DD"
      dataFim = "",    // "YYYY-MM-DD"
      tipoAbordagem = "", // "Reativa" | "Preventiva" (opcional)
    } = req.query;

    const perfil = upperTrim(session.perfil);
    const lojaSessao = String(session.loja || "").trim();

    // ✅ Regra de segurança:
    // BASE_PPP não pode “trocar loja” pela URL. Força a loja da sessão.
    const lojaEfetiva = (perfil === "BASE_PPP") ? lojaSessao : String(loja || "").trim();

    const sheets = await getSheetsClient();

    // ✅ Agora A:T (inclui coluna T)
    const range = "RELATORIO!A2:T";
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resposta.data.values || [];

    const registros = rows.map((row) => {
      const [
        dataHora, lojaCol, usuarioCol, ean, codConsinco, produto, departamentoCol,
        secao, grupo, subgrupo, categoria, relatorioObs, quantidade, valorUnitario,
        documentoCol, idCol, imagemUrlCol, dataOcorridoCol, horaOcorridoCol,
        tipoAbordagemCol, // ✅ Coluna T
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
        id: idCol || "",
        idRegistro: idCol || "",
        imageUrl: imagemUrlCol || "",
        dataOcorrido: dataOcorridoCol || "", // "DD/MM/AAAA"
        horaOcorrido: normalizarHoraHHMM(horaOcorridoCol) || "", // "HH:mm"
        tipoAbordagem: tipoAbordagemCol || "", // ✅ "Reativa" | "Preventiva"
      };
    });

    const lojaFiltro = lowerTrim(lojaEfetiva);
    const usuarioFiltro = lowerTrim(usuario);
    const docFiltro = String(documento || "").trim();
    const depFiltro = upperTrim(departamento);

    const iniISO = String(dataInicio || "").trim();
    const fimISO = String(dataFim || "").trim();

    const tipoAbordagemFiltro = upperTrim(tipoAbordagem);

    const filtrados = registros.filter((reg) => {
      if (lojaFiltro && !lowerTrim(reg.loja).includes(lojaFiltro)) return false;
      if (usuarioFiltro && !lowerTrim(reg.usuario).includes(usuarioFiltro)) return false;
      if (docFiltro && String(reg.documento || "") !== docFiltro) return false;
      if (depFiltro && upperTrim(reg.departamento) !== depFiltro) return false;

      // ✅ Filtro opcional por Tipo de abordagem (coluna T)
      if (tipoAbordagemFiltro) {
        if (upperTrim(reg.tipoAbordagem) !== tipoAbordagemFiltro) return false;
      }

      if (iniISO || fimISO) {
        const regISO = dataBRParaISO(reg.dataOcorrido);
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
      // debug opcional:
      // restricao: { perfil, lojaSessao, lojaEfetiva }
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
