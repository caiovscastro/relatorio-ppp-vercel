export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  const { usuario, senha } = req.body;

  const gestores = {
    "caio.castro": "842142",
    "gaspar.silva": "842142"
  };

  if (!gestores[usuario] || gestores[usuario] !== senha) {
    return res.status(401).json({ sucesso: false, message: "Usuário ou senha inválidos." });
  }

  // Token simples (pode ser JWT no futuro)
  const token = Buffer.from(`${usuario}:${Date.now()}`).toString("base64");

  return res.status(200).json({
    sucesso: true,
    usuario,
    token
  });
}
