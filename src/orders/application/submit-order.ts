import { Money } from '../../shared/domain/money.ts';
import type { EventPublisher } from '../../shared/events/order-event.ts';
import { notFound, unprocessable } from '../../shared/http/errors.ts';
import type { Logger } from '../../shared/logger.ts';
import type { Clock } from '../../shared/ports/clock.ts';
import { hasFundsFor } from '../domain/funds-policy.ts';
import {
  initialStatus,
  isTransfer,
  MAX_ORDER_SIZE,
  type Order,
  type OrderSide,
  type OrderType,
} from '../domain/order.ts';
import { sizeFromAmount } from '../domain/order-sizing.ts';
import { publishOrderEvent } from './order-events.ts';
import {
  DuplicateClientOrderIdError,
  type Instrument,
  type InstrumentRepository,
  type OrderRepository,
  type PriceSource,
  type Transaction,
  type UnitOfWork,
} from './ports.ts';

/** A request already validated for shape: `type` is set for BUY/SELL, exactly one of size/amount. */
export interface SubmitOrderCommand {
  idempotencyKey: string;
  userId: number;
  instrumentId?: number;
  side: OrderSide;
  type?: OrderType;
  size?: number;
  amount?: Money;
  price?: Money;
}

export interface SubmitOrderDeps {
  instruments: InstrumentRepository;
  prices: PriceSource;
  /** Reads outside any transaction, used after a duplicate-key race. */
  orders: OrderRepository;
  unitOfWork: UnitOfWork;
  eventPublisher: EventPublisher;
  clock: Clock;
  logger: Logger;
}

interface ResolvedOrder {
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: Money;
  /**
   * Whether the client fixed the size and the price. A MARKET price comes from market data and
   * may have moved by the time of a retry, so it is not part of the request's identity.
   */
  sizeFromClient: boolean;
  priceFromClient: boolean;
}

const TRANSFER_PRICE = Money.parse('1');

export class SubmitOrder {
  private readonly deps: SubmitOrderDeps;

  constructor(deps: SubmitOrderDeps) {
    this.deps = deps;
  }

  async execute(command: SubmitOrderCommand): Promise<Order> {
    const resolved = await this.resolve(command);
    const key = command.idempotencyKey;

    let result: { order: Order; created: boolean };
    try {
      result = await this.deps.unitOfWork.run((tx) => this.store(tx, resolved, key));
    } catch (error) {
      if (!(error instanceof DuplicateClientOrderIdError)) throw error;
      // Defensive: the user lock should make this unreachable.
      const existing = await this.deps.orders.findByClientOrderId(resolved.userId, key);
      if (!existing) throw error;
      result = { order: replay(existing, resolved), created: false };
    }

    if (result.created) await publishOrderEvent(this.deps, 'order.created', result.order);
    return result.order;
  }

  private async store(
    tx: Transaction,
    order: ResolvedOrder,
    key: string,
  ): Promise<{ order: Order; created: boolean }> {
    if (!(await tx.lockUser(order.userId))) throw notFound(`User ${order.userId} not found`);

    const existing = await tx.orders.findByClientOrderId(order.userId, key);
    if (existing) return { order: replay(existing, order), created: false };

    const available =
      order.side === 'CASH_IN'
        ? { cash: Money.zero, shares: 0 }
        : {
            cash: await tx.accounts.availableCash(order.userId),
            shares: await tx.accounts.availableShares(order.userId, order.instrumentId),
          };
    const status = initialStatus(order.type, hasFundsFor(order, available));

    const stored = await tx.orders.insert({
      ...order,
      status,
      datetime: this.deps.clock.now(),
      clientOrderId: key,
    });
    return { order: stored, created: true };
  }

  private async resolve(command: SubmitOrderCommand): Promise<ResolvedOrder> {
    const transfer = isTransfer(command.side);
    const instrument = await this.resolveInstrument(command, transfer);
    const type: OrderType = transfer ? 'MARKET' : (command.type ?? 'MARKET');
    const price = await this.resolvePrice(instrument, type, transfer, command.price);

    const size = command.size ?? sizeFromAmount(command.amount ?? Money.zero, price);
    if (size === 0) throw unprocessable('Amount is not enough for one unit at the order price');
    if (size > MAX_ORDER_SIZE) throw unprocessable('Order size is too large');

    return {
      userId: command.userId,
      instrumentId: instrument.id,
      side: command.side,
      type,
      size,
      price,
      priceFromClient: !transfer && type === 'LIMIT',
      sizeFromClient: command.size !== undefined || transfer || type === 'LIMIT',
    };
  }

  private async resolveInstrument(command: SubmitOrderCommand, transfer: boolean) {
    const cash = await this.deps.instruments.findCash();
    if (transfer && command.instrumentId === undefined) return cash;

    const instrument = await this.deps.instruments.findById(command.instrumentId ?? 0);
    if (!instrument) throw notFound(`Instrument ${command.instrumentId} not found`);
    if (transfer && instrument.id !== cash.id) {
      throw unprocessable('CASH_IN and CASH_OUT only apply to the ARS instrument');
    }
    if (!transfer && instrument.id === cash.id) {
      throw unprocessable('BUY and SELL do not apply to the ARS instrument');
    }
    return instrument;
  }

  private async resolvePrice(
    instrument: Instrument,
    type: OrderType,
    transfer: boolean,
    limitPrice: Money | undefined,
  ): Promise<Money> {
    if (transfer) return TRANSFER_PRICE;
    if (type === 'LIMIT') {
      if (!limitPrice) throw new Error('LIMIT order without price reached the use case');
      return limitPrice;
    }
    const close = await this.deps.prices.latestClose(instrument.id);
    if (!close) throw unprocessable(`Instrument ${instrument.ticker} has no market data`);
    return close;
  }
}

/** The stored order when the retry asks for the same thing; 422 otherwise. */
function replay(existing: Order, requested: ResolvedOrder): Order {
  const same =
    existing.userId === requested.userId &&
    existing.instrumentId === requested.instrumentId &&
    existing.side === requested.side &&
    existing.type === requested.type &&
    (!requested.sizeFromClient || existing.size === requested.size) &&
    (!requested.priceFromClient || existing.price.cents === requested.price.cents);
  if (!same) throw unprocessable('Idempotency-Key already used with a different request');
  return existing;
}
