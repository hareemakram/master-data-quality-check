// Minimal subset of the official ExcelScript typings used by RunQualityChecks (for type-checking in CI).
declare namespace ExcelScript {
  interface Range { getValues(): (string | number | boolean)[][]; }
  interface Table {
    getHeaderRowRange(): Range;
    getRangeBetweenHeaderAndTotal(): Range;
    addRow(index?: number, values?: (boolean | string | number)[]): void;
  }
  interface Workbook { getTable(key: string): Table | undefined; }
}
declare const console: { log(message: string): void };
