// src/index.ts
var DataEngine = class {
  #stores;
  constructor() {
    this.#stores = /* @__PURE__ */ new Map();
  }
  /** Registers a new data store for use in queries */
  async registerStore(name, driver) {
    await driver.register?.();
    this.#stores.set(name, driver);
  }
  /** Access the driver of a given store. Errors if it hasn't been registered */
  store(name) {
    const store = this.#stores.get(name);
    if (!store) {
      throw new Error(`Store "${name}" doesn't exist.`);
    }
    return store;
  }
  /** Execute a root abstract query */
  async query(query) {
    return this.store(query.store).query(query);
  }
  /** Gracefully shutdown connected drivers */
  async destroy() {
    await Promise.all(Array.from(this.#stores.values()).map((driver) => driver.destroy?.()));
  }
};
export {
  DataEngine
};
