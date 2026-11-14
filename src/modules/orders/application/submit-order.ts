import type { OrderMetrics } from '../../../platform/observability/metrics.ts';
import { Money } from '../../../platform/money.ts';
import type { EventPublisher } from '../../order-events/application/event-publisher.ts';
import { notFound, unprocessable } from '../../../platform/errors.ts';
import type { Logger } from '../../../platform/logger.ts';
import type { Clock } from '../../../platform/clock.ts';
import { hasFundsFor } from '../domain/funds-policy.ts';
import {
  initialStatus,
  isTransfer,
  MAX_ORDER_SIZE,
  sameSize,
  type Order,
  type OrderSide,
  type OrderType,
  type SizedSide,
} from '../domain/order.ts';
import { sizeFromAmount } from '../domain/order-sizing.ts';
import { countOrder, publishOrderEvent } from './order-events.ts';
import {
  DuplicateClientOrderIdError,
  type Instrument,
  type OrderInstrumentRepository,
  type OrderRepository,
  type PriceSource,
  type Transaction,
  type UnitOfWork,
} from './ports.ts';

/**
 * A request already validated for shape: `type` is set for BUY/SELL, exactly one of size/amount,
 * `size` is whole shares (number) for BUY/SELL and pesos (Money) for transfers.
 */
export interface SubmitOrderCommand {
  idempotencyKey: string;
  userId: number;
  instrumentId?: number;
  side: OrderSide;
  type?: OrderType;
  size?: number | Money;
  amount?: Money;
  price?: Money;
}

export interface SubmitOrderDeps {
  instruments: OrderInstrumentRepository;
  prices: PriceSource;
  /** Reads outside any transaction, used after a duplicate-key race. */
  orders: OrderRepository;
  unitOfWork: UnitOfWork;
  eventPublisher: EventPublisher;
  clock: Clock;
  logger: Logger;
  metrics: OrderMetrics;
}

type ResolvedOrder = {
  userId: number;
  instrumentId: number;
  type: OrderType;
  price: Money;
  /**
   * Whether the client fixed the size and the price. A MARKET price comes from market data and
   * may have moved by the time of a retry, so it is not part of the request's identity.
   */
  sizeFromClient: boolean;
  priceFromClient: boolean;
} & SizedSide;

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

    if (result.created) {
      countOrder(this.deps, result.order);
      await publishOrderEvent(this.deps, 'order.created', result.order);
    }
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
    // After the key lookup: a retry of an order sized by amount must not fail because the price
    // moved. Throwing here rolls the transaction back, so a first request still stores nothing.
    assertTradableSize(order);

    const available =
      order.side === 'CASH_IN'
        ? { cash: Money.zero, shares: 0 }
        : {
            cash: await tx.funds.availableCash(order.userId),
            shares: await tx.funds.availableShares(order.userId, order.instrumentId),
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

    return {
      userId: command.userId,
      instrumentId: instrument.id,
      ...resolveSize(command, price),
      type,
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
    // A close of zero or below is no price to trade at, nor to size an order by amount.
    if (close.cents <= 0n) {
      throw unprocessable(`Instrument ${instrument.ticker} has no market price to trade at`);
    }
    return close;
  }
}

/** Pesos exactly as sent for transfers; whole shares as sent or covered by the amount otherwise. */
function resolveSize(command: SubmitOrderCommand, price: Money): SizedSide {
  const { side, size, amount } = command;
  if (isTransfer(side)) {
    const pesos = amount ?? size;
    if (!(pesos instanceof Money)) throw new Error('Transfer without pesos reached the use case');
    return { side, size: pesos };
  }
  if (size instanceof Money) throw new Error('Share size in pesos reached the use case');
  // A size derived from an amount is checked by assertTradableSize, after the idempotency lookup.
  return { side, size: size ?? sizeFromAmount(amount ?? Money.zero, price) };
}

/** 422 when an amount covers no whole share, or more shares than an order can hold. */
function assertTradableSize(order: SizedSide): void {
  if (isTransfer(order.side) || typeof order.size !== 'number') return;
  if (order.size === 0) throw unprocessable('Amount is not enough for one unit at the order price');
  if (order.size > MAX_ORDER_SIZE) throw unprocessable('Order size is too large');
}

/** The stored order when the retry asks for the same thing; 422 otherwise. */
function replay(existing: Order, requested: ResolvedOrder): Order {
  const same =
    existing.userId === requested.userId &&
    existing.instrumentId === requested.instrumentId &&
    existing.side === requested.side &&
    existing.type === requested.type &&
    (!requested.sizeFromClient || sameSize(existing, requested)) &&
    (!requested.priceFromClient || existing.price.cents === requested.price.cents);
  if (!same) throw unprocessable('Idempotency-Key already used with a different request');
  return existing;
}
