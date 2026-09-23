export function normalizeUnit(unit: string | null | undefined): string {
 const value=(unit??'').trim().toLowerCase().replace(/\.$/,'');
 const aliases:Record<string,string>={pcs:'шт',pc:'шт',pieces:'шт',штука:'шт',штуки:'шт',штук:'шт',m:'м',meter:'м',meters:'м',метр:'м',метры:'м',метров:'м',kg:'кг',pack:'упак',упаковка:'упак',упаковки:'упак'};
 return aliases[value]??value;
}
export function needsUnitReview(requested:string|null|undefined,catalog:string|null|undefined):boolean {
 return !normalizeUnit(catalog)||(Boolean(normalizeUnit(requested))&&normalizeUnit(requested)!==normalizeUnit(catalog));
}

export function explicitQuantityUnit(text:string):{quantity:number;unit:string;unitEvidence:string}|undefined {
 const match=text.match(/(?:^|[\s,;])(\d+(?:[.,]\d+)?)\s*(упаковк[аиу]?|упаковок|упак\.?|уп\.?|бухт[аыу]?|рулон[аов]*|коробк[аиу]?|штук[аи]?|шт\.?|метр(?:а|ов|ы)?|м\.?|кг)(?=$|[\s,;.!])/i);
 if(!match)return;
 return{quantity:Number(match[1].replace(',','.')),unit:match[2],unitEvidence:match[0].trim().replace(/^[,;]/,'').trim()};
}
