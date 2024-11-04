const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");
const YAML = require("yamljs");

const path = require("node:path");
const multer = require("multer");

// Carregar variáveis de ambiente
dotenv.config();

const authMiddleware = require("./middlewares/authMiddleware");
const rastreabilidadeMiddleware = require("./middlewares/rastreabilidadeMiddleware");

const app = express();

// Middlewares globais
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(express.static(path.join(__dirname, "public")));

if (process.env.NODE_ENV === "development") app.use(morgan("dev"));

// **Rotas públicas** - Não requerem autenticação
app.use("/", require("./routers/statusRouter"));

app.use("/open-api", (req, res) => {
  const schemaOpenAPI = YAML.load("./schemaOpenAPI.yaml");
  res.json(schemaOpenAPI);
});

app.use("/auth", require("./routers/authRouter"));

// **Middleware de autenticação** - Aplica-se apenas às rotas que necessitam de proteção
app.use(authMiddleware);

// **Middleware de rastreabilidade** - Pode ser aplicado depois do de autenticação, se necessário
app.use(rastreabilidadeMiddleware);

// **Rotas protegidas** - Necessitam de autenticação
app.use("/usuarios", require("./routers/usuarioRouter"));
app.use("/baseomies", require("./routers/baseOmieRouter"));
app.use("/tickets", require("./routers/ticketRouter"));
app.use("/aprovacoes", require("./routers/aprovacaoRouter"));
app.use("/contas-pagar", require("./routers/contaPagarRouter"));
app.use("/etapas", require("./routers/etapaRouter"));
app.use("/logs", require("./routers/logRouter"));
app.use("/prestadores", require("./routers/prestadorRouter"));
app.use("/servicos", require("./routers/servicoRouter"));
app.use("/acoes-etapas", require("./routers/acaoEtapaRouter"));

// Middleware de erro
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: err.message,
      });
    }

    return res.status(400).json({ message: err.message });
  } else if (err) {
    // Outros erros
    return res.status(500).json({ message: err.message });
  }
  next();
});

module.exports = app;
