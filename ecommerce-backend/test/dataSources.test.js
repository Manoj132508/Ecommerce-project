// Per-domain data source selection (config/dataSources.ts). Pure: no database.
import { describe, expect, test } from "vitest";
import { describeDataSources, loadDataSources, usesMongo, usesPostgres } from "../config/dataSources.js";
import { ALL_MONGO, createRepositories } from "../repositories/index.js";

const PG_URL = "postgresql://user:secret@127.0.0.1:5432/ecommerce";
const ALL_POSTGRES_ENV = {
  DATA_SOURCE_DELIVERY_OPTIONS: "postgres",
  DATA_SOURCE_PRODUCTS: "postgres",
  DATA_SOURCE_USERS: "postgres",
  DATA_SOURCE_CARTS: "postgres",
  DATA_SOURCE_ORDERS: "postgres",
  DATABASE_URL: PG_URL,
};

describe("defaults", () => {
  test("every domain is MongoDB when nothing is set", () => {
    expect(loadDataSources({})).toEqual(ALL_MONGO);
    expect(usesPostgres(loadDataSources({}))).toBe(false);
    expect(usesMongo(loadDataSources({}))).toBe(true);
  });

  test("blank values also mean MongoDB", () => {
    expect(loadDataSources({ DATA_SOURCE_PRODUCTS: "  " })).toEqual(ALL_MONGO);
  });

  test("the default app repositories are all MongoDB", () => {
    const repositories = createRepositories();
    expect(Object.values(repositories).map((repository) => repository.source)).toEqual(["mongo", "mongo", "mongo", "mongo", "mongo"]);
    expect(repositories.carts.ownership).toBe("shared");
  });
});

describe("validation", () => {
  test.each(["Postgres", "pg", "mysql", "MONGO", "true"])("rejects the value %j", (value) => {
    expect(() => loadDataSources({ DATA_SOURCE_PRODUCTS: value, DATABASE_URL: PG_URL }))
      .toThrow(/DATA_SOURCE_PRODUCTS must be "mongo" or "postgres"/);
  });

  test("carts and orders must use the same source", () => {
    expect(() => loadDataSources({ ...ALL_POSTGRES_ENV, DATA_SOURCE_CARTS: "mongo" })).toThrow(/must match/);
    expect(() => loadDataSources({ ...ALL_POSTGRES_ENV, DATA_SOURCE_ORDERS: "mongo" })).toThrow(/must match/);
  });

  test("PostgreSQL carts and orders need PostgreSQL users, products and delivery options", () => {
    expect(() => loadDataSources({ ...ALL_POSTGRES_ENV, DATA_SOURCE_USERS: "mongo" }))
      .toThrow(/also need DATA_SOURCE_USERS=postgres/);
    expect(() => loadDataSources({ ...ALL_POSTGRES_ENV, DATA_SOURCE_PRODUCTS: "mongo", DATA_SOURCE_DELIVERY_OPTIONS: "mongo" }))
      .toThrow(/DATA_SOURCE_PRODUCTS, DATA_SOURCE_DELIVERY_OPTIONS/);
  });

  test("reference domains may move on their own, in the planned order", () => {
    expect(loadDataSources({ DATA_SOURCE_DELIVERY_OPTIONS: "postgres", DATABASE_URL: PG_URL }).deliveryOptions).toBe("postgres");
    expect(loadDataSources({ DATA_SOURCE_DELIVERY_OPTIONS: "postgres", DATA_SOURCE_PRODUCTS: "postgres", DATABASE_URL: PG_URL }))
      .toMatchObject({ deliveryOptions: "postgres", products: "postgres", carts: "mongo" });
    expect(loadDataSources({ DATA_SOURCE_USERS: "postgres", DATABASE_URL: PG_URL }).users).toBe("postgres");
    expect(loadDataSources(ALL_POSTGRES_ENV)).toEqual({
      deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
    });
  });

  test("any PostgreSQL selection needs DATABASE_URL", () => {
    expect(() => loadDataSources({ DATA_SOURCE_PRODUCTS: "postgres" })).toThrow(/DATABASE_URL is not set/);
  });

  test("a PostgreSQL selection without a pool cannot build repositories", () => {
    expect(() => createRepositories(loadDataSources({ DATA_SOURCE_PRODUCTS: "postgres", DATABASE_URL: PG_URL })))
      .toThrow(/no connection pool/);
  });
});

describe("production guard", () => {
  test("refuses PostgreSQL in production without the explicit deployment flag", () => {
    for (const flag of [undefined, "", "yes", "TRUE", "1"]) {
      expect(() => loadDataSources({ ...ALL_POSTGRES_ENV, NODE_ENV: "production", POSTGRES_PRODUCTION_ENABLED: flag }))
        .toThrow(/POSTGRES_PRODUCTION_ENABLED is not "true"/);
    }
  });

  test("allows it only with POSTGRES_PRODUCTION_ENABLED=true", () => {
    expect(loadDataSources({ ...ALL_POSTGRES_ENV, NODE_ENV: "production", POSTGRES_PRODUCTION_ENABLED: "true" }).orders).toBe("postgres");
  });

  test("MongoDB-only production needs no flag", () => {
    expect(loadDataSources({ NODE_ENV: "production" })).toEqual(ALL_MONGO);
  });

  test("describes the selection without connection details", () => {
    expect(describeDataSources(loadDataSources(ALL_POSTGRES_ENV))).toBe(
      "deliveryOptions=postgres, products=postgres, users=postgres, carts=postgres, orders=postgres",
    );
  });
});
