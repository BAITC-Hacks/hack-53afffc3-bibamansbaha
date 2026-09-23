export function normalizeUnit(unit: string | null | undefined): string {
 const value=(unit??'').trim().toLowerCase().replace(/\.$/,'');
 const aliases:Record<string,string>={pcs:'шт',pc:'шт',pieces:'шт',штуки:'шт',штук:'шт',m:'м',meter:'м',meters:'м',метр:'м',метры:'м',метров:'м',kg:'кг',pack:'упак',упаковка:'упак',упаковки:'упак'};
 return aliases[value]??value;
}
export function needsUnitReview(requested:string|null|undefined,catalog:string|null|undefined):boolean {
 return Boolean(normalizeUnit(requested))&&normalizeUnit(requested)!==normalizeUnit(catalog);
}
