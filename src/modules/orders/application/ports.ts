import type { Money } from '../../../platform/money.ts';
import type { Order, OrderStatus, OrderType, SizedSide } from '../domain/order.ts';

export type NewOrder = {
  userId: number;
  instrumentId: number;
  type: OrderType;
  status: OrderStatus;
  price: Money;
  datetime: Date;
  clientOrderId: string;
} & SizedSide;

export interface OrderRepository {
  findById(id: number): Promise<Order | null>;
  findByClientOrderId(userId: number, clientOrderId: string): Promise<Order | null>;
  /** Throws DuplicateClientOrderIdError when (userId, clientOrderId) already exists. */
  insert(order: NewOrder): Promise<Order>;
  updateStatus(id: number, status: OrderStatus): Promise<Order>;
}

/** Balances read inside the transaction that holds the user lock. */
export interface FundsReader {
  availableCash(userId: number): Promise<Money>;
  availableShares(userId: number, instrumentId: number): Promise<number>;
}

export interface Instrument {
  id: number;
  ticker: string;
  type: string;
}

export interface OrderInstrumentRepository {
  findById(id: number): Promise<Instrument | null>;
  /** The ARS instrument that transfers move. */
  findCash(): Promise<Instrument>;
}

export interface PriceSource {
  /** Latest close, or null when the instrument has no market data. */
  latestClose(instrumentId: number): Promise<Money | null>;
}

export interface Transaction {
  /** Takes the row lock on the user (SELECT ... FOR UPDATE); false when the user does not exist. */
  lockUser(userId: number): Promise<boolean>;
  orders: OrderRepository;
  funds: FundsReader;
}

/** Runs work in one database transaction; the lock taken by lockUser lasts until it ends. */
export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export class DuplicateClientOrderIdError extends Error {
  constructor() {
    super('Idempotency key already used by this user');
  }
}
