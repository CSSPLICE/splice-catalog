import bodyParser from "body-parser";
import cors from "cors";
import express, { Express, Request, Response } from "express";
import catalogRoutes from "./routes/catalog";
import { ErrorHandler } from "./utils/ErrorHandler";

const app: Express = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/catalog", catalogRoutes);

app.all("*", (req: Request, res: Response) => {
  return res.status(404).send({
    success: false,
    message: "Invalid route",
  });
});

app.use(ErrorHandler.handleErrors);

export default app;