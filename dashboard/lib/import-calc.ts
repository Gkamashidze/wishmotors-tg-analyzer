export type CalcLine = {
  totalPriceUsd:      number;
  totalPriceGel:      number;
  allocatedTransport: number;
  allocatedTerminal:  number;
  allocatedAgency:    number;
  allocatedVat:       number;
  landedCostPerUnit:  number;
};

/**
 * Allocates shared import costs across line items.
 *
 * Transport is split by weight share; terminal, agency, and VAT are split by
 * GEL value share.
 *
 * Import VAT is recoverable — it is tracked in allocatedVat for display
 * purposes but is intentionally excluded from landedCostPerUnit so that
 * inventory / fixed-asset costs are stated on a VAT-exclusive basis.
 */
export function calcLanded(
  items: Array<{ quantity: string; unitPriceUsd: string; weight: string }>,
  rate:      number,
  transport: number,
  terminal:  number,
  agency:    number,
  vatCost:   number,
): CalcLine[] {
  const parsed = items.map((it) => ({
    qty:      Math.max(0, parseFloat(it.quantity)     || 0),
    priceUsd: Math.max(0, parseFloat(it.unitPriceUsd) || 0),
    weight:   Math.max(0, parseFloat(it.weight)       || 0),
  }));

  const totalWeight = parsed.reduce((s, i) => s + i.weight, 0);
  const gelValues   = parsed.map((i) => i.qty * i.priceUsd * rate);
  const totalGel    = gelValues.reduce((s, v) => s + v, 0);
  const n           = items.length || 1;

  return parsed.map((it, idx) => {
    const tShare = totalWeight > 0 ? it.weight / totalWeight : 1 / n;
    const vShare = totalGel    > 0 ? gelValues[idx] / totalGel : 1 / n;

    const aTransport = transport * tShare;
    const aTerminal  = terminal  * vShare;
    const aAgency    = agency    * vShare;
    const aVat       = vatCost   * vShare;

    // VAT excluded: import VAT is recoverable and must not inflate inventory cost
    const totalLanded = gelValues[idx] + aTransport + aTerminal + aAgency;

    return {
      totalPriceUsd:      it.qty * it.priceUsd,
      totalPriceGel:      gelValues[idx],
      allocatedTransport: aTransport,
      allocatedTerminal:  aTerminal,
      allocatedAgency:    aAgency,
      allocatedVat:       aVat,
      landedCostPerUnit:  it.qty > 0 ? totalLanded / it.qty : 0,
    };
  });
}
