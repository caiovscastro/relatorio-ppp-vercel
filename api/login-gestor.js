// API de login do gestor: /api/login-gestor
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido." });
  }

  const { usuario, senha } = req.body || {};

  // Usuários autorizados para o painel gerente
  const gestores = {
    "ana.soares": "864875",
    "gaspar.silva": "842142",
  };

  // Validação simples de usuário + senha
  if (!gestores[usuario] || gestores[usuario] !== senha) {
    return res
      .status(401)
      .json({ sucesso: false, message: "Usuário ou senha inválidos." });
  }

  // Token simples (pode ser trocado por JWT no futuro)
  const token = Buffer.from(`${usuario}:${Date.now()}`).toString("base64");

  return res.status(200).json({
    sucesso: true,
    usuario,
    token,
  });
}
