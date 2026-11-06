import express from "express";
import { roleSchema } from "@app/shared";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", roles: roleSchema.options });
});

const port = Number(process.env.PORT) || 3333;
app.listen(port, () => console.log(`API rodando na porta ${port}`));