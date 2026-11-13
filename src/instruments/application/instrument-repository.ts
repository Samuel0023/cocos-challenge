export interface InstrumentSummary {
  id: number;
  ticker: string;
  name: string;
  type: string;
  /** Latest close with two decimals, or null when there is no market data. */
  lastPrice: string | null;
}

export interface InstrumentSearchPage {
  items: InstrumentSummary[];
  total: number;
}

export interface InstrumentRepository {
  /** `text` is already trimmed and lowercased. */
  search(text: string, limit: number, offset: number): Promise<InstrumentSearchPage>;
}
