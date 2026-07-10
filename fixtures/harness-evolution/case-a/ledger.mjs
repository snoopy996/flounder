export class Ledger {
  #balances;
  #used = new Set();

  constructor(entries) {
    this.#balances = new Map(entries);
  }

  balance(account) {
    return this.#balances.get(account) ?? 0;
  }

  transfer(request, authorization) {
    if (authorization.action !== "transfer") throw new Error("wrong action");
    if (this.#used.has(authorization.nonce)) throw new Error("authorization replayed");
    if (request.amount <= 0) throw new Error("invalid amount");
    if (this.balance(request.from) < request.amount) throw new Error("insufficient funds");
    this.#used.add(authorization.nonce);
    this.#balances.set(request.from, this.balance(request.from) - request.amount);
    this.#balances.set(request.to, this.balance(request.to) + request.amount);
  }
}
