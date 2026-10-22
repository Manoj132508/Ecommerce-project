// Builds the repositories for the selected data sources (config/dataSources.ts).
import type { Pool } from "pg";
import type { DataSourceConfig } from "../config/dataSources.js";
import {
  MongoCartRepository,
  MongoDeliveryOptionRepository,
  MongoOrderRepository,
  MongoProductRepository,
  MongoUserRepository,
} from "./mongo.js";
import {
  PostgresCartRepository,
  PostgresDeliveryOptionRepository,
  PostgresOrderRepository,
  PostgresProductRepository,
  PostgresUserRepository,
} from "./postgres.js";
import type { Repositories } from "./types.js";

export const ALL_MONGO: DataSourceConfig = {
  deliveryOptions: "mongo",
  products: "mongo",
  users: "mongo",
  carts: "mongo",
  orders: "mongo",
};

export function createRepositories(config: DataSourceConfig = ALL_MONGO, pool?: Pool): Repositories {
  const needPool = (): Pool => {
    if (!pool) throw new Error("A PostgreSQL data source is selected but no connection pool was provided.");
    return pool;
  };

  const deliveryOptions = config.deliveryOptions === "postgres"
    ? new PostgresDeliveryOptionRepository(needPool())
    : new MongoDeliveryOptionRepository();
  const products = config.products === "postgres" ? new PostgresProductRepository(needPool()) : new MongoProductRepository();

  return {
    deliveryOptions,
    products,
    users: config.users === "postgres" ? new PostgresUserRepository(needPool()) : new MongoUserRepository(),
    carts: config.carts === "postgres" ? new PostgresCartRepository(needPool()) : new MongoCartRepository(),
    orders: config.orders === "postgres"
      ? new PostgresOrderRepository(needPool())
      : new MongoOrderRepository(products, deliveryOptions),
  };
}
