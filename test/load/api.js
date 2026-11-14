// k6 load test: a mix of the read endpoints and order submission against a running API.
// Run it with `make load`. It writes orders to the database it points at, so use a local one.
/* global __ENV */
import http from 'k6/http';
import { check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || '30s';

// Seeded data: users 1 to 4 and PAMP (id 47), which has a market price.
const USER_IDS = [1, 2, 3, 4];
const INSTRUMENT_ID = 47;
const SEARCH_TERMS = ['pamp', 'ggal', 'banco', 'ypf', 'al', 'tele'];

export const options = {
  scenarios: {
    mixed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{endpoint:portfolio}': ['p(95)<300'],
    'http_req_duration{endpoint:instruments}': ['p(95)<300'],
    'http_req_duration{endpoint:orders}': ['p(95)<500'],
  },
};

const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** A random UUID v4: the Idempotency-Key header only accepts UUIDs. */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random % 4) + 8).toString(16);
  });
}

function submitOrder(body) {
  return http.post(`${BASE_URL}/orders`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': uuid() },
    tags: { endpoint: 'orders' },
  });
}

/** Funds every user so that the market buys of the test are filled, not rejected. */
export function setup() {
  for (const userId of USER_IDS) {
    const res = submitOrder({ userId, side: 'CASH_IN', amount: '100000000.00' });
    if (res.status !== 201) {
      throw new Error(`setup: CASH_IN for user ${userId} answered ${res.status}: ${res.body}`);
    }
  }
}

export default function () {
  const userId = pick(USER_IDS);
  const roll = Math.random();

  if (roll < 0.4) {
    group('portfolio', () => {
      const res = http.get(`${BASE_URL}/users/${userId}/portfolio`, {
        tags: { endpoint: 'portfolio' },
      });
      check(res, { 'portfolio answers 200': (r) => r.status === 200 });
    });
  } else if (roll < 0.7) {
    group('instruments', () => {
      const res = http.get(`${BASE_URL}/instruments?q=${pick(SEARCH_TERMS)}`, {
        tags: { endpoint: 'instruments' },
      });
      check(res, { 'search answers 200': (r) => r.status === 200 });
    });
  } else {
    // A buy followed by a sell of the same share leaves the position where it was.
    group('orders', () => {
      for (const side of ['BUY', 'SELL']) {
        const res = submitOrder({
          userId,
          instrumentId: INSTRUMENT_ID,
          side,
          type: 'MARKET',
          size: 1,
        });
        check(res, {
          'order answers 201': (r) => r.status === 201,
          'order is stored with a status': (r) => ['FILLED', 'REJECTED'].includes(r.json('status')),
        });
      }
    });
  }
}
