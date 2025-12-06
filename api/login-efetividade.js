// API/login-efetividade.js
// Login específico para o módulo de EFETIVIDADE OPERACIONAL

// Lista de usuários da Efetividade (edite aqui quando quiser mudar)
const USUARIOS_EFETIVIDADE = [
  {
    usuario: "efetiv01",
    senha: "1234",
    loja: "ULT 01 - PLANALTINA",
  },
  {
    usuario: "efetiv08",
    senha: "1234",
    loja: "ULT 08 - ARAPOANGA",
  },
  // Adicione quantos quiser:
  // { usuario: "fulano", senha: "xxxx", loja: "ULT 10 - ESTRUTURAL" },
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  try {
    const { usuario, senha, loja } = req.body || {};

    if (!usuario || !senha || !loja) {
      return res.status(400).json({
        sucesso: false,
        message: "Informe usuário, senha e loja.",
      });
    }

    // Procura um usuário que bata com TODOS os campos
    const encontrado = USUARIOS_EFETIVIDADE.find(
      (u) =>
        u.usuario === usuario.trim() &&
        u.senha === senha.trim() &&
        u.loja === loja.trim()
    );

    if (!encontrado) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário, senha ou loja inválidos para Efetividade.",
      });
    }

    // Se chegou aqui, credenciais válidas
    return res.status(200).json({
      sucesso: true,
      message: "Login Efetividade autorizado.",
      usuario: encontrado.usuario,
      loja: encontrado.loja,
    });
  } catch (erro) {
    console.error("Erro em /api/login-efetividade:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de Efetividade.",
      detalhe: erro.message,
    });
  }
}
