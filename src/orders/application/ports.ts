import type { Money } from '../../shared/domain/money.ts';
import type { Order, OrderSide, OrderStatus, OrderType } from '../domain/order.ts';

export interface NewOrder {
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  size: number;
  price: Money;
  datetime: Date;
  clientOrderId: string;
}

export interface OrderRepository {
  findById(id: number): Promise<Order | null>;
  findByClientOrderId(userId: number, clientOrderId: string): Promise<Order | null>;
  /** Throws DuplicateClientOrderIdError when (userId, clientOrderId) already exists. */
  insert(order: NewOrder): Promise<Order>;
  updateStatus(id: number, status: OrderStatus): Promise<Order>;
}

/** Balances read inside the transaction that holds the user lock. */
export interface AccountReader {
  availableCash(userId: number): Promise<Money>;
  availableShares(userId: number, instrumentId: number): Promise<number>;
}

export interface Instrument {
  id: number;
  ticker: string;
  type: string;
}

export interface InstrumentRepository {
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
  accounts: AccountReader;
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
