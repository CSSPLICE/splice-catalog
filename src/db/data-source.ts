import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import { Catalog } from "./entities/catalog";
import { CreateSPLICECatalog1699653593228 } from "./migrations/1699653593228-CreateSPLICECatalog";
import { SeedInitialData1699653979099 } from "./migrations/1699653979099-SeedInitialData";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || "splice",
  password: process.env.DB_PASSWORD || "splice",
  database: process.env.DB_DATABASE || "splice",
  migrations: [CreateSPLICECatalog1699653593228, SeedInitialData1699653979099],
  logging: process.env.ORM_LOGGING === "true",
  entities: [Catalog],
  synchronize: false,
  subscribers: [],
  migrationsRun: true,
});