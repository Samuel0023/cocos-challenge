export interface Quote {
  close: string;
  previousClose: string;
  date: string;
}

export interface MarketDataRepository {
  /**
   * Latest quote per instrument: the row with the most recent date, not today's (the seed
   * stops in 2023). Instruments without market data are absent from the map.
   */
  getLatestQuotes(instrumentIds: number[]): Promise<Map<number, Quote>>;
}
