// API/relatorios.js
// Lista os registros da aba RELATORIO com filtros opcionais.
// Usa as mesmas variáveis de ambiente já configuradas na Vercel:
//
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// SPREADSHEET_ID
//
// Colunas esperadas em RELATORIO (A:O):
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

import { google } from 'googleapis';

function getEnvVars() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env['E-MAIL DA CONTA DE SERVIÇO DO GOOGLE'];

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY || process.env.CHAVE_PRIVADA_DO_GOOGLE;

  const spreadsheetId =
    process.env.SPREADSHEET_ID || process.env.ID_DA_PLANILHA;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      'Variáveis de ambiente ausentes. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, GOOGLE_PRIVATE_KEY / CHAVE_PRIVADA_DO_GOOGLE e SPREADSHEET_ID / ID_DA_PLANILHA.'
    );
  }

  return {
    serviceAccountEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
    spreadsheetId,
  };
}

/**
 * Cria cliente autenticado do Google Sheets.
 */
async function getSheetsClient({ serviceAccountEmail, privateKey }) {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );

  await auth.authorize();

  return google.sheets({ version: 'v4', auth });
}

/**
 * Converte string da planilha (ex.: "27/11/2025 14:32:10")
 * em objeto Date somente com ano/mes/dia.
 */
function parseDataDaPlanilha(dataHoraStr) {
  if (!dataHoraStr) return null;

  try {
    const [parteData] = String(dataHoraStr).split(' ');
    const [dia, mes, ano] = parteData.split('/');

    if (!dia || !mes || !ano) return null;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ sucesso: false, message: 'Método não permitido.' });
  }

  try {
    let envVars;

    try {
      envVars = getEnvVars();
    } catch (err) {
      return res.status(500).json({
        sucesso: false,
        message: 'Configuração da API incompleta. Verifique as variáveis de ambiente.',
        detalhe: err.message,
      });
    }

    const { serviceAccountEmail, privateKey, spreadsheetId } = envVars;
    const sheets = await getSheetsClient({ serviceAccountEmail, privateKey });

    const {
      loja = '',
      usuario = '',
      documento = '',
      departamento = '',
      dataInicio = '',
      dataFim = '',
    } = req.query;

    // Busca todos os registros da aba RELATORIO (da linha 2 pra baixo)
    const range = 'RELATORIO!A2:O';
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = resposta.data.values || [];

    // Mapeia cada linha em um objeto com nomes claros
    const registros = rows.map((row) => {
      const [
        dataHora,
        lojaCol,
        usuarioCol,
        ean,
        codConsinco,
        produto,
        departamentoCol,
        secao,
        grupo,
        subgrupo,
        categoria,
        relatorioObs,
        quantidade,
        valorUnitario,
        documentoCol,
      ] = row;

      return {
        dataHora: dataHora || '',
        loja: lojaCol || '',
        usuario: usuarioCol || '',
        ean: ean || '',
        codConsinco: codConsinco || '',
        produto: produto || '',
        departamento: departamentoCol || '',
        secao: secao || '',
        grupo: grupo || '',
        subgrupo: subgrupo || '',
        categoria: categoria || '',
        relatorio: relatorioObs || '',
        quantidade: quantidade || '',
        valorUnitario: valorUnitario || '',
        documento: documentoCol || '',
      };
    });

    // Converte datas enviadas pelo front (input type="date" -> yyyy-mm-dd)
    const iniDate =
      dataInicio ? new Date(`${dataInicio}T00:00:00`) : null;
    const fimDate =
      dataFim ? new Date(`${dataFim}T23:59:59`) : null;

    const lojaFiltro = loja.trim().toLowerCase();
    const usuarioFiltro = usuario.trim().toLowerCase();
    const docFiltro = documento.trim();
    const depFiltro = departamento.trim().toUpperCase();

    const filtrados = registros.filter((reg) => {
      // Filtro de loja (contém, ignorando maiúsc/minúsc)
      if (lojaFiltro && !reg.loja.toLowerCase().includes(lojaFiltro)) {
        return false;
      }

      // Filtro de usuário (contém, ignorando maiúsc/minúsc)
      if (usuarioFiltro && !reg.usuario.toLowerCase().includes(usuarioFiltro)) {
        return false;
      }

      // Filtro de documento (comparação exata)
      if (docFiltro && reg.documento !== docFiltro) {
        return false;
      }

      // Filtro de departamento (ex.: MERCEARIA, PERECIVEIS, etc.)
      if (depFiltro && reg.departamento.toUpperCase() !== depFiltro) {
        return false;
      }

      // Filtro de período (data da coluna A entre dataInicio e dataFim)
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
    console.error('Erro em /api/relatorios:', erro);
    return res.status(500).json({
      sucesso: false,
      message: 'Erro interno ao listar relatórios.',
      detalhe: erro.message || String(erro),
    });
  }
}
