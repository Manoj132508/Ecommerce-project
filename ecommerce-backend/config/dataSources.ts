// Per-domain database selection (Phase 3C). MongoDB is the default for every
// domain; PostgreSQL is used only where explicitly selected, and only in
// combinations that stay consistent:
//
//   DATA_SOURCE_DELIVERY_OPTIONS  mongo | postgres
//   DATA_SOURCE_PRODUCTS          mongo | postgres
//   DATA_SOURCE_USERS             mongo | postgres
//   DATA_SOURCE_CARTS             mongo | postgres
//   DATA_SOURCE_ORDERS            mongo | postgres
//
// Rules:
//   - carts and orders use the same source (checkout is one transaction);
//   - PostgreSQL carts/orders need PostgreSQL users, products and delivery
//     options (foreign keys and in-transaction product snapshots);
//   - with NODE_ENV=production, any PostgreSQL selection also needs
//     POSTGRES_PRODUCTION_ENABLED=true, an explicit deployment decision;
//   - any PostgreSQL selection needs DATABASE_URL.
import type { DataSource } from "../repositories/types.js";

export interface DataSourceConfig {
  deliveryOptions: DataSource;
  products: DataSource;
  users: DataSource;
  carts: DataSource;
  orders: DataSource;
}

export const DATA_SOURCE_VARIABLES: Record<keyof DataSourceConfig, string> = {
  deliveryOptions: "DATA_SOURCE_DELIVERY_OPTIONS",
  products: "DATA_SOURCE_PRODUCTS",
  users: "DATA_SOURCE_USERS",
  carts: "DATA_SOURCE_CARTS",
  orders: "DATA_SOURCE_ORDERS",
};

export class DataSourceConfigError extends Error {
  override name = "DataSourceConfigError";
}

type Environment = Record<string, string | undefined>;

function readSource(env: Environment, variable: string): DataSource {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") return "mongo";
  const value = raw.trim();
  if (value === "mongo" || value === "postgres") return value;
  throw new DataSourceConfigError(`${variable} must be "mongo" or "postgres", not "${value}".`);
}

export function loadDataSources(env: Environment = process.env): DataSourceConfig {
  const config: DataSourceConfig = {
    deliveryOptions: readSource(env, DATA_SOURCE_VARIABLES.deliveryOptions),
    products: readSource(env, DATA_SOURCE_VARIABLES.products),
    users: readSource(env, DATA_SOURCE_VARIABLES.users),
    carts: readSource(env, DATA_SOURCE_VARIABLES.carts),
    orders: readSource(env, DATA_SOURCE_VARIABLES.orders),
  };

  if (config.carts !== config.orders) {
    throw new DataSourceConfigError(
      "DATA_SOURCE_CARTS and DATA_SOURCE_ORDERS must match: checkout reads the cart and writes the order in one transaction.",
    );
  }

  if (config.orders === "postgres") {
    const required: readonly (keyof DataSourceConfig)[] = ["users", "products", "deliveryOptions"];
    const missing = required
      .filter((domain) => config[domain] !== "postgres")
      .map((domain) => DATA_SOURCE_VARIABLES[domain]);
    if (missing.length > 0) {
      throw new DataSourceConfigError(
        `PostgreSQL carts and orders also need ${missing.join(", ")}=postgres (foreign keys and in-transaction product snapshots).`,
      );
    }
  }

  if (usesPostgres(config)) {
    if (!env.DATABASE_URL?.trim()) {
      throw new DataSourceConfigError("A PostgreSQL data source is selected but DATABASE_URL is not set.");
    }
    if (env.NODE_ENV === "production" && env.POSTGRES_PRODUCTION_ENABLED !== "true") {
      throw new DataSourceConfigError(
        "PostgreSQL is selected with NODE_ENV=production, but POSTGRES_PRODUCTION_ENABLED is not \"true\". "
        + "Production use of PostgreSQL needs an explicit deployment decision.",
      );
    }
  }

  return config;
}

export const usesPostgres = (config: DataSourceConfig) => Object.values(config).includes("postgres");
export const usesMongo = (config: DataSourceConfig) => Object.values(config).includes("mongo");

export const describeDataSources = (config: DataSourceConfig) => (
  Object.entries(config).map(([domain, source]) => `${domain}=${source}`).join(", ")
);
